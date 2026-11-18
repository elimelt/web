/* Reduction kernels. Compiled with gcc -O3 -march=native unless noted in
 * reductions_bench.mk. Each kernel returns the 64-bit wrapping sum of a[0..n). */
#include <immintrin.h>
#include <stddef.h>
#include <stdint.h>

/* red_naive: one accumulator in the source. */
uint64_t red_naive(const uint64_t *a, size_t n) {
    uint64_t s = 0;
    for (size_t i = 0; i < n; i++) s += a[i];
    return s;
}

/* red_ilp: eight independent scalar accumulators in the source. */
uint64_t red_ilp(const uint64_t *a, size_t n) {
    uint64_t s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
    size_t i = 0;
    for (; i + 8 <= n; i += 8) {
        s0 += a[i + 0]; s1 += a[i + 1]; s2 += a[i + 2]; s3 += a[i + 3];
        s4 += a[i + 4]; s5 += a[i + 5]; s6 += a[i + 6]; s7 += a[i + 7];
    }
    for (; i < n; i++) s0 += a[i];
    return s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7;
}

static inline uint64_t hsum256(__m256i v) {
    __m128i lo = _mm256_castsi256_si128(v), hi = _mm256_extracti128_si256(v, 1);
    __m128i s = _mm_add_epi64(lo, hi);
    return (uint64_t)_mm_cvtsi128_si64(s) + (uint64_t)_mm_extract_epi64(s, 1);
}

/* red_simd: AVX2 intrinsics, one vector accumulator (4 lanes). */
uint64_t red_simd(const uint64_t *a, size_t n) {
    __m256i acc = _mm256_setzero_si256();
    size_t i = 0;
    for (; i + 4 <= n; i += 4)
        acc = _mm256_add_epi64(acc, _mm256_loadu_si256((const __m256i *)(a + i)));
    uint64_t s = hsum256(acc);
    for (; i < n; i++) s += a[i];
    return s;
}

/* red_ilp_simd: AVX2 intrinsics, four vector accumulators (16 lanes). */
uint64_t red_ilp_simd(const uint64_t *a, size_t n) {
    __m256i a0 = _mm256_setzero_si256(), a1 = a0, a2 = a0, a3 = a0;
    size_t i = 0;
    for (; i + 16 <= n; i += 16) {
        a0 = _mm256_add_epi64(a0, _mm256_loadu_si256((const __m256i *)(a + i)));
        a1 = _mm256_add_epi64(a1, _mm256_loadu_si256((const __m256i *)(a + i + 4)));
        a2 = _mm256_add_epi64(a2, _mm256_loadu_si256((const __m256i *)(a + i + 8)));
        a3 = _mm256_add_epi64(a3, _mm256_loadu_si256((const __m256i *)(a + i + 12)));
    }
    uint64_t s = hsum256(_mm256_add_epi64(_mm256_add_epi64(a0, a1), _mm256_add_epi64(a2, a3)));
    for (; i < n; i++) s += a[i];
    return s;
}

/* red_ilp_avx512: AVX-512 intrinsics, four 512-bit accumulators (32 lanes). */
uint64_t red_ilp_avx512(const uint64_t *a, size_t n) {
    __m512i a0 = _mm512_setzero_si512(), a1 = a0, a2 = a0, a3 = a0;
    size_t i = 0;
    for (; i + 32 <= n; i += 32) {
        a0 = _mm512_add_epi64(a0, _mm512_loadu_si512(a + i));
        a1 = _mm512_add_epi64(a1, _mm512_loadu_si512(a + i + 8));
        a2 = _mm512_add_epi64(a2, _mm512_loadu_si512(a + i + 16));
        a3 = _mm512_add_epi64(a3, _mm512_loadu_si512(a + i + 24));
    }
    uint64_t s = (uint64_t)_mm512_reduce_add_epi64(
        _mm512_add_epi64(_mm512_add_epi64(a0, a1), _mm512_add_epi64(a2, a3)));
    for (; i < n; i++) s += a[i];
    return s;
}

/* red_avx512_1: AVX-512 intrinsics, one 512-bit accumulator (one load per line). */
uint64_t red_avx512_1(const uint64_t *a, size_t n) {
    __m512i acc = _mm512_setzero_si512();
    size_t i = 0;
    for (; i + 8 <= n; i += 8) acc = _mm512_add_epi64(acc, _mm512_loadu_si512(a + i));
    uint64_t s = (uint64_t)_mm512_reduce_add_epi64(acc);
    for (; i < n; i++) s += a[i];
    return s;
}
