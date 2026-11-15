#!/usr/bin/env bash
# Simulates the four models and the toy partition with Icarus Verilog and
# Verilator, and writes everything the note quotes to results/.
#
#   cd notes/content/hardware/gpu-architecture-rtl && ./run.sh
#
# Needs iverilog (12.0) and verilator (5.020); about 5 minutes on 2 cores.
set -euo pipefail
cd "$(dirname "$0")"
OUT=results
B=${BUILD_DIR:-$(mktemp -d)}
mkdir -p "$OUT"
JOBS=2
RTL="rtl/warp_issue_arbiter.sv rtl/valid_ready_stage.sv rtl/banked_regfile.sv rtl/toy_partition.sv"
VFLAGS="--binary --timing -j $JOBS -Wall -Wno-fatal -Wno-DECLFILENAME -Wno-UNUSEDSIGNAL -Wno-BLKSEQ"

{ (iverilog -V 2>&1 || true) | sed -n 1p; verilator --version; } > "$OUT/versions.txt"

# ---------- unit tests, both simulators, fixed models and originals ----------
: > "$OUT/unit.txt"
run_both () {   # name, top, files..., then -- plusargs
  local name=$1 top=$2; shift 2
  local files=() args=()
  while [ "$1" != "--" ]; do files+=("$1"); shift; done; shift
  args=("$@")
  iverilog -g2012 -o "$B/$name.vvp" "${files[@]}" 2> /dev/null
  verilator $VFLAGS --top-module "$top" -Mdir "$B/v_$name" "${files[@]}" > /dev/null 2>&1
  for a in "${args[@]}"; do
    # shellcheck disable=SC2086
    echo "icarus    $name $a: $(vvp -n "$B/$name.vvp" $a | grep _RESULT)" >> "$OUT/unit.txt"
    # shellcheck disable=SC2086
    echo "verilator $name $a: $("$B/v_$name/V$top" $a | grep _RESULT)" >> "$OUT/unit.txt"
  done
}
run_both arbiter tb_arbiter rtl/warp_issue_arbiter.sv tb/tb_arbiter.sv -- "+SEED=1" "+SEED=2" "+SEED=3"
run_both stage tb_stage rtl/valid_ready_stage.sv tb/tb_stage.sv -- "+MODE=0 +SEED=1" "+MODE=0 +SEED=2" "+MODE=1"
run_both mac tb_mac rtl/pipelined_mac_chain.sv tb/tb_mac.sv -- "+MODE=0 +SEED=1" "+MODE=0 +SEED=2" "+MODE=1"

# originals (the MAC chain with only its illegal drivers rewritten), Icarus
iverilog -g2012 -DORIGINAL -o "$B/arb_o.vvp" original/warp_issue_arbiter.sv tb/tb_arbiter.sv 2> /dev/null
vvp -n "$B/arb_o.vvp" > "$OUT/original_arbiter.txt"
iverilog -g2012 -DORIGINAL -o "$B/stage_o.vvp" original/issue_handshake.sv tb/tb_stage.sv 2> /dev/null
{ vvp -n "$B/stage_o.vvp" +MODE=0 | grep _RESULT; vvp -n "$B/stage_o.vvp" +MODE=1 | grep _RESULT; } > "$OUT/original_handshake.txt"
iverilog -g2012 -o "$B/mac_o.vvp" original/pipelined_mac_chain_drivers_fixed.sv tb/tb_mac.sv 2> /dev/null
{ vvp -n "$B/mac_o.vvp" +MODE=0 | grep _RESULT; vvp -n "$B/mac_o.vvp" +MODE=1 | grep _RESULT; } > "$OUT/original_mac.txt"
# the original sketch testbenches in both simulators
: > "$OUT/original_sketch_tbs.txt"
for m in warp_issue_arbiter lane_register_file pipelined_mac_chain issue_handshake; do
  if iverilog -g2012 -o "$B/s_$m.vvp" "original/$m.sv" "original/${m}_tb.sv" 2> "$B/s_$m.err"; then
    echo "icarus    $m: $(vvp -n "$B/s_$m.vvp" | grep -c ERROR) assertion failures" >> "$OUT/original_sketch_tbs.txt"
  else
    echo "icarus    $m: does not compile: $(grep -m1 error "$B/s_$m.err" | sed 's/^.*error: //')" >> "$OUT/original_sketch_tbs.txt"
  fi
  verilator --binary --timing -Wno-fatal --top-module "${m}_tb" -Mdir "$B/s_v_$m" "original/$m.sv" "original/${m}_tb.sv" > /dev/null 2>&1
  echo "verilator $m: $("$B/s_v_$m/V${m}_tb" | grep -c Error) assertion failures" >> "$OUT/original_sketch_tbs.txt"
