/* Array reduction benchmark: single-thread kernels and two ways of running a
 * kernel on T threads (a pthread_create/join per call, and a persistent pool).
 *
 *   reductions_bench sweep RUN SEED MAXBYTES   one JSON line per (variant, size)
 *   reductions_bench scale RUN BYTES           thread counts 1..nproc, pooled
 *   reductions_bench dispatch RUN              cost of an empty parallel call
 *   reductions_bench lines RUN BYTES           loads per cache line, single thread
 *   reductions_bench latency RUN BYTES         dependent loads to random lines (ns each)
 *   reductions_bench clock                     core clock from a dependent add chain
 */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/futex.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

typedef uint64_t (*kernel_fn)(const uint64_t *, size_t);
uint64_t red_naive(const uint64_t *, size_t);
uint64_t red_ilp(const uint64_t *, size_t);
uint64_t red_simd(const uint64_t *, size_t);
uint64_t red_ilp_simd(const uint64_t *, size_t);
uint64_t red_ilp_avx512(const uint64_t *, size_t);
uint64_t red_naive_scalar(const uint64_t *, size_t);
uint64_t red_ilp_scalar(const uint64_t *, size_t);
uint64_t red_opt(const uint64_t *, size_t);
uint64_t red_avx512_1(const uint64_t *, size_t);
uint64_t red_stride_scalar(const uint64_t *, size_t, size_t);
static uint64_t stride2(const uint64_t *a, size_t n) { return red_stride_scalar(a, n, 2); }
static uint64_t stride4(const uint64_t *a, size_t n) { return red_stride_scalar(a, n, 4); }
static uint64_t stride8(const uint64_t *a, size_t n) { return red_stride_scalar(a, n, 8); }

static double now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e9 + ts.tv_nsec;
}

static void pin(int cpu) {
    cpu_set_t s;
    CPU_ZERO(&s);
    CPU_SET(cpu, &s);
    pthread_setaffinity_np(pthread_self(), sizeof s, &s);
}

static int ncpu;

/* Split [0, n) into T chunks whose boundaries fall on 64-byte lines. */
static void chunk(size_t n, int T, int i, size_t *lo, size_t *hi) {
    size_t lines = (n + 7) / 8, per = lines / T, extra = lines % T;
    size_t l0 = i * per + (i < (int)extra ? (size_t)i : extra);
    size_t l1 = l0 + per + (i < (int)extra);
    *lo = l0 * 8 < n ? l0 * 8 : n;
    *hi = l1 * 8 < n ? l1 * 8 : n;
}

/* ---- pthread_create/join per call ---- */
typedef struct { kernel_fn fn; const uint64_t *a; size_t lo, hi; uint64_t out; int cpu; } spawn_arg;

static void *spawn_main(void *p) {
    spawn_arg *s = p;
    pin(s->cpu);
    s->out = s->fn(s->a + s->lo, s->hi - s->lo);
    return NULL;
}

/* A new thread inherits its creator's affinity mask (pthread_create(3)), and
 * the caller is pinned to CPU 0, so each thread gets its CPU at creation;
 * otherwise all four start on CPU 0 and run one after another until each
 * migrates itself. */
static uint64_t run_spawn(kernel_fn fn, const uint64_t *a, size_t n, int T) {
    pthread_t th[64];
    spawn_arg arg[64];
    for (int i = 0; i < T; i++) {
        arg[i] = (spawn_arg){fn, a, 0, 0, 0, i % ncpu};
        chunk(n, T, i, &arg[i].lo, &arg[i].hi);
        pthread_attr_t at;
        cpu_set_t set;
        CPU_ZERO(&set);
        CPU_SET(arg[i].cpu, &set);
        pthread_attr_init(&at);
        pthread_attr_setaffinity_np(&at, sizeof set, &set);
        pthread_create(&th[i], &at, spawn_main, &arg[i]);
        pthread_attr_destroy(&at);
    }
    uint64_t s = 0;
    for (int i = 0; i < T; i++) { pthread_join(th[i], NULL); s += arg[i].out; }
    return s;
}

/* ---- persistent pool: workers spin on a generation counter, then sleep on a
 * futex. The calling thread runs chunk 0 itself. ---- */
