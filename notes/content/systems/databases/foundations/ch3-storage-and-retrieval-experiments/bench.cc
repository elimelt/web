// Storage-engine amplification benchmark: SQLite (B-tree) vs RocksDB (LSM-tree).
//
// One process runs one engine on one fresh directory through three phases:
//   load    N distinct keys inserted in random (or sequential) key order
//   update  U random overwrites of existing keys
//   read    R point gets of existing keys, then R gets of absent keys
// Keys are 16 bytes, values 100 random (incompressible) bytes, and writes are
// grouped 1000 per transaction (SQLite) or WriteBatch (RocksDB).
//
// Write amplification = bytes the process passed to write(2)/pwrite(2) during
// the phase (/proc/self/io wchar), including deferred work (SQLite WAL
// checkpoint, RocksDB flush and compaction, which run on RocksDB's own threads
// inside this process), divided by the logical bytes written (16 + 100 per op).
// Read amplification = bytes passed to read(2)/pread(2) per get (rchar).
//
// Build: ./build.sh. Run: ./bench --engine sqlite --dir /path --n 4000000
#include <algorithm>
#include <chrono>
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <string>
#include <sys/stat.h>
#include <vector>

#include "sqlite3.h"
#include "rocksdb/db.h"
#include "rocksdb/filter_policy.h"
#include "rocksdb/perf_context.h"
#include "rocksdb/perf_level.h"
#include "rocksdb/statistics.h"
#include "rocksdb/table.h"
#include "rocksdb/cache.h"
#include "rocksdb/version.h"

static const int KEY = 16, VAL = 100;
static uint64_t BATCH = 1000, LOAD_BATCH = 1000;

static uint64_t splitmix(uint64_t x) {  // bijective on 64-bit integers
  x += 0x9e3779b97f4a7c15ULL;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
  return x ^ (x >> 31);
}
struct Rng {
  uint64_t s;
  uint64_t next() { s = splitmix(s); return s; }
};

static bool g_seq = false;
static uint64_t g_seed = 1;
// Key i in [0, 2N): i < N exists after the load, i >= N never does.
static void make_key(uint64_t i, char* out) {
  uint64_t v = g_seq ? i : splitmix(i ^ (g_seed << 40));
  snprintf(out, KEY + 1, "%016" PRIx64, v);
}

struct IoCounters { uint64_t rchar, wchar, read_bytes, write_bytes; };
static IoCounters io_now() {
  IoCounters c{};
  FILE* f = fopen("/proc/self/io", "r");
  char name[64]; unsigned long long v;
  while (fscanf(f, "%63[^:]: %llu\n", name, &v) == 2) {
    if (!strcmp(name, "rchar")) c.rchar = v;
    else if (!strcmp(name, "wchar")) c.wchar = v;
    else if (!strcmp(name, "read_bytes")) c.read_bytes = v;
    else if (!strcmp(name, "write_bytes")) c.write_bytes = v;
  }
  fclose(f);
  return c;
}
static double now_s() {
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
static uint64_t now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}
// Allocated bytes (st_blocks) and apparent bytes of every file under dir.
static void dir_size(const std::string& dir, uint64_t* alloc, uint64_t* apparent, int* files) {
  *alloc = *apparent = 0; *files = 0;
  DIR* d = opendir(dir.c_str());
  while (dirent* e = readdir(d)) {
    if (e->d_name[0] == '.') continue;
    struct stat st;
    std::string p = dir + "/" + e->d_name;
    if (stat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode)) {
      *alloc += (uint64_t)st.st_blocks * 512; *apparent += st.st_size; (*files)++;
    }
  }
  closedir(d);
}

struct Engine {
  virtual ~Engine() {}
  virtual void open() = 0;
  virtual void close() = 0;
  virtual void begin() = 0;
  virtual void put(const char* k, const char* v) = 0;
  virtual void commit() = 0;
  virtual void settle() = 0;  // finish deferred writes (checkpoint / flush+compact)
  virtual bool get(const char* k, std::string* v) = 0;
  virtual uint64_t blocks_read() = 0;  // engine-level storage reads so far
  virtual std::string extra() { return "{}"; }
};

