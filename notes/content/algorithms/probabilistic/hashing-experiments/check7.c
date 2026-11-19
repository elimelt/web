// HyperLogLog (p = 14, Ertl) on the hour-0 key strings with polycw7, 8 seeds.
#include <stdio.h>
#include <stdlib.h>
#include "common.h"
int main(void) {
  static char line[1 << 16]; size_t cap = 1 << 28, used = 0; char *buf = malloc(cap);
  uint32_t *off = malloc(8000000 * 4), *ln = malloc(8000000 * 4); long ns = 0;
  while (fgets(line, sizeof line, stdin)) { char *sp = strchr(line, ' '); if (!sp) continue; sp = strchr(sp + 1, ' '); if (!sp) continue;
    size_t kl = sp - line; memcpy(buf + used, line, kl); off[ns] = used; ln[ns] = kl; used += kl; ns++; }
  uint64_t s = 7; uint8_t *reg = malloc(1 << 14);
  for (int t = 0; t < 8; t++) { uint64_t a = sm(&s) % (P61 - 1) + 1, b = sm(&s) % (P61 - 1) + 1, c = sm(&s) % P61; memset(reg, 0, 1 << 14);
    for (long i = 0; i < ns; i++) hll_add(reg, 14, polycw7((unsigned char *)buf + off[i], ln[i], a, b, c), 64);
    printf("%d %+.4f\n", t, ertl_est(reg, 14, 64) / ns - 1); }
  return 0; }
