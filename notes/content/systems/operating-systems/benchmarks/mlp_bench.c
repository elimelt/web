// Memory-level parallelism benchmark: k independent pointer chases through one
// random cyclic permutation of cache lines, plus a loop of independent random
// loads as a throughput reference.
//
// Usage: mlp_bench <array_mib> <accesses_per_run> <blocks> <seed> <pages> <chains>
//   pages  : "4k" (MADV_NOHUGEPAGE) or "2m" (MADV_HUGEPAGE, transparent huge pages)
//   chains : comma-separated chain counts; 0 means the independent-load loop
//
// Each block runs every configuration once, in an order shuffled by the seed.
// One line of CSV is printed per run: block,config,accesses,ns_per_access.
// Build: gcc -O2 -std=gnu11 -Wall -Wextra mlp_bench.c -o mlp_bench

#define _GNU_SOURCE
#include <inttypes.h>
#include <sched.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>

#define LINE 64
#define MAX_CHAINS 32

typedef struct line {
    struct line *next;
    char pad[LINE - sizeof(struct line *)];
} line_t;

_Static_assert(sizeof(line_t) == LINE, "one element per cache line");

static uint64_t rng_state;

static uint64_t splitmix64(void) {
    uint64_t z = (rng_state += 0x9e3779b97f4a7c15ull);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
    return z ^ (z >> 31);
}

// Uniform integer in [0, n) by rejection, so Sattolo's shuffle is unbiased.
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

// One function per chain count, so each chain's pointer can live in its own
// register (or stack slot past about 14 chains) and the loads stay independent.
#define DEFINE_CHASE(K)                                                        \
    static __attribute__((noinline)) uintptr_t chase_##K(line_t **start,       \
                                                         size_t steps) {       \
        line_t *p[K];                                                          \
        for (int j = 0; j < K; j++) p[j] = start[j];                           \
        for (size_t s = 0; s < steps; s++) {                                   \
            _Pragma("GCC unroll 32") for (int j = 0; j < K; j++) p[j] =       \
                p[j]->next;                                                    \
        }                                                                      \
        uintptr_t x = 0;                                                       \
        for (int j = 0; j < K; j++) x ^= (uintptr_t)p[j];                      \
        return x;                                                              \
    }

DEFINE_CHASE(1) DEFINE_CHASE(2) DEFINE_CHASE(3) DEFINE_CHASE(4)
DEFINE_CHASE(5) DEFINE_CHASE(6) DEFINE_CHASE(7) DEFINE_CHASE(8)
DEFINE_CHASE(9) DEFINE_CHASE(10) DEFINE_CHASE(11) DEFINE_CHASE(12)
DEFINE_CHASE(13) DEFINE_CHASE(14) DEFINE_CHASE(15) DEFINE_CHASE(16)
DEFINE_CHASE(18) DEFINE_CHASE(20) DEFINE_CHASE(24) DEFINE_CHASE(28)
DEFINE_CHASE(32)

typedef uintptr_t (*chase_fn)(line_t **, size_t);

static chase_fn chase_for(int k) {
    switch (k) {
    case 1: return chase_1;   case 2: return chase_2;   case 3: return chase_3;
    case 4: return chase_4;   case 5: return chase_5;   case 6: return chase_6;
    case 7: return chase_7;   case 8: return chase_8;   case 9: return chase_9;
    case 10: return chase_10; case 11: return chase_11; case 12: return chase_12;
    case 13: return chase_13; case 14: return chase_14; case 15: return chase_15;
    case 16: return chase_16; case 18: return chase_18; case 20: return chase_20;
    case 24: return chase_24; case 28: return chase_28; case 32: return chase_32;
    default: return NULL;
    }
}

