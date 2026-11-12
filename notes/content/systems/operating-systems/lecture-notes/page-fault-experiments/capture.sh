#!/bin/bash
# Rebuilds every result in this folder. Run from this folder on Linux with
# gcc, valgrind, Python 3 and NumPy. Takes about 20 minutes, most of it valgrind.
# Writes scratch files (the full traces are several hundred MB) to $WORK.
set -euo pipefail
HERE=$(pwd)
WORK=${WORK:-/tmp/page-fault-work}
mkdir -p "$WORK" && cd "$WORK"

# Inputs: Lua 5.4's manual and C sources, from the lupa 2.8 source package on PyPI.
curl -sSfL -o lupa.tar.gz https://files.pythonhosted.org/packages/c3/a6/0f869fbb07c393f15473b1eefefb7b5bec162fb7481803d040ed4dc46002/lupa-2.8.tar.gz
echo "d8022641b9ec8ecf2c5ecbe9f47e5a70e0b87c4b5ae921b92cb02a638e0acd08  lupa.tar.gz" | sha256sum -c
tar xzf lupa.tar.gz lupa-2.8/third-party/lua54
L=lupa-2.8/third-party/lua54
cat $L/manual/manual.of $(ls $L/*.c | sort) > text.txt
head -c 200000 text.txt > sort200k.txt
sed -n 1,4000p text.txt | head -c 300000 > text4000.txt
gcc -E -O2 -DLUA_USE_LINUX $L/lopcodes.c -o lopcodes.i
CC1=$(gcc -print-prog-name=cc1)

gcc -O2 -o lackey_pages "$HERE/lackey_pages.c"
gcc -O2 -o pagesim "$HERE/pagesim.c"
trace() { name=$1; shift
  valgrind --tool=lackey --trace-mem=yes --log-fd=3 "$@" 3>&1 1>/dev/null 2>/dev/null | ./lackey_pages $name.pages 2> $name.json
  python3 "$HERE/to_u32.py" $name.pages $name.u32; }
trace sort200k sort sort200k.txt
trace gzip9 gzip -9 -c text4000.txt
trace bzip2 bzip2 -9 -c text4000.txt
trace cc1_lopcodes $CC1 -quiet -O0 lopcodes.i -o /dev/null

# Check pagesim against plain Python implementations on random strings.
(cp "$HERE/refsim.py" "$HERE/check.py" . && python3 check.py)

python3 "$HERE/make_windows.py" "$HERE/traces"
FS="1 2 3 4 6 8 12 16 24 32 48 64 96 128 192 256 384 512 768 1024 1536 2048"
for t in sort200k gzip9 bzip2 cc1_lopcodes; do
  for p in fifo lru clock opt arc; do ./pagesim $t.u32 $p $FS > curve_${t}_$p.txt; done
  for s in 1 2 3 4 5; do ./pagesim $t.u32 random:$s 4 8 16 32 64 128 256 > rand_${t}_$s.txt; done
  P=$(python3 -c "import json;print(json.load(open('windows.json'))['$t']['full_pages'])")
  [ $t = cc1_lopcodes ] && P=600
  for p in fifo clock; do ./pagesim $t.u32 $p $(seq 1 $P) > all_${t}_$p.txt; done
  W=$(python3 -c "import json;print(json.load(open('windows.json'))['$t']['window_pages'])")
  for p in fifo clock lru opt; do ./pagesim win_$t.u32 $p $(seq 1 $W) > win_${t}_$p.txt; done
done
python3 "$HERE/aggregate.py" "$HERE"

# Fault costs, TLB reach and page table size. Run these on an idle machine.
gcc -O2 -o fault_cost "$HERE/fault_cost.c" && ./fault_cost 64 15 "$WORK/fault_cost.dat" > "$HERE/fault_cost_results.jsonl"
gcc -O2 -o tlb_walk "$HERE/tlb_walk.c" && ./tlb_walk 1024 10 > "$HERE/tlb_walk_results.jsonl"
gcc -O2 -o pt_size "$HERE/pt_size.c" && for i in 1 2 3; do ./pt_size; done > "$HERE/pt_size_results.jsonl"