#define SPIN_ITERS 20000 /* about 1.3 ms of PAUSE at ~140 cycles each */
typedef struct { _Alignas(64) uint64_t v; } padded_u64;
static struct {
    _Alignas(64) _Atomic uint32_t gen;
    _Alignas(64) _Atomic int done;
    _Alignas(64) _Atomic int sleepers;
    kernel_fn fn;
    const uint64_t *a;
    size_t n;
    int T;          /* threads in the current job, including the caller */
    int nworkers;   /* worker threads alive */
    padded_u64 part[64];
} P;

static long futex(_Atomic uint32_t *addr, int op, uint32_t val) {
    return syscall(SYS_futex, (uint32_t *)addr, op, val, NULL, NULL, 0);
}

static void *pool_main(void *p) {
    int id = (int)(intptr_t)p;
    pin(id % ncpu);
    uint32_t seen = 0;
    for (;;) {
        uint32_t g;
        int spins = 0;
        while ((g = atomic_load_explicit(&P.gen, memory_order_acquire)) == seen) {
            if (spins++ < SPIN_ITERS) { __builtin_ia32_pause(); continue; }
            atomic_fetch_add(&P.sleepers, 1);
            futex(&P.gen, FUTEX_WAIT_PRIVATE, seen);
            atomic_fetch_sub(&P.sleepers, 1);
            spins = 0;
        }
        seen = g;
        if (id < P.T) {
            size_t lo, hi;
            chunk(P.n, P.T, id, &lo, &hi);
            P.part[id].v = P.fn(P.a + lo, hi - lo);
            atomic_fetch_add_explicit(&P.done, 1, memory_order_release);
        }
    }
    return NULL;
}

static void pool_start(int nworkers) {
    P.nworkers = nworkers;
    for (int i = 1; i <= nworkers; i++) {
        pthread_t t;
        pthread_attr_t at;
        cpu_set_t set;
        CPU_ZERO(&set);
        CPU_SET(i % ncpu, &set);
        pthread_attr_init(&at);
        pthread_attr_setaffinity_np(&at, sizeof set, &set);
        pthread_create(&t, &at, pool_main, (void *)(intptr_t)i);
        pthread_attr_destroy(&at);
        pthread_detach(t);
    }
}

static uint64_t run_pool(kernel_fn fn, const uint64_t *a, size_t n, int T) {
    P.fn = fn; P.a = a; P.n = n; P.T = T;
    atomic_store_explicit(&P.done, 0, memory_order_relaxed);
    atomic_fetch_add_explicit(&P.gen, 1, memory_order_release);
    if (atomic_load(&P.sleepers) > 0) futex(&P.gen, FUTEX_WAKE_PRIVATE, INT32_MAX);
    size_t lo, hi;
    chunk(n, T, 0, &lo, &hi);
    uint64_t s = fn(a + lo, hi - lo);
    while (atomic_load_explicit(&P.done, memory_order_acquire) < T - 1) __builtin_ia32_pause();
    for (int i = 1; i < T; i++) s += P.part[i].v;
    return s;
}

/* ---- variants ---- */
typedef struct { const char *name; kernel_fn fn; int mode; } variant; /* mode 0 single, 1 spawn, 2 pool */
static const variant V[] = {
    {"naive_scalar", red_naive_scalar, 0},
    {"ilp_scalar", red_ilp_scalar, 0},
    {"naive", red_naive, 0},
    {"ilp", red_ilp, 0},
    {"simd", red_simd, 0},
    {"ilp_simd", red_ilp_simd, 0},
    {"ilp_avx512", red_ilp_avx512, 0},
    {"opt", red_opt, 0},
    {"thread_spawn", red_naive, 1},
    {"thread_pool", red_naive, 2},
    {"all_spawn", red_ilp_simd, 1},
    {"all_pool", red_ilp_simd, 2},
};
#define NV (int)(sizeof V / sizeof V[0])

static uint64_t run(const variant *v, const uint64_t *a, size_t n, int T) {
    if (v->mode == 0) return v->fn(a, n);
    if (v->mode == 1) return run_spawn(v->fn, a, n, T);
    return run_pool(v->fn, a, n, T);
}

