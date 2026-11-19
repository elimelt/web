// Counts the distinct values of the third LevelDB probe, h + 2*delta with
// delta = rotr(h, 17), over all 2^32 values of the 32-bit hash h.
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
int main(void) {
  for (int j = 0; j < 6; j++) {
    uint64_t *seen = calloc(1ULL << 26, 8); uint64_t distinct = 0;
    for (uint64_t x = 0; x < (1ULL << 32); x++) {
      uint32_t h = (uint32_t)x, d = (h >> 17) | (h << 15), p = h + (uint32_t)j * d;
      uint64_t w = p >> 6, b = 1ULL << (p & 63);
      if (!(seen[w] & b)) { seen[w] |= b; distinct++; }
    }
    printf("probe %d: %lu distinct values of 2^32\n", j, distinct); free(seen);
  }
}
