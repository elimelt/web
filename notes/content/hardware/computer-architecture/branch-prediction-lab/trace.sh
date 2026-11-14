#!/usr/bin/env bash
# Record conditional-branch traces of seven real programs with btrace.
#
#   ./trace.sh OUTDIR [MAX_INSNS] [RUNS]
#
# Program output goes to a file, not /dev/null: GNU grep notices a /dev/null
# stdout and stops at the first match.
#
# Inputs are built from this repository's own notes (real English and Markdown
# text), so the run needs nothing from the network. Each workload runs RUNS
# times with address-space layout randomization left on, so each run loads the
# program and its libraries at different addresses; that is the only thing
# that changes between runs, and it moves which branches share predictor
# table entries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?usage: trace.sh OUTDIR [MAX_INSNS] [RUNS]}"
max="${2:-8000000}"
runs="${3:-3}"
mkdir -p "$out/in"
[ -x "$out/btrace" ] || cc -O2 -o "$out/btrace" "$here/btrace.c"

# A 2 MB text corpus (the notes in path order) and one word per line for sort.
python3 - "$here/../../.." "$out/in" <<'PY2'
import pathlib, re, sys
root, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
text = "".join(p.read_text(encoding="utf-8", errors="replace") for p in sorted(root.rglob("*.md")))
text = text.encode()[:2_000_000].decode(errors="ignore")
(dst / "corpus.txt").write_text(text)
(dst / "words.txt").write_text("\n".join(re.findall(r"[A-Za-z]+", text)[:200_000]) + "\n")
PY2
# A preprocessed C file for the compiler proper.
cc -E "$here/btrace.c" > "$out/in/btrace.i"
cat > "$out/in/wordfreq.py" <<'PY'
import collections, json, re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
words = re.findall(r"[a-z]+", text.lower())
counts = collections.Counter(words)
print(json.dumps(counts.most_common(50))[:200])
PY
cc1="$(cc -print-prog-name=cc1)"
export cc1 out max

one() {
  local name=$1 run=$2 bin="$out/$1.$2.bin"
  local -a argv
  case $name in
    gzip)   argv=(gzip -6 -c "$out/in/corpus.txt") ;;
    bzip2)  argv=(bzip2 -9 -c "$out/in/corpus.txt") ;;
    xz)     argv=(xz -T1 -6 -c "$out/in/corpus.txt") ;;
    sort)   argv=(sort --parallel=1 -S 64M "$out/in/words.txt") ;;
    grep)   argv=(grep -E -c -i '(predict|speculat)[a-z]*|[0-9]+(\.[0-9]+)? ?(ns|cycles)' "$out/in/corpus.txt") ;;
    python) argv=(python3 -S "$out/in/wordfreq.py" "$out/in/corpus.txt") ;;
    cc1)    argv=("$cc1" -quiet -O2 "$out/in/btrace.i" -o /dev/null) ;;
  esac
  # Skip a trace that already finished, so an interrupted run can resume.
  if grep -q '^insns=' "$bin.txt" 2>/dev/null; then echo "$name $run $(cat "$bin.txt") (kept)"; return; fi
  "$out/btrace" "$bin" -n "$max" -- "${argv[@]}" > "$bin.out" 2> "$bin.txt"
  echo "$name $run $(cat "$bin.txt")"
}
export -f one

for run in $(seq 1 "$runs"); do
  for name in gzip bzip2 xz sort grep python cc1; do
    echo "$name $run"
  done
done | xargs -P "$(nproc)" -L 1 bash -c 'one "$0" "$1"'
