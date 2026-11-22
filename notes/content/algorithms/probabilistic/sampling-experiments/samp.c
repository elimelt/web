// Stream sampling experiments on the pageview records.
//
//   samp speed K                 Algorithm R and Algorithm L over all records:
//                                time per record and random numbers drawn.
//   samp uniform N K RUNS        inclusion count of each position 0..N-1 by
//                                Algorithm L over RUNS runs (prints counts).
//   samp subsets K TRIALS SEED   for each trial, a uniform reservoir (L), a
//                                priority sample and a PPSWOR (Efraimidis-
//                                Spirakis) sample of size K, weighted by views;
//                                prints each method's estimate of every subset
//                                sum, with priority sampling's variance estimate.
// Reads recs.bin ({u16 project, u8 hour, u8 pad, u32 views}) and stream.bin
// ({u64 key hash, u32 views}, packed), which list the same records in order.
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct { uint16_t p; uint8_t h, pad; uint32_t c; } rec;
#pragma pack(push, 1)
typedef struct { uint64_t k; uint32_t c; } srec;
#pragma pack(pop)

static uint64_t s[4];
static inline uint64_t rotl(uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
static inline uint64_t next(void) {
  uint64_t r = rotl(s[1] * 5, 7) * 9, t = s[1] << 17;
  s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 45);
  return r;
}
static uint64_t draws;
// Uniform on (0, 1].
static inline double unif(void) { draws++; return ((next() >> 11) + 1) * 0x1.0p-53; }
static void seed(uint64_t x) {
  for (int i = 0; i < 4; i++) { x += 0x9e3779b97f4a7c15ULL; uint64_t z = x;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; s[i] = z ^ (z >> 31); }
}
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + 1e-9 * t.tv_nsec; }

static rec *R; static srec *SR; static size_t n;
static void load(int need_keys) {
  FILE *f = fopen("recs.bin", "rb"); fseek(f, 0, SEEK_END); n = ftell(f) / sizeof(rec); rewind(f);
  R = malloc(n * sizeof(rec)); if (fread(R, sizeof(rec), n, f) != n) exit(2); fclose(f);
  if (!need_keys) return;
  f = fopen("stream.bin", "rb"); fseek(f, 0, SEEK_END);
  if ((size_t)ftell(f) / sizeof(srec) != n) { fprintf(stderr, "length mismatch\n"); exit(3); }
  rewind(f); SR = malloc(n * sizeof(srec)); if (fread(SR, sizeof(srec), n, f) != n) exit(2); fclose(f);
  for (size_t i = 0; i < n; i++) if (SR[i].c != R[i].c) { fprintf(stderr, "views mismatch at %zu\n", i); exit(4); }
}

// Algorithm R: keep the first K; record t (0-based) replaces a random slot
// with probability K/(t+1).
static size_t algR(size_t N, size_t K, uint32_t *res) {
  size_t sum = 0;
  for (size_t t = 0; t < N; t++) {
    if (t < K) { res[t] = t; continue; }
    size_t j = (size_t)(unif() * (double)(t + 1));
    if (j < K) res[j] = t;
  }
  for (size_t i = 0; i < K; i++) sum += res[i];
  return sum;
}
// Algorithm L (Li 1994): skip a geometric number of records between
// replacements.
static size_t algL(size_t N, size_t K, uint32_t *res) {
  size_t sum = 0;
  for (size_t t = 0; t < K && t < N; t++) res[t] = t;
  double W = exp(log(unif()) / K);
  size_t t = K - 1;
  for (;;) {
    t += (size_t)floor(log(unif()) / log1p(-W)) + 1;
    if (t >= N) break;
    res[(size_t)(unif() * K)] = t;
    W *= exp(log(unif()) / K);
  }
  for (size_t i = 0; i < K; i++) sum += res[i];
  return sum;
}

// Min-heap of (key, index) keeping the K largest keys seen.
typedef struct { double key; uint32_t i; } he;
static he *H; static size_t hs;
static void hpush_top(double key, uint32_t i, size_t K) {
  if (hs < K) { size_t c = hs++; while (c && H[(c - 1) / 2].key > key) { H[c] = H[(c - 1) / 2]; c = (c - 1) / 2; } H[c] = (he){key, i}; return; }
  size_t c = 0;
  for (;;) { size_t l = 2 * c + 1, r = l + 1, m = c; double mk = key;
    if (l < K && H[l].key < mk) { m = l; mk = H[l].key; }
    if (r < K && H[r].key < mk) { m = r; }
    if (m == c) break; H[c] = H[m]; c = m; }
  H[c] = (he){key, i};
}

#define NSUB 64
static int nsub; static int subkind[NSUB], subarg[NSUB];
static inline int insub(int s, size_t i) {
  switch (subkind[s]) {
    case 0: return R[i].p == subarg[s];
    case 1: return R[i].h == subarg[s];
    case 2: return SR[i].k % (uint64_t)subarg[s] == 0;
    default: return 1;
  }
}

