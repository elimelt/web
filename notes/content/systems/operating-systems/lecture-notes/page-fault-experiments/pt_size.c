// How much memory the page tables take for the same amount of touched data,
// laid out densely or sparsely. Reads VmPTE from /proc/self/status.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>

static long vm(const char *key) {
  FILE *f = fopen("/proc/self/status", "r"); char line[256]; long kb = -1; size_t n = strlen(key);
  while (fgets(line, sizeof line, f)) if (!strncmp(line, key, n)) kb = atol(line + n + 1);
  fclose(f); return kb;
}

// Touch `count` 4 KiB pages spaced `stride` bytes apart in a fresh child process.
static void run(const char *name, long count, long stride) {
  if (fork() == 0) {
    long before = vm("VmPTE");
    long span = count * stride;
    char *a = mmap(NULL, span, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
    if (a == MAP_FAILED) { perror("mmap"); _exit(1); }
    madvise(a, span, MADV_NOHUGEPAGE);
    for (long i = 0; i < count; i++) a[i * stride] = 1;
    long after = vm("VmPTE");
    printf("{\"layout\":\"%s\",\"pages_touched\":%ld,\"data_kib\":%ld,\"span_gib\":%.3f,\"page_table_kib\":%ld}\n",
           name, count, count * 4, span / 1073741824.0, after - before);
    fflush(stdout);
    _exit(0);
  }
  wait(NULL);
}

int main(void) {
  long n = 4096; // 16 MiB of data in every layout
  run("dense: every 4 KiB page", n, 4096);
  run("one page per 2 MiB", n, 2L << 20);
  run("one page per 1 GiB", n, 1L << 30);
  return 0;
}