// Independent loads: the address of load i comes from an LCG, not from the
// previous load, so the out-of-order core can issue as many as it can track.
static __attribute__((noinline)) uint64_t independent(line_t *a, unsigned log2n,
                                                      size_t count, uint64_t x) {
    uint64_t sum = 0;
    for (size_t i = 0; i < count; i++) {
        x = x * 6364136223846793005ull + 1442695040888963407ull;
        sum += (uintptr_t)a[x >> (64 - log2n)].next;
    }
    return sum;
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

int main(int argc, char **argv) {
    if (argc != 7) {
        fprintf(stderr, "usage: %s array_mib accesses_per_run blocks seed 4k|2m chains\n", argv[0]);
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

    int configs[64], nconf = 0;
    for (char *tok = strtok(argv[6], ","); tok && nconf < 64; tok = strtok(NULL, ",")) {
        int k = atoi(tok);
        if (k != 0 && !chase_for(k)) {
            fprintf(stderr, "unsupported chain count %d\n", k);
            return 2;
        }
        configs[nconf++] = k;
    }

    size_t n = mib * 1024 * 1024 / LINE;
    unsigned log2n = 0;
    while (((size_t)1 << log2n) < n) log2n++;
    if (((size_t)1 << log2n) != n || n > UINT32_MAX) {
        fprintf(stderr, "array_mib must make a power-of-two line count below 2^32\n");
        return 2;
    }
    if (accesses > n) {
        fprintf(stderr, "accesses_per_run must not exceed the line count, so no line repeats in a run\n");
        return 2;
    }

    size_t bytes = n * LINE;
    line_t *a = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (a == MAP_FAILED) {
        perror("mmap");
        return 1;
    }
    if (madvise(a, bytes, huge ? MADV_HUGEPAGE : MADV_NOHUGEPAGE) != 0) perror("madvise");

    // order[p] is the line at position p of one random cycle through every
    // line (Sattolo's algorithm yields a uniformly random single cycle).
    uint32_t *order = malloc(n * sizeof *order);
    if (!order) {
        perror("malloc");
        return 1;
    }
    for (size_t i = 0; i < n; i++) order[i] = (uint32_t)i;
    for (size_t i = n - 1; i > 0; i--) {
        size_t j = below(i);
        uint32_t t = order[i];
        order[i] = order[j];
        order[j] = t;
    }
    for (size_t p = 0; p < n; p++) a[order[p]].next = &a[order[(p + 1) % n]];

    // Every line is reached by following next pointers from any line.
    {
        line_t *q = &a[0];
        size_t len = 0;
        do {
            q = q->next;
            len++;
        } while (q != &a[0] && len <= n);
        if (len != n) {
            fprintf(stderr, "cycle check failed: length %zu, lines %zu\n", len, n);
            return 1;
        }
    }

    cpu_set_t set;
    sched_getaffinity(0, sizeof set, &set);
    int cpu = -1;
    if (CPU_COUNT(&set) == 1)
        for (int c = 0; c < CPU_SETSIZE; c++)
            if (CPU_ISSET(c, &set)) cpu = c;

    printf("array_mib=%zu\nlines=%zu\naccesses_per_run=%zu\nblocks=%d\nseed=%s\n", mib, n,
           accesses, blocks, argv[4]);
    printf("pages=%s\nanon_huge_pages_kib=%ld\naffinity_cpu=%d\n", huge ? "2m" : "4k",
           anon_huge_kib(a), cpu);
    printf("csv\nblock,config,accesses,ns_per_access\n");
    fflush(stdout);

    line_t *start[MAX_CHAINS];
    uintptr_t sink = 0;
    // Warm-up: one short single-chain walk to settle frequency and page tables.
    start[0] = &a[order[below(n)]];
    sink ^= chase_1(start, n / 64);

    for (int b = 1; b <= blocks; b++) {
        int perm[64];
        for (int i = 0; i < nconf; i++) perm[i] = i;
        for (int i = nconf - 1; i > 0; i--) {
            int j = (int)below((uint64_t)i + 1);
            int t = perm[i];
            perm[i] = perm[j];
            perm[j] = t;
        }
        for (int i = 0; i < nconf; i++) {
            int k = configs[perm[i]];
            size_t done;
            double t0, t1;
            if (k == 0) {
                done = accesses;
                uint64_t x = splitmix64();
                t0 = now_ns();
                sink ^= independent(a, log2n, done, x);
                t1 = now_ns();
            } else {
                // Chains start N/k apart on the cycle at a random base, so
                // within one run no two chains touch the same line.
                size_t steps = accesses / (size_t)k;
                size_t base = below(n);
                for (int j = 0; j < k; j++) start[j] = &a[order[(base + (size_t)j * (n / k)) % n]];
                done = steps * (size_t)k;
                t0 = now_ns();
                sink ^= chase_for(k)(start, steps);
                t1 = now_ns();
            }
            printf("%d,%d,%zu,%.3f\n", b, k, done, (t1 - t0) / (double)done);
            fflush(stdout);
        }
    }
    printf("sink=%" PRIxPTR "\n", sink);
    return 0;
}
