// Software prefetch benchmark: an indexed gather sum += f(a[idx[i]]) with a
// __builtin_prefetch of a[idx[i + D]], swept over the prefetch distance D, the
// amount of dependent work f per element, and the locality hint; and a
// sequential sum with a prefetch D bytes ahead, swept over D.
//
// Usage: prefetch_bench <array_mib> <accesses_per_run> <blocks> <seed> <pages> <configs>
//   pages   : "4k" (MADV_NOHUGEPAGE) or "2m" (MADV_HUGEPAGE, transparent huge pages)
//   configs : comma-separated list of
//               g:W:D:H  gather, W rounds of work per element, distance D
//                        elements (0 = no prefetch instruction), hint H (0-3)
//               hot:W    gather from a 32 KiB array that stays in L1, no prefetch
//               s:B:H    sequential sum over the first 1 GiB, prefetch B bytes
//                        ahead (0 = no prefetch instruction), hint H (0-3)
//
// Each block runs every configuration once, in an order shuffled by the seed.
// One line of CSV is printed per run: block,config,iterations,ns_per_iteration.
// Build: gcc -O2 -std=gnu11 -Wall -Wextra prefetch_bench.c -o prefetch_bench

#define _GNU_SOURCE
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>

#define PAD 8192            // extra index entries, so idx[i + D] stays in bounds
#define HOT_ELEMS 4096      // 32 KiB of uint64_t
#define SEQ_BYTES (1ull << 30)
#define MAX_CONFIGS 128

static uint64_t rng_state;

static uint64_t splitmix64(void) {
    uint64_t z = (rng_state += 0x9e3779b97f4a7c15ull);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
    return z ^ (z >> 31);
}

static uint64_t below(uint64_t n) {
    uint64_t limit = UINT64_MAX - UINT64_MAX % n;
    uint64_t x;
    do {
        x = splitmix64();
    } while (x >= limit);
    return x % n;
}

static double now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC_RAW, &ts);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}

// The work per element: W rounds of a multiply-xorshift mix, a dependent chain
// on the loaded value. Different elements' chains are independent, so the
// out-of-order core can overlap iterations as far as its window allows.
static inline uint64_t mix(uint64_t x, int w) {
    for (int r = 0; r < w; r++) x = (x ^ (x >> 31)) * 0x9e3779b97f4a7c15ull;
    return x;
}

static __attribute__((noinline)) uint64_t gather_none(const uint64_t *a, const uint32_t *idx,
                                                      size_t n, int w) {
    uint64_t sum = 0;
    for (size_t i = 0; i < n; i++) sum += mix(a[idx[i]], w);
    return sum;
}

// __builtin_prefetch needs a constant hint, so one function per hint.
#define DEFINE_GATHER(H)                                                          \
    static __attribute__((noinline)) uint64_t gather_h##H(                       \
        const uint64_t *a, const uint32_t *idx, size_t n, int w, size_t d) {      \
        uint64_t sum = 0;                                                         \
        for (size_t i = 0; i < n; i++) {                                          \
            __builtin_prefetch(&a[idx[i + d]], 0, H);                             \
            sum += mix(a[idx[i]], w);                                             \
        }                                                                         \
        return sum;                                                               \
    }
DEFINE_GATHER(0) DEFINE_GATHER(1) DEFINE_GATHER(2) DEFINE_GATHER(3)

static __attribute__((noinline)) uint64_t seq_none(const uint64_t *a, size_t n) {
    uint64_t sum = 0;
    for (size_t i = 0; i < n; i++) sum += a[i];
    return sum;
}

// The form in the original version of the note: one prefetch per element, so
// seven of every eight prefetches name a line that is already requested.
#define DEFINE_SEQ(H)                                                             \
    static __attribute__((noinline)) uint64_t seq_h##H(const uint64_t *a,        \
                                                      size_t n, size_t d) {       \
        uint64_t sum = 0;                                                         \
        for (size_t i = 0; i < n; i++) {                                          \
            __builtin_prefetch(&a[i + d], 0, H);                                  \
            sum += a[i];                                                          \
        }                                                                         \
        return sum;                                                               \
    }
DEFINE_SEQ(0) DEFINE_SEQ(1) DEFINE_SEQ(2) DEFINE_SEQ(3)

typedef struct {
    char kind;  // 'g', 'h' (hot), 's'
    int w;
    size_t d;
    int hint;
    char text[32];
} config_t;

static uint64_t run(const config_t *c, const uint64_t *a, const uint32_t *idx,
                    const uint64_t *hot, const uint32_t *hot_idx, size_t accesses,
                    size_t *iters) {
    if (c->kind == 'h') {
        *iters = accesses;
        return gather_none(hot, hot_idx, accesses, c->w);
    }
    if (c->kind == 's') {
        size_t n = SEQ_BYTES / sizeof(uint64_t);
        size_t d = c->d / sizeof(uint64_t);
        *iters = n;
        if (d == 0) return seq_none(a, n);
        switch (c->hint) {
        case 0: return seq_h0(a, n, d);
        case 1: return seq_h1(a, n, d);
        case 2: return seq_h2(a, n, d);
        default: return seq_h3(a, n, d);
        }
    }
    *iters = accesses;
    if (c->d == 0) return gather_none(a, idx, accesses, c->w);
    switch (c->hint) {
    case 0: return gather_h0(a, idx, accesses, c->w, c->d);
    case 1: return gather_h1(a, idx, accesses, c->w, c->d);
    case 2: return gather_h2(a, idx, accesses, c->w, c->d);
    default: return gather_h3(a, idx, accesses, c->w, c->d);
    }
}