int main(int argc, char **argv) {
  if (!strcmp(argv[1], "speed")) {
    load(0);
    size_t K = strtoull(argv[2], 0, 10);
    uint32_t *res = malloc(K * 4);
    for (int rep = 0; rep < 3; rep++) {
      seed(rep); draws = 0; double a = now(); size_t x = algR(n, K, res); double b = now();
      printf("R K %zu ns_per_record %.3f draws %llu check %zu\n", K, 1e9 * (b - a) / n, (unsigned long long)draws, x % 7);
      seed(rep); draws = 0; a = now(); x = algL(n, K, res); b = now();
      printf("L K %zu ns_per_record %.3f draws %llu check %zu\n", K, 1e9 * (b - a) / n, (unsigned long long)draws, x % 7);
    }
    return 0;
  }
  if (!strcmp(argv[1], "uniform")) {
    size_t N = strtoull(argv[2], 0, 10), K = strtoull(argv[3], 0, 10), runs = strtoull(argv[4], 0, 10);
    uint32_t *res = malloc(K * 4); uint64_t *cnt = calloc(N, 8);
    seed(7);
    for (size_t r = 0; r < runs; r++) { algL(N, K, res); for (size_t i = 0; i < K; i++) cnt[res[i]]++; }
    for (size_t i = 0; i < N; i++) printf("%llu\n", (unsigned long long)cnt[i]);
    return 0;
  }
  // subsets
  load(1);
  size_t K = strtoull(argv[2], 0, 10); int trials = atoi(argv[3]); uint64_t sd = strtoull(argv[4], 0, 10);
  // Subsets: the projects given in SUBSETS env as p:ID, h:HOUR, m:MOD, all.
  char *spec = strdup(getenv("SUBSETS"));
  for (char *tok = strtok(spec, ","); tok; tok = strtok(NULL, ",")) {
    if (tok[0] == 'p') { subkind[nsub] = 0; subarg[nsub++] = atoi(tok + 2); }
    else if (tok[0] == 'h') { subkind[nsub] = 1; subarg[nsub++] = atoi(tok + 2); }
    else if (tok[0] == 'm') { subkind[nsub] = 2; subarg[nsub++] = atoi(tok + 2); }
    else { subkind[nsub] = 3; subarg[nsub++] = 0; }
  }
  double truth[NSUB] = {0}; uint64_t cnt[NSUB] = {0};
  for (size_t i = 0; i < n; i++) for (int j = 0; j < nsub; j++) if (insub(j, i)) { truth[j] += R[i].c; cnt[j]++; }
  printf("truth");
  for (int j = 0; j < nsub; j++) printf(" %.0f:%llu", truth[j], (unsigned long long)cnt[j]);
  printf("\n");
  uint32_t *res = malloc(K * 4); H = malloc((K + 1) * sizeof(he));
  for (int tr = 0; tr < trials; tr++) {
    double est[NSUB];
    // Uniform reservoir, Horvitz-Thompson: n/K times the sampled sum.
    seed(sd * 1000003 + tr * 3);
    algL(n, K, res);
    memset(est, 0, sizeof est);
    for (size_t i = 0; i < K; i++) for (int j = 0; j < nsub; j++) if (insub(j, res[i])) est[j] += (double)n / K * R[res[i]].c;
    printf("uniform %d", tr); for (int j = 0; j < nsub; j++) printf(" %.1f", est[j]); printf("\n");
    // Priority sampling: priority w/u, keep the K largest, tau = (K+1)-th largest.
    seed(sd * 1000003 + tr * 3 + 1);
    hs = 0;
    for (size_t i = 0; i < n; i++) { double q = R[i].c / unif(); if (hs < K + 1 || q > H[0].key) hpush_top(q, (uint32_t)i, K + 1); }
    double tau = H[0].key; double var[NSUB];
    memset(est, 0, sizeof est); memset(var, 0, sizeof var);
    for (size_t h = 1; h < K + 1; h++) { uint32_t i = H[h].i; double w = R[i].c, e = w > tau ? w : tau;
      for (int j = 0; j < nsub; j++) if (insub(j, i)) { est[j] += e; var[j] += w < tau ? tau * (tau - w) : 0; } }
    // The heap root is the (K+1)-th largest and is not in the sample.
    printf("priority %d", tr); for (int j = 0; j < nsub; j++) printf(" %.1f:%.1f", est[j], var[j]); printf("\n");
    // PPSWOR (Efraimidis-Spirakis): key u^(1/w), keep the K largest; written as
    // rank r = -ln(u)/w ~ Exp(w), keep the K smallest. With tau the (K+1)-th
    // smallest rank, each sampled item is weighted w / (1 - exp(-w tau))
    // (rank-conditioning estimator of Cohen and Kaplan).
    seed(sd * 1000003 + tr * 3 + 2);
    hs = 0;
    for (size_t i = 0; i < n; i++) { double q = R[i].c / -log(unif()); if (hs < K + 1 || q > H[0].key) hpush_top(q, (uint32_t)i, K + 1); }
    double rt = 1.0 / H[0].key;
    memset(est, 0, sizeof est);
    for (size_t h = 1; h < K + 1; h++) { uint32_t i = H[h].i; double w = R[i].c, e = w / -expm1(-w * rt);
      for (int j = 0; j < nsub; j++) if (insub(j, i)) est[j] += e; }
    printf("ppswor %d", tr); for (int j = 0; j < nsub; j++) printf(" %.1f", est[j]); printf("\n");
    fflush(stdout);
  }
  return 0;
}
