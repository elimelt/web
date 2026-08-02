#!/usr/bin/env python3
"""Quick eval: which model best rewrites technical notes for TTS?

Runs each model on math-heavy excerpts (from notes.elimelt.com) with the
production system prompt, then scores outputs on:
  - no leftover unspeakable notation (LaTeX, sub/superscripts, symbols)
  - no preamble/meta-text ("Here is the rewritten...")
  - content preserved (length ratio sane, key terms kept)

Usage: python3 eval_tts_rewrite.py [host] [models_csv]
"""
import json
import re
import sys
import time
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:11434"
MODELS = (sys.argv[2] if len(sys.argv) > 2
          else "gemma2:2b,llama3.2:3b,gemma3:27b").split(",")

SYSTEM = ("You rewrite excerpts from technical notes so they can be read aloud "
          "naturally by a text-to-speech engine. Expand math, symbols, code "
          "identifiers, and abbreviations into spoken words (for example "
          '"O(n log n)" becomes "order n log n", "x_i" becomes "x sub i"). '
          "LaTeX between \\( and \\) delimiters is inline math: speak it as a "
          "person would read the formula aloud and drop the delimiters. Smooth "
          "awkward notation into plain sentences but keep the meaning and "
          "technical content identical. Do not add, explain, or summarize. "
          "Output only the rewritten text with no preamble.")

# Excerpts from notes.elimelt.com/math/linear-algebra/svd-and-pseudoinverse
CASES = [
    {"text": r"Let \(A \in R^{m \times n}\). The matrix \(A^T A\) is symmetric "
             r"and positive semidefinite, so it has an orthonormal eigenbasis "
             r"\(v_1, \ldots, v_n\) with eigenvalues \(\lambda_1 \geq \cdots "
             r"\geq \lambda_n \geq 0\). Define the singular values "
             r"\(\sigma_i = \sqrt{\lambda_i}\).",
     "keywords": ["symmetric", "positive semidefinite", "orthonormal",
                  "eigenvalues", "singular values"]},
    {"text": r"\(\sigma_1 = \|A\|_2\) is the largest stretch factor any unit "
             r"vector experiences, and \(\sigma_r\) the smallest nonzero one; "
             r"their ratio \(\sigma_1 / \sigma_r\) is the condition number.",
     "keywords": ["largest", "stretch", "unit vector", "condition number"]},
    {"text": r"When A has full column rank, \(A^+ = (A^T A)^{-1} A^T\), the "
             r"least-squares operator from the normal equations. The general "
             r"statement: \(\hat{x} = A^+ b\) is always a least-squares "
             r"solution of \(Ax = b\).",
     "keywords": ["full column rank", "least-squares", "normal equations"]},
    {"text": "This is exactly what np.linalg.lstsq returns, since its "
             "SVD-based driver applies a truncated pseudoinverse. "
             "np.linalg.pinv applies an rcond cutoff before inverting "
             "singular values.",
     "keywords": ["pseudoinverse", "cutoff", "singular values"]},
]

BAD_PATTERNS = [
    (r"\\\(|\\\)|\\[a-zA-Z]+\{|\\sigma|\\lambda|\\geq|\\in", "latex"),
    (r"[_^]\{?[a-zA-Z0-9]", "sub/superscript"),
    (r"[≥≤∈∑√σλΣ×]", "math symbol"),
    (r"\^T|\^\+|\^\{-1\}|\^-1", "operator notation"),
    (r"(?i)^\s*(here is|here's|sure|certainly|rewritten|okay|below is)", "preamble"),
]


def chat(model, text):
    body = json.dumps({
        "model": model, "stream": False,
        "options": {"temperature": 0.2, "num_predict": 400},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": text}],
    }).encode()
    req = urllib.request.Request(f"{HOST}/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=3600) as r:
        out = json.load(r)["message"]["content"].strip()
    return out, time.perf_counter() - t0


def score(case, output):
    issues = []
    for pat, name in BAD_PATTERNS:
        if re.search(pat, output):
            issues.append(name)
    kw_missing = [k for k in case["keywords"]
                  if k.lower() not in output.lower()]
    if kw_missing:
        issues.append(f"dropped: {', '.join(kw_missing)}")
    ratio = len(output) / len(case["text"])
    if ratio < 0.6:
        issues.append(f"too short ({ratio:.1f}x)")
    elif ratio > 2.5:
        issues.append(f"too long ({ratio:.1f}x)")
    return issues


def main():
    results = {}
    for model in MODELS:
        print(f"\n{'='*60}\n{model}\n{'='*60}")
        total_issues, elapsed = 0, 0.0
        for i, case in enumerate(CASES):
            try:
                out, dt = chat(model, case["text"])
            except Exception as e:
                print(f"[case {i+1}] FAILED: {e}")
                total_issues += 10
                continue
            issues = score(case, out)
            total_issues += len(issues)
            elapsed += dt
            flag = "OK " if not issues else "BAD"
            print(f"[case {i+1}] {flag} ({dt:.1f}s) "
                  f"{'; '.join(issues) if issues else ''}")
            print(f"    {out[:200]}{'...' if len(out) > 200 else ''}")
        results[model] = (total_issues, elapsed)

    print(f"\n{'Model':<15} {'Issues':>7} {'Time':>8}")
    print("-" * 32)
    for m, (n, t) in sorted(results.items(), key=lambda kv: kv[1][0]):
        print(f"{m:<15} {n:>7} {t:>7.1f}s")


if __name__ == "__main__":
    main()