struct Sqlite : Engine {
  std::string dir; int cache_mb; sqlite3* db = nullptr;
  sqlite3_stmt *ins = nullptr, *sel = nullptr;
  Sqlite(std::string d, int c) : dir(d), cache_mb(c) {}
  void exec(const char* sql) {
    char* err = nullptr;
    if (sqlite3_exec(db, sql, nullptr, nullptr, &err) != SQLITE_OK) { fprintf(stderr, "%s: %s\n", sql, err); exit(1); }
  }
  void open() override {
    std::string path = dir + "/db.sqlite";
    if (sqlite3_open(path.c_str(), &db) != SQLITE_OK) exit(1);
    exec("PRAGMA page_size=4096");
    exec("PRAGMA journal_mode=WAL");
    exec("PRAGMA synchronous=NORMAL");
    exec("PRAGMA mmap_size=0");
    char buf[64]; snprintf(buf, sizeof buf, "PRAGMA cache_size=-%d", cache_mb * 1024); exec(buf);
    exec("CREATE TABLE IF NOT EXISTS kv(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID");
    sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", -1, &ins, nullptr);
    sqlite3_prepare_v2(db, "SELECT v FROM kv WHERE k=?", -1, &sel, nullptr);
  }
  void close() override {
    sqlite3_finalize(ins); sqlite3_finalize(sel); sqlite3_close(db); db = nullptr;
  }
  void begin() override { exec("BEGIN"); }
  void put(const char* k, const char* v) override {
    sqlite3_bind_blob(ins, 1, k, KEY, SQLITE_STATIC);
    sqlite3_bind_blob(ins, 2, v, VAL, SQLITE_STATIC);
    if (sqlite3_step(ins) != SQLITE_DONE) { fprintf(stderr, "insert failed\n"); exit(1); }
    sqlite3_reset(ins);
  }
  void commit() override { exec("COMMIT"); }
  void settle() override { exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  bool get(const char* k, std::string* v) override {
    sqlite3_bind_blob(sel, 1, k, KEY, SQLITE_STATIC);
    bool found = false;
    if (sqlite3_step(sel) == SQLITE_ROW) {
      v->assign((const char*)sqlite3_column_blob(sel, 0), sqlite3_column_bytes(sel, 0));
      found = true;
    }
    sqlite3_reset(sel);
    return found;
  }
  uint64_t blocks_read() override {
    int cur = 0, hi = 0;
    sqlite3_db_status(db, SQLITE_DBSTATUS_CACHE_MISS, &cur, &hi, 0);
    return (uint64_t)cur;
  }
  std::string extra() override {
    sqlite3_stmt* s; long long pages = 0, freel = 0, depth = 0;
    sqlite3_prepare_v2(db, "PRAGMA page_count", -1, &s, nullptr);
    if (sqlite3_step(s) == SQLITE_ROW) pages = sqlite3_column_int64(s, 0);
    sqlite3_finalize(s);
    sqlite3_prepare_v2(db, "PRAGMA freelist_count", -1, &s, nullptr);
    if (sqlite3_step(s) == SQLITE_ROW) freel = sqlite3_column_int64(s, 0);
    sqlite3_finalize(s);
    // Tree depth (levels, root = 1) from the dbstat virtual table, if compiled in.
    if (sqlite3_prepare_v2(db, "SELECT max(length(path)-length(replace(path,'/',''))) FROM dbstat WHERE name='kv'", -1, &s, nullptr) == SQLITE_OK) {
      if (sqlite3_step(s) == SQLITE_ROW) depth = sqlite3_column_int64(s, 0);
      sqlite3_finalize(s);
    }
    char buf[160];
    snprintf(buf, sizeof buf, "{\"page_count\":%lld,\"freelist_count\":%lld,\"btree_depth\":%lld}", pages, freel, depth);
    return buf;
  }
};

struct Rocks : Engine {
  std::string dir; int cache_mb; std::unique_ptr<rocksdb::DB> db;
  rocksdb::Options opt; rocksdb::WriteBatch wb;
  std::shared_ptr<rocksdb::Statistics> stats;
  Rocks(std::string d, int c) : dir(d), cache_mb(c) {
    stats = rocksdb::CreateDBStatistics();
    opt.create_if_missing = true;
    opt.statistics = stats;
    opt.compression = rocksdb::kNoCompression;
    opt.bottommost_compression = rocksdb::kNoCompression;
    rocksdb::BlockBasedTableOptions t;
    t.block_cache = rocksdb::NewLRUCache((size_t)cache_mb << 20);
    t.filter_policy.reset(rocksdb::NewBloomFilterPolicy(10));
    opt.table_factory.reset(rocksdb::NewBlockBasedTableFactory(t));
  }
  void open() override {
    auto s = rocksdb::DB::Open(opt, dir, &db);
    if (!s.ok()) { fprintf(stderr, "%s\n", s.ToString().c_str()); exit(1); }
  }
  void close() override { db->Close(); db.reset(); }
  void begin() override { wb.Clear(); }
  void put(const char* k, const char* v) override { wb.Put(rocksdb::Slice(k, KEY), rocksdb::Slice(v, VAL)); }
  void commit() override {
    auto s = db->Write(rocksdb::WriteOptions(), &wb);
    if (!s.ok()) { fprintf(stderr, "%s\n", s.ToString().c_str()); exit(1); }
  }
  void settle() override {
    db->Flush(rocksdb::FlushOptions());
    rocksdb::WaitForCompactOptions w;
    db->WaitForCompact(w);
  }
  bool get(const char* k, std::string* v) override {
    return db->Get(rocksdb::ReadOptions(), rocksdb::Slice(k, KEY), v).ok();
  }
  uint64_t blocks_read() override { return rocksdb::get_perf_context()->block_read_count; }
  std::string extra() override {
    using namespace rocksdb;
    std::string levels;
    for (int l = 0; l < 7; l++) {
      std::string v;
      db->GetProperty("rocksdb.num-files-at-level" + std::to_string(l), &v);
      levels += (l ? "," : "") + v;
    }
    uint64_t live = 0; db->GetIntProperty("rocksdb.estimate-live-data-size", &live);
    char buf[512];
    snprintf(buf, sizeof buf,
             "{\"wal_bytes\":%" PRIu64 ",\"flush_bytes\":%" PRIu64 ",\"compact_write_bytes\":%" PRIu64
             ",\"compact_read_bytes\":%" PRIu64 ",\"files_per_level\":[%s],\"estimate_live\":%" PRIu64
             ",\"bloom_useful\":%" PRIu64 "}",
             stats->getTickerCount(WAL_FILE_BYTES), stats->getTickerCount(FLUSH_WRITE_BYTES),
             stats->getTickerCount(COMPACT_WRITE_BYTES), stats->getTickerCount(COMPACT_READ_BYTES),
             levels.c_str(), live, stats->getTickerCount(BLOOM_FILTER_USEFUL));
    return buf;
  }
};

static std::string pct_json(std::vector<uint32_t>& v) {
  std::sort(v.begin(), v.end());
  auto q = [&](double p) { return v[std::min(v.size() - 1, (size_t)(p * v.size()))]; };
  double mean = 0; for (auto x : v) mean += x; mean /= v.size();
  char buf[200];
  snprintf(buf, sizeof buf, "{\"mean_ns\":%.1f,\"p50_ns\":%u,\"p90_ns\":%u,\"p99_ns\":%u,\"p999_ns\":%u}",
           mean, q(0.5), q(0.9), q(0.99), q(0.999));
  return buf;
}

int main(int argc, char** argv) {
  std::string engine = "sqlite", dir = "/tmp/db";
  uint64_t n = 1000000, updates = 0, reads = 200000; int cache_mb = 32; bool skip_write = false;
  for (int i = 1; i + 1 < argc; i += 2) {
    std::string a = argv[i], b = argv[i + 1];
    if (a == "--engine") engine = b;
    else if (a == "--dir") dir = b;
    else if (a == "--n") n = strtoull(b.c_str(), 0, 10);
    else if (a == "--updates") updates = strtoull(b.c_str(), 0, 10);
    else if (a == "--reads") reads = strtoull(b.c_str(), 0, 10);
    else if (a == "--seed") g_seed = strtoull(b.c_str(), 0, 10);
    else if (a == "--cache-mb") cache_mb = atoi(b.c_str());
    else if (a == "--order") g_seq = (b == "seq");
    else if (a == "--reads-only") skip_write = (b == "1");
    else if (a == "--batch") BATCH = strtoull(b.c_str(), 0, 10);
    else if (a == "--load-batch") LOAD_BATCH = strtoull(b.c_str(), 0, 10);
  }
  mkdir(dir.c_str(), 0755);
  Engine* e = engine == "sqlite" ? (Engine*)new Sqlite(dir, cache_mb) : (Engine*)new Rocks(dir, cache_mb);
  e->open();
  rocksdb::SetPerfLevel(rocksdb::PerfLevel::kEnableCount);

  Rng rng{g_seed * 7919 + 13};
  char key[KEY + 1], val[VAL];
  auto fill_val = [&]() { for (int j = 0; j < VAL; j += 8) { uint64_t r = rng.next(); memcpy(val + j, &r, std::min(8, VAL - j)); } };
  const double rec = KEY + VAL;
  std::string out = "{";
  char buf[1024];
  snprintf(buf, sizeof buf, "\"engine\":\"%s\",\"version\":\"%s\",\"n\":%" PRIu64 ",\"updates\":%" PRIu64
           ",\"reads\":%" PRIu64 ",\"seed\":%" PRIu64 ",\"order\":\"%s\",\"cache_mb\":%d,\"key\":%d,\"value\":%d,\"batch\":%" PRIu64 ",\"load_batch\":%" PRIu64,
           engine.c_str(), engine == "sqlite" ? sqlite3_libversion() : rocksdb::GetRocksVersionAsString().c_str(),
           n, updates, reads, g_seed, g_seq ? "seq" : "random", cache_mb, KEY, VAL, BATCH, LOAD_BATCH);
  out += buf;

  auto write_phase = [&](const char* name, uint64_t ops, bool is_load) {
    IoCounters a = io_now(); double t0 = now_s();
    // Sample cumulative wchar every 1/64 of the phase for the write-amp curve.
    std::string curve = "[";
    const uint64_t B = is_load ? LOAD_BATCH : BATCH;
    for (uint64_t i = 0; i < ops; i += B) {
      e->begin();
      for (uint64_t j = i; j < std::min(ops, i + B); j++) {
        make_key(is_load ? j : rng.next() % n, key);
        fill_val(); e->put(key, val);
      }
      e->commit();
      uint64_t done = std::min(ops, i + B);
      if (ops >= 64 && (done % (ops / 64) < B || done == ops)) {
        IoCounters c = io_now();
        snprintf(buf, sizeof buf, "%s[%" PRIu64 ",%" PRIu64 "]", curve.size() > 1 ? "," : "", done, c.wchar - a.wchar);
        curve += buf;
      }
    }
    double t1 = now_s();
    e->settle();
    double t2 = now_s();
    IoCounters b = io_now();
    uint64_t alloc, app; int files; dir_size(dir, &alloc, &app, &files);
    double logical = ops * rec;
    std::string big(4096 + curve.size(), '\0');
    int len = snprintf(&big[0], big.size(),
             ",\"%s\":{\"ops\":%" PRIu64 ",\"secs_foreground\":%.3f,\"secs_settle\":%.3f,\"wchar\":%" PRIu64
             ",\"write_bytes\":%" PRIu64 ",\"write_amp\":%.3f,\"dev_write_amp\":%.3f,\"alloc_bytes\":%" PRIu64
             ",\"apparent_bytes\":%" PRIu64 ",\"files\":%d,\"space_amp\":%.4f,\"engine\":%s,\"curve\":%s]}",
             name, ops, t1 - t0, t2 - t1, b.wchar - a.wchar, b.write_bytes - a.write_bytes,
             (b.wchar - a.wchar) / logical, (b.write_bytes - a.write_bytes) / logical, alloc, app, files,
             alloc / (n * rec), e->extra().c_str(), curve.c_str());
    big.resize(len);
    out += big;
    fprintf(stderr, "%s %s n=%" PRIu64 " wa=%.2f sa=%.3f fg=%.1fs settle=%.1fs\n", engine.c_str(), name, n,
            (b.wchar - a.wchar) / logical, alloc / (n * rec), t1 - t0, t2 - t1);
  };

  if (!skip_write) {
    write_phase("load", n, true);
    if (updates) write_phase("update", updates, false);
  }

  // Reopen so the engine cache starts empty; the OS page cache stays warm.
  e->close(); e->open();
  auto read_phase = [&](const char* name, bool present) {
    std::vector<uint32_t> lat; lat.reserve(reads);
    std::string v; uint64_t found = 0;
    IoCounters a = io_now(); uint64_t b0 = e->blocks_read();
    Rng rr{g_seed * 104729 + (present ? 1 : 2)};
    for (uint64_t i = 0; i < reads; i++) {
      uint64_t id = present ? rr.next() % n : n + rr.next() % n;
      make_key(id, key);
      uint64_t t = now_ns();
      found += e->get(key, &v);
      lat.push_back((uint32_t)std::min<uint64_t>(now_ns() - t, 0xffffffffu));
    }
    IoCounters b = io_now(); uint64_t b1 = e->blocks_read();
    snprintf(buf, sizeof buf, ",\"%s\":{\"found\":%" PRIu64 ",\"rchar_per_get\":%.1f,\"blocks_per_get\":%.4f,\"lat\":%s}",
             name, found, (double)(b.rchar - a.rchar) / reads, (double)(b1 - b0) / reads, pct_json(lat).c_str());
    out += buf;
    fprintf(stderr, "%s %s found=%" PRIu64 " bytes/get=%.0f blocks/get=%.3f\n", engine.c_str(), name, found,
            (double)(b.rchar - a.rchar) / reads, (double)(b1 - b0) / reads);
  };
  if (reads) { read_phase("get_present", true); read_phase("get_absent", false); }
  out += ",\"final\":" + e->extra() + "}";
  e->close();
  puts(out.c_str());
  return 0;
}
