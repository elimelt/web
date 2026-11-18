#!/bin/bash
# Fetch and build SQLite 3.54.1 and RocksDB 11.13.2 from source, then the harness.
# Needs gcc/g++ 13 (C++20), make, tcl (for the SQLite amalgamation), and the
# compression libraries RocksDB's build detects (none are used at run time:
# the harness turns compression off).
set -euo pipefail
SRC=${SRC:-$PWD/src}; mkdir -p "$SRC"
[ -d "$SRC/sqlite-src" ] || git clone --depth 1 --branch version-3.54.1 https://github.com/sqlite/sqlite "$SRC/sqlite-src"
[ -d "$SRC/rocksdb" ] || git clone --depth 1 --branch v11.13.2 https://github.com/facebook/rocksdb "$SRC/rocksdb"
(cd "$SRC/sqlite-src" && ./configure >/dev/null && make sqlite3.c >/dev/null)
(cd "$SRC/rocksdb" && make -j"$(nproc)" static_lib DEBUG_LEVEL=0 >/dev/null)
gcc -O2 -c -DSQLITE_ENABLE_DBSTAT_VTAB -DSQLITE_THREADSAFE=1 "$SRC/sqlite-src/sqlite3.c" -o sqlite3.o
LD=$(grep '^PLATFORM_LDFLAGS' "$SRC/rocksdb/make_config.mk" | cut -d= -f2-)
g++ -O2 -std=c++20 -I"$SRC/sqlite-src" -I"$SRC/rocksdb/include" bench.cc sqlite3.o \
  "$SRC/rocksdb/librocksdb.a" $LD -lpthread -ldl -o bench
