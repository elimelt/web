// Writes the records of the pageview stream whose key hash lies in the lowest
// 1/4096 of the hash range, in file order, as text lines
// "hour key_hash count domain title".  The selection depends on the key alone,
// so every record of a selected page is kept and none of any other page.
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "murmur.h"
int main(void) {
  char *line = NULL; size_t cap = 0; ssize_t len; int hour = -1;
  while ((len = getline(&line, &cap, stdin)) > 0) {
    if (line[0] == '#' && line[1] == 'H') { hour++; continue; }
    char *s1 = memchr(line, ' ', len); if (!s1) continue;
    char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); if (!s2) continue;
    unsigned long c = strtoul(s2 + 1, NULL, 10); if (c == 0) continue;
    uint64_t h = murmur64a(line, s2 - line, 0x9747b28cULL); if (h == 0) h = 1;
    if ((h >> 52) != 0) continue;
    printf("%d %llu %lu %.*s\n", hour, (unsigned long long)h, c, (int)(s2 - line), line);
  }
  return 0;
}
