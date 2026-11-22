// Update cost of each summary on the pageview stream in file order, one
// thread, three repetitions: nanoseconds per record.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "hh.h"

typedef struct __attribute__((packed)) { uint64_t k; uint32_t c; } rec;

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + 1e-9 * t.tv_nsec; }

int main(void) {
  FILE *fs = fopen("stream.bin", "rb");
  fseek(fs, 0, SEEK_END); size_t T = ftell(fs) / sizeof(rec); rewind(fs);
  rec *S = malloc(T * sizeof(rec));
  if (fread(S, sizeof(rec), T, fs) != T) return 2;
  fclose(fs);
  const char *names[] = {"mg", "ss", "cs", "cms", "cu"};
  int ms[] = {1000, 64000};
  volatile int64_t sink = 0;
  for (int mi = 0; mi < 2; mi++)
    for (int a = 0; a < 5; a++)
      for (int rep = 0; rep < 3; rep++) {
        int m = ms[mi];
        summary *s; sketch *sk = NULL;
        if (a == 0) s = summary_new(m, SUM_MG);
        else if (a == 1) s = summary_new(m, SUM_SS);
        else { int d = a == 2 ? 5 : 4; sk = sketch_new(a == 2 ? SK_CS : a == 3 ? SK_CMS : SK_CU, d, 3 * m / d, rep + 1); s = summary_new(m / 4, SUM_TOPK); }
        double t0 = now();
        for (size_t t = 0; t < T; t++) {
          uint64_t k = S[t].k, c = S[t].c;
          if (sk) topk_offer(s, k, sketch_update(sk, k, c));
          else if (a == 1) ss_update(s, k, c);
          else mg_update(s, k, c);
        }
        double dt = now() - t0;
        sink += s->n;
        printf("%s m=%d rep=%d ns_per_record=%.2f\n", names[a], m, rep, 1e9 * dt / T);
        fflush(stdout);
        summary_free(s); if (sk) sketch_free(sk);
      }
  return (int)(sink & 0);
}