done

# register file: exhaustive bank-conflict cycle counts
: > "$OUT/regfile.txt"
for cfg in "1 1" "2 1" "2 2" "4 1"; do
  set -- $cfg
  iverilog -g2012 -Ptb_regfile.NUM_BANKS=$1 -Ptb_regfile.PORTS=$2 -o "$B/rf.vvp" rtl/banked_regfile.sv tb/tb_regfile.sv 2> /dev/null
  vvp -n "$B/rf.vvp" | grep _RESULT >> "$OUT/regfile.txt"
done

# ---------- worked trace, both simulators ----------
iverilog -g2012 -o "$B/part.vvp" $RTL tb/tb_partition.sv 2> /dev/null
verilator $VFLAGS --top-module tb_partition -Mdir "$B/v_part" $RTL tb/tb_partition.sv > /dev/null 2>&1
for t in "1 0 2" "2 0 2" "3 1 3"; do
  set -- $t
  vvp -n "$B/part.vvp" +WARPS=$1 +PATTERN=$2 +N=$3 +TRACE=40 | grep -v finish > "$OUT/trace_w$1_p$2.txt"
  "$B/v_part/Vtb_partition" +WARPS=$1 +PATTERN=$2 +N=$3 +TRACE=40 | grep -v finish > "$B/vl_trace.txt"
  if cmp -s "$OUT/trace_w$1_p$2.txt" "$B/vl_trace.txt"; then
    echo "trace_w$1_p$2: icarus and verilator identical" >> "$OUT/trace_check.txt"
  else
    echo "trace_w$1_p$2: icarus and verilator DIFFER" >> "$OUT/trace_check.txt"
  fi
done

# ---------- sweep: issue rate against resident warps ----------
: > "$OUT/sweep.txt"
for cfg in "2 2 4" "4 1 4" "1 1 4" "2 2 8"; do
  set -- $cfg
  verilator $VFLAGS -GNUM_BANKS=$1 -GPORTS=$2 -GEXEC_DEPTH=$3 --top-module tb_partition \
    -Mdir "$B/v_sw_$1_$2_$3" $RTL tb/tb_partition.sv > /dev/null 2>&1
  for p in 0 1 2 3; do
    for w in 1 2 3 4 5 6 7 8 10 12 14 16; do
      for s in 1 2 3 4 5; do
        "$B/v_sw_$1_$2_$3/Vtb_partition" +WARPS=$w +PATTERN=$p +N=256 +SEED=$s | grep RESULT >> "$OUT/sweep.txt"
        [ "$p" = 3 ] || break      # fixed programs are deterministic: one run
      done
    done
  done
done
# cross-check a slice of the sweep in Icarus
: > "$OUT/sweep_icarus.txt"
for w in 1 4 8 16; do
  for s in 1 2; do
    vvp -n "$B/part.vvp" +WARPS=$w +PATTERN=3 +N=256 +SEED=$s | grep RESULT >> "$OUT/sweep_icarus.txt"
  done
done
echo "done: $OUT"
