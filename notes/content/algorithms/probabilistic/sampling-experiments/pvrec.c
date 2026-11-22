// Reads the 24 hourly pageview files and writes, for every record in file
// order, {uint16 project, uint8 hour, uint8 pad, uint32 views} to recs.bin,
// and the project codes with their record and view totals to projects.tsv.
// Usage: pvrec FILE...   (files in hour order)
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { uint16_t p; uint8_t h, pad; uint32_t c; } rec;
static char names[4096][64];
static uint64_t nrec[4096], nview[4096];
static int np;

int main(int argc, char **argv) {
  FILE *out = fopen("recs.bin", "wb");
  char cmd[4096], *line = NULL; size_t cap = 0; ssize_t len;
  uint64_t total = 0, views = 0, bad = 0;
  for (int f = 1; f < argc; f++) {
    snprintf(cmd, sizeof cmd, "zcat '%s'", argv[f]);
    FILE *in = popen(cmd, "r");
    while ((len = getline(&line, &cap, in)) > 0) {
      char *a = strtok(line, " "), *t = strtok(NULL, " "), *c = strtok(NULL, " ");
      if (!a || !t || !c) { bad++; continue; }
      long v = strtol(c, NULL, 10);
      if (v <= 0) { bad++; continue; }
      int p;
      for (p = 0; p < np; p++) if (strcmp(names[p], a) == 0) break;
      if (p == np) { if (np == 4096) return 3; strncpy(names[np++], a, 63); }
      rec r = {(uint16_t)p, (uint8_t)(f - 1), 0, (uint32_t)v};
      fwrite(&r, sizeof r, 1, out);
      nrec[p]++; nview[p] += v; total++; views += v;
    }
    pclose(in);
    fprintf(stderr, "hour %d records %llu\n", f - 1, (unsigned long long)total);
  }
  fclose(out);
  FILE *pt = fopen("projects.tsv", "w");
  for (int p = 0; p < np; p++) fprintf(pt, "%d\t%s\t%llu\t%llu\n", p, names[p], (unsigned long long)nrec[p], (unsigned long long)nview[p]);
  fclose(pt);
  fprintf(stderr, "records %llu views %llu skipped %llu projects %d\n", (unsigned long long)total, (unsigned long long)views, (unsigned long long)bad, np);
  return 0;
}
