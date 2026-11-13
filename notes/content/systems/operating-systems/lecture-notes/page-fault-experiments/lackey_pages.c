// Reads valgrind lackey --trace-mem=yes output on stdin and writes the page
// reference string (4 KiB pages, little-endian uint64) to argv[1], dropping a
// reference when it is to the same page as the one before it. Prints counts.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
  FILE *out = fopen(argv[1], "wb");
  static char line[256];
  uint64_t last = UINT64_MAX, raw = 0, kept = 0, instr = 0;
  static uint64_t buf[1 << 16];
  int n = 0;
  while (fgets(line, sizeof line, stdin)) {
    char *s = line;
    while (*s == ' ') s++;
    char kind = *s;
    if (kind != 'I' && kind != 'L' && kind != 'S' && kind != 'M') continue;
    s++;
    while (*s == ' ') s++;
    char *end;
    uint64_t addr = strtoull(s, &end, 16);
    if (*end != ',') continue;
    uint64_t size = strtoull(end + 1, NULL, 10);
    raw++;
    if (kind == 'I') { instr++; if (getenv("DATA_ONLY")) continue; }
    for (uint64_t pg = addr >> 12; pg <= (addr + (size ? size - 1 : 0)) >> 12; pg++) {
      if (pg != last) {
        buf[n++] = pg;
        kept++;
        last = pg;
        if (n == (1 << 16)) { fwrite(buf, 8, n, out); n = 0; }
      }
    }
  }
  fwrite(buf, 8, n, out);
  fclose(out);
  fprintf(stderr, "{\"raw_accesses\":%llu,\"instruction_fetches\":%llu,\"page_refs\":%llu}\n",
          (unsigned long long)raw, (unsigned long long)instr, (unsigned long long)kept);
  return 0;
}
