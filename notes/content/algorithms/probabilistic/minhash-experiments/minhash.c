// MinHash signatures: for each set and each of K hash functions
// h_i(x) = mix(x XOR s_i), with mix the splitmix64 finalizer and s_i drawn
// from a splitmix64 stream with the given seed, the signature holds
// min over x in the set of h_i(x). The shingle values are already 64-bit
// BLAKE2b hashes, so h_i acts as a seeded rehash of them.
//
// Usage: minhash K SEED sets.u64 offsets.i64 out.u64   (out: n x K, row-major)
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static inline uint64_t mix(uint64_t z) {
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}
static void *readall(const char *p, size_t *n) {
  FILE *f = fopen(p, "rb");
  fseek(f, 0, SEEK_END); *n = ftell(f); rewind(f);
  void *b = malloc(*n);
  if (fread(b, 1, *n, f) != *n) exit(2);
  fclose(f);
  return b;
}

int main(int argc, char **argv) {
  int K = atoi(argv[1]);
  uint64_t st = strtoull(argv[2], 0, 10);
  size_t nb, no;
  uint64_t *tok = readall(argv[3], &nb);
  int64_t *off = readall(argv[4], &no);
  size_t n = no / 8 - 1;
  uint64_t *seed = malloc(K * 8);
  for (int i = 0; i < K; i++) { st += 0x9e3779b97f4a7c15ULL; seed[i] = mix(st); }
  uint64_t *sig = malloc(n * K * 8);
  struct timespec a, b;
  clock_gettime(CLOCK_MONOTONIC, &a);
  for (size_t d = 0; d < n; d++) {
    uint64_t *s = sig + d * K;
    for (int i = 0; i < K; i++) s[i] = UINT64_MAX;
    for (int64_t p = off[d]; p < off[d + 1]; p++) {
      uint64_t x = tok[p];
      for (int i = 0; i < K; i++) { uint64_t h = mix(x ^ seed[i]); if (h < s[i]) s[i] = h; }
    }
  }
  clock_gettime(CLOCK_MONOTONIC, &b);
  double sec = (b.tv_sec - a.tv_sec) + 1e-9 * (b.tv_nsec - a.tv_nsec);
  FILE *f = fopen(argv[5], "wb");
  fwrite(sig, 8, n * K, f);
  fclose(f);
  fprintf(stderr, "sets %zu shingles %zu K %d seconds %.2f ns_per_shingle_hash %.3f\n", n, nb / 8, K, sec,
          1e9 * sec / ((double)(nb / 8) * K));
  return 0;
}
