/* The same two source loops as red_naive and red_ilp, compiled with
 * -fno-tree-vectorize so that the add instructions stay scalar. */
#include <stddef.h>
#include <stdint.h>

uint64_t red_naive_scalar(const uint64_t *a, size_t n) {
    uint64_t s = 0;
    for (size_t i = 0; i < n; i++) s += a[i];
    return s;
}

uint64_t red_ilp_scalar(const uint64_t *a, size_t n) {
    uint64_t s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
    size_t i = 0;
    for (; i + 8 <= n; i += 8) {
        s0 += a[i + 0]; s1 += a[i + 1]; s2 += a[i + 2]; s3 += a[i + 3];
        s4 += a[i + 4]; s5 += a[i + 5]; s6 += a[i + 6]; s7 += a[i + 7];
    }
    for (; i < n; i++) s0 += a[i];
    return s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7;
}

/* One scalar load per `stride` elements. With stride 1, 2, 4 or 8 the loop
 * still touches every 64-byte line, with 8, 4, 2 or 1 loads per line. */
uint64_t red_stride_scalar(const uint64_t *a, size_t n, size_t stride) {
    uint64_t s = 0;
    for (size_t i = 0; i < n; i += stride) s += a[i];
    return s;
}
