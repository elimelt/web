// Writes the figure's substream: the records whose 64-bit key hash has its
// top 12 bits zero (every record of 1/4,096 of the pages), in file order, as
// {u16 project, u8 hour, u32 views} lines of text.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
typedef struct { uint16_t p; uint8_t h, pad; uint32_t c; } rec;
#pragma pack(push, 1)
typedef struct { uint64_t k; uint32_t c; } srec;
#pragma pack(pop)
int main(void) {
  FILE *a = fopen("recs.bin", "rb"), *b = fopen("stream.bin", "rb");
  rec r; srec s;
  while (fread(&r, sizeof r, 1, a) == 1 && fread(&s, sizeof s, 1, b) == 1)
    if ((s.k >> 52) == 0) printf("%u %u %u\n", r.p, r.h, r.c);
  return 0;
}