static long anon_huge_kib(void *addr) {
    FILE *f = fopen("/proc/self/smaps", "r");
    if (!f) return -1;
    char buf[512];
    int in_region = 0;
    long kib = -1;
    uintptr_t target = (uintptr_t)addr;
    while (fgets(buf, sizeof buf, f)) {
        uintptr_t lo, hi;
        if (sscanf(buf, "%" SCNxPTR "-%" SCNxPTR, &lo, &hi) == 2 && strchr(buf, ' ') &&
            buf[strspn(buf, "0123456789abcdef")] == '-') {
            in_region = target >= lo && target < hi;
            continue;
        }
        if (in_region && sscanf(buf, "AnonHugePages: %ld kB", &kib) == 1) break;
    }
    fclose(f);
    return kib;
}

static int parse(char *tok, config_t *c) {
    memset(c, 0, sizeof *c);
    snprintf(c->text, sizeof c->text, "%s", tok);
    unsigned long long d;
    if (sscanf(tok, "g:%d:%llu:%d", &c->w, &d, &c->hint) == 3) {
        c->kind = 'g';
        c->d = d;
        return c->w >= 0 && c->d < PAD && c->hint >= 0 && c->hint <= 3;
    }
    if (sscanf(tok, "hot:%d", &c->w) == 1) {
        c->kind = 'h';
        return c->w >= 0;
    }
    if (sscanf(tok, "s:%llu:%d", &d, &c->hint) == 2) {
        c->kind = 's';
        c->d = d;
        return c->d % 8 == 0 && c->d <= (1u << 20) && c->hint >= 0 && c->hint <= 3;
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 7) {
        fprintf(stderr, "usage: %s array_mib accesses_per_run blocks seed 4k|2m configs\n", argv[0]);
        return 2;
    }
    size_t mib = strtoull(argv[1], NULL, 10);
    size_t accesses = strtoull(argv[2], NULL, 10);
    int blocks = atoi(argv[3]);
    rng_state = strtoull(argv[4], NULL, 0);
    int huge = strcmp(argv[5], "2m") == 0;
    if (!huge && strcmp(argv[5], "4k") != 0) {
        fprintf(stderr, "pages must be 4k or 2m\n");
        return 2;
    }
    config_t configs[MAX_CONFIGS];
    int nconf = 0;
    for (char *tok = strtok(argv[6], ","); tok && nconf < MAX_CONFIGS; tok = strtok(NULL, ",")) {
        if (!parse(tok, &configs[nconf])) {
            fprintf(stderr, "bad config %s\n", tok);
            return 2;
        }
        nconf++;
    }

    size_t bytes = mib << 20;
    size_t n = bytes / sizeof(uint64_t);
    if (bytes < SEQ_BYTES + (2u << 20) || n > UINT32_MAX) {
        fprintf(stderr, "array must be between 1026 MiB and 32 GiB\n");
        return 2;
    }
    uint64_t *a = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (a == MAP_FAILED) {
        perror("mmap");
        return 1;
    }
    madvise(a, bytes, huge ? MADV_HUGEPAGE : MADV_NOHUGEPAGE);
    for (size_t i = 0; i < n; i++) a[i] = splitmix64();

    uint32_t *idx = malloc((accesses + PAD) * sizeof *idx);
    uint32_t *hot_idx = malloc((accesses + PAD) * sizeof *hot_idx);
    uint64_t *hot = aligned_alloc(64, HOT_ELEMS * sizeof *hot);
    if (!idx || !hot_idx || !hot) {
        fprintf(stderr, "allocation failed\n");
        return 1;
    }
    for (size_t i = 0; i < accesses + PAD; i++) {
        idx[i] = (uint32_t)below(n);
        hot_idx[i] = (uint32_t)below(HOT_ELEMS);
    }
    for (size_t i = 0; i < HOT_ELEMS; i++) hot[i] = splitmix64();

    printf("array_mib=%zu pages=%s anon_huge_kib=%ld accesses=%zu seq_bytes=%llu\n", mib,
           argv[5], anon_huge_kib(a), accesses, (unsigned long long)SEQ_BYTES);

    uint64_t sink = 0;
    size_t iters;
    // Warm-up: one gather and one sequential pass, untimed.
    config_t warm_g = {.kind = 'g', .w = 0, .d = 0};
    config_t warm_s = {.kind = 's', .d = 0};
    sink += run(&warm_g, a, idx, hot, hot_idx, accesses, &iters);
    sink += run(&warm_s, a, idx, hot, hot_idx, accesses, &iters);

    int order[MAX_CONFIGS];
    printf("block,config,iterations,ns_per_iteration\n");
    for (int b = 0; b < blocks; b++) {
        for (int i = 0; i < nconf; i++) order[i] = i;
        for (int i = nconf - 1; i > 0; i--) {
            int j = (int)below((uint64_t)i + 1);
            int t = order[i];
            order[i] = order[j];
            order[j] = t;
        }
        for (int k = 0; k < nconf; k++) {
            const config_t *c = &configs[order[k]];
            double t0 = now_ns();
            sink += run(c, a, idx, hot, hot_idx, accesses, &iters);
            double t1 = now_ns();
            printf("%d,%s,%zu,%.4f\n", b, c->text, iters, (t1 - t0) / (double)iters);
            fflush(stdout);
        }
    }
    printf("checksum=%" PRIu64 "\n", sink);
    return 0;
}
