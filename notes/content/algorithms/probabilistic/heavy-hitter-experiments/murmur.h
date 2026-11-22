static uint64_t murmur64a(const void *key, size_t len, uint64_t seed) {
  const uint64_t m = 0xc6a4a7935bd1e995ULL; const int r = 47;
  uint64_t h = seed ^ (len * m);
  const unsigned char *p = key; size_t nb = len / 8;
  for (size_t i = 0; i < nb; i++) { uint64_t k; memcpy(&k, p + 8*i, 8);
    k *= m; k ^= k >> r; k *= m; h ^= k; h *= m; }
  const unsigned char *t = p + 8*nb;
  switch (len & 7) {
    case 7: h ^= (uint64_t)t[6] << 48; case 6: h ^= (uint64_t)t[5] << 40;
    case 5: h ^= (uint64_t)t[4] << 32; case 4: h ^= (uint64_t)t[3] << 24;
    case 3: h ^= (uint64_t)t[2] << 16; case 2: h ^= (uint64_t)t[1] << 8;
    case 1: h ^= (uint64_t)t[0]; h *= m; }
  h ^= h >> r; h *= m; h ^= h >> r; return h;
}