static uint64_t *alloc_array(size_t bytes, uint64_t seed) {
    size_t sz = (bytes + (2u << 20) - 1) & ~(size_t)((2u << 20) - 1);
    uint64_t *a = mmap(NULL, sz, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (a == MAP_FAILED) { perror("mmap"); exit(1); }
    madvise(a, sz, MADV_HUGEPAGE);
    uint64_t x = seed * 0x9E3779B97F4A7C15ull + 1;
    for (size_t i = 0; i < bytes / 8; i++) { /* splitmix64 */
        uint64_t z = (x += 0x9E3779B97F4A7C15ull);
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
        a[i] = z ^ (z >> 31);
    }
    return a;
}

static volatile uint64_t sink;

/* Time one cell: calls per sample chosen so a sample lasts >= 2 ms (at least
 * one call), 9 samples below 64 MiB and 5 above. Prints per-call ns. */
static void cell(int runid, const variant *v, const uint64_t *a, size_t bytes, int T, uint64_t ref) {
    size_t n = bytes / 8;
    uint64_t got = run(v, a, n, T); /* warm-up and check */
    double t0 = now_ns();
    got = run(v, a, n, T);
    double one = now_ns() - t0;
    long calls = one > 2e6 ? 1 : (long)(2e6 / (one > 1 ? one : 1)) + 1;
    int samples = bytes >= (64u << 20) ? 5 : 9;
    printf("{\"run\":%d,\"variant\":\"%s\",\"threads\":%d,\"bytes\":%zu,\"calls\":%ld,\"ok\":%s,\"ns_per_call\":[",
           runid, v->name, v->mode ? T : 1, bytes, calls, got == ref ? "true" : "false");
    for (int s = 0; s < samples; s++) {
        t0 = now_ns();
        for (long c = 0; c < calls; c++) sink += run(v, a, n, T);
        double dt = (now_ns() - t0) / calls;
        printf("%s%.1f", s ? "," : "", dt);
    }
    printf("]}\n");
    fflush(stdout);
}

static double clock_ghz(void) {
    /* 8 dependent register-register adds per iteration (1-cycle latency);
     * dec/jnz run alongside. Register operands, because Golden Cove can
     * execute chains of add-immediate faster than one per cycle. */
    long iters = 100000000;
    uint64_t x = 0, y = 1, best = ~0ull;
    double best_ns = 1e30;
    for (int r = 0; r < 5; r++) {
        long it = iters;
        double t0 = now_ns();
        __asm__ volatile("1:\n\t"
                         "add %2,%0\n\tadd %2,%0\n\tadd %2,%0\n\tadd %2,%0\n\t"
                         "add %2,%0\n\tadd %2,%0\n\tadd %2,%0\n\tadd %2,%0\n\t"
                         "dec %1\n\tjnz 1b\n"
                         : "+r"(x), "+r"(it)
                         : "r"(y));
        double dt = now_ns() - t0;
        if (dt < best_ns) best_ns = dt;
    }
    (void)best;
    sink = x;
    return 8.0 * iters / best_ns;
}

int main(int argc, char **argv) {
    ncpu = (int)sysconf(_SC_NPROCESSORS_ONLN);
    if (ncpu > 64) ncpu = 64;
    pin(0);
    if (argc < 2) { fprintf(stderr, "usage: see header\n"); return 2; }
    if (!strcmp(argv[1], "clock")) {
        for (int i = 0; i < 3; i++) printf("{\"clock_ghz\":%.4f}\n", clock_ghz());
        return 0;
    }
    pool_start(ncpu - 1);
    if (!strcmp(argv[1], "dispatch")) {
        int runid = atoi(argv[2]);
        uint64_t dummy[8] = {0};
        const char *names[] = {"spawn", "pool_hot", "pool_cold"};
        for (int k = 0; k < 3; k++) {
            printf("{\"run\":%d,\"dispatch\":\"%s\",\"threads\":%d,\"ns_per_call\":[", runid, names[k], ncpu);
            for (int s = 0; s < 200; s++) {
                if (k == 2) { struct timespec ts = {0, 5000000}; nanosleep(&ts, NULL); } /* workers fall asleep */
                else if (k == 1) run_pool(red_naive, dummy, 0, ncpu);                    /* workers spinning */
                double t0 = now_ns();
                sink += k == 0 ? run_spawn(red_naive, dummy, 0, ncpu) : run_pool(red_naive, dummy, 0, ncpu);
                printf("%s%.0f", s ? "," : "", now_ns() - t0);
            }
            printf("]}\n");
        }
        return 0;
    }
    if (!strcmp(argv[1], "sweep")) {
        int runid = atoi(argv[2]);
        uint64_t seed = strtoull(argv[3], NULL, 10);
        size_t maxb = strtoull(argv[4], NULL, 10);
        uint64_t *a = alloc_array(maxb, seed);
        int order[NV];
        for (int i = 0; i < NV; i++) order[i] = i;
        uint64_t r = seed * 2654435761u + 7;
        for (size_t bytes = 16384; bytes <= maxb; bytes *= 2) {
            uint64_t ref = red_naive_scalar(a, bytes / 8);
            for (int i = NV - 1; i > 0; i--) { /* new variant order for every size */
                r = r * 6364136223846793005ull + 1442695040888963407ull;
                int j = (int)((r >> 33) % (uint64_t)(i + 1)), t = order[i];
                order[i] = order[j]; order[j] = t;
            }
            for (int i = 0; i < NV; i++) cell(runid, &V[order[i]], a, bytes, ncpu, ref);
        }
        return 0;
    }
    if (!strcmp(argv[1], "lines")) {
        /* Every kernel touches every line of the array once; they differ in
         * how many loads they issue per line. Results are not compared with a
         * reference sum because strided kernels skip elements. */
        int runid = atoi(argv[2]);
        size_t bytes = strtoull(argv[3], NULL, 10);
        uint64_t *a = alloc_array(bytes, 1);
        const variant L[] = {
            {"scalar_8_per_line", red_naive_scalar, 0},
            {"scalar_4_per_line", stride2, 0},
            {"scalar_2_per_line", stride4, 0},
            {"scalar_1_per_line", stride8, 0},
            {"ymm_2_per_line", red_simd, 0},
            {"zmm_1_per_line", red_avx512_1, 0},
            {"zmm4_1_per_line", red_ilp_avx512, 0},
        };
        for (int i = 0; i < 7; i++) cell(runid, &L[i], a, bytes, 1, L[i].fn(a, bytes / 8));
        return 0;
    }
    if (!strcmp(argv[1], "latency")) {
        /* One 64-byte node per line, linked in a single random cycle
         * (Sattolo's algorithm), so every load depends on the previous one. */
        int runid = atoi(argv[2]);
        size_t bytes = strtoull(argv[3], NULL, 10), nodes = bytes / 64;
        uint64_t *a = alloc_array(bytes, 1);
        size_t *perm = malloc(nodes * sizeof *perm);
        for (size_t i = 0; i < nodes; i++) perm[i] = i;
        uint64_t r = 88172645463325252ull + (uint64_t)runid;
        for (size_t i = nodes - 1; i > 0; i--) {
            r ^= r << 13; r ^= r >> 7; r ^= r << 17;
            size_t j = r % i, t = perm[i];
            perm[i] = perm[j]; perm[j] = t;
        }
        for (size_t i = 0; i < nodes; i++) a[perm[i] * 8] = perm[(i + 1) % nodes] * 8;
        free(perm);
        size_t steps = 20000000, p = 0;
        for (size_t i = 0; i < 1000000; i++) p = a[p];
        printf("{\"run\":%d,\"latency_bytes\":%zu,\"ns_per_load\":[", runid, bytes);
        for (int k = 0; k < 5; k++) {
            double t0 = now_ns();
            for (size_t i = 0; i < steps; i++) p = a[p];
            printf("%s%.2f", k ? "," : "", (now_ns() - t0) / steps);
        }
        printf("]}\n");
        sink = p;
        return 0;
    }
    if (!strcmp(argv[1], "scale")) {
        int runid = atoi(argv[2]);
        size_t bytes = strtoull(argv[3], NULL, 10);
        uint64_t *a = alloc_array(bytes, 1);
        uint64_t ref = red_naive_scalar(a, bytes / 8);
        for (int T = 1; T <= ncpu; T++) {
            cell(runid, &V[9], a, bytes, T, ref);  /* thread_pool */
            cell(runid, &V[11], a, bytes, T, ref); /* all_pool */
        }
        return 0;
    }
    return 2;
}
