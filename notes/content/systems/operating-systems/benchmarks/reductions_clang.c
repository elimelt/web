/* red_opt: the red_naive source loop, compiled with clang -O3 -march=native. */
#include <stddef.h>
#include <stdint.h>

uint64_t red_opt(const uint64_t *a, size_t n) {
    uint64_t s = 0;
    for (size_t i = 0; i < n; i++) s += a[i];
    return s;
}
