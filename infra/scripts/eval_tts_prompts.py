#!/usr/bin/env python3
"""Prompt-variant eval for gemma2:2b on the notes-TTS rewrite task.

Compares system prompt variants on math-heavy excerpts, with checks for
leftover notation, preambles, dropped/garbled content, and known semantic
traps (e.g. conflating sigma_1 with sigma_r).

Usage: python3 eval_tts_prompts.py [host] [model] [variant_names_csv]
"""
import json
import re
import sys
import time
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:11434"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "gemma2:2b"

BASE = ("You rewrite excerpts from technical notes so they can be read aloud "
        "naturally by a text-to-speech engine. Expand math, symbols, code "
        "identifiers, and abbreviations into spoken words (for example "
        '"O(n log n)" becomes "order n log n", "x_i" becomes "x sub i"). '
        "LaTeX between \\( and \\) delimiters is inline math: speak it as a "
        "person would read the formula aloud and drop the delimiters. Smooth "
        "awkward notation into plain sentences but keep the meaning and "
        "technical content identical. Do not add, explain, or summarize. "
        "Output only the rewritten text with no preamble.")

RULES = (
    "You convert technical notes into text that a text-to-speech engine reads aloud.\n"
    "Rules:\n"
    "1. Go sentence by sentence, in order. Produce exactly one spoken sentence per "
    "input sentence. Never merge, split, reorder, or drop sentences.\n"
    "2. Replace every math symbol with words: \\(x_i\\) -> 'x sub i', \\(A^T\\) -> "
    "'A transpose', \\(A^{-1}\\) -> 'A inverse', \\(A^+\\) -> 'A plus', "
    "\\(\\sigma_1\\) -> 'sigma one', \\(\\geq\\) -> 'is greater than or equal to', "
    "\\(\\|A\\|_2\\) -> 'the two norm of A', \\(\\ldots\\) -> 'through', "
    "O(n log n) -> 'order n log n'.\n"
    "3. Code identifiers are spelled out in words: np.linalg.pinv -> "
    "'numpy's pinv function'.\n"
    "4. Output must contain no backslashes, underscores, carets, braces, or "
    "math symbols of any kind.\n"
    "5. Keep every claim exactly as written. Never swap which quantity a "
    "property belongs to. If the input says 'sigma r is the smallest', the "
    "output must also attach 'smallest' to sigma r.\n"
    "6. Output only the rewritten text. No preamble, no quotes, no commentary."
)

FEWSHOT_EXAMPLES = (
    "\n\nExample input: The eigenvalues satisfy \\(\\lambda_1 \\geq \\cdots \\geq "
    "\\lambda_n \\geq 0\\), and \\(A^T A v_i = \\lambda_i v_i\\).\n"
    "Example output: The eigenvalues satisfy lambda one is greater than or equal "
    "to, down through, lambda n, which is at least zero, and A transpose A times "
    "v sub i equals lambda i times v sub i.\n"
    "\nExample input: Since \\(\\kappa = \\sigma_1 / \\sigma_r\\), a large ratio "
    "means \\(Ax = b\\) is ill-conditioned; np.linalg.cond computes it.\n"
    "Example output: Since kappa equals sigma one divided by sigma r, a large "
    "ratio means the system A x equals b is ill-conditioned; numpy's cond "
    "function computes it."
)

BASE_PLUS = BASE + (
    "\n\nAdditional instructions:\n"
    "- \\(\\|A\\|_2\\) is 'the two norm of A' (never 'norm of A squared').\n"
    "- \\(\\ldots\\) or \\(\\cdots\\) inside a list or chain reads as 'down "
    "through'; never output literal dots.\n"
    "- Keep every property attached to the same quantity as the input: if the "
    "input says sigma r is the smallest, do not attach 'smallest' to sigma one.\n"
    "- Copy every sentence's meaning exactly; expand notation only, never "
    "rephrase claims.\n"
    "- The output must contain no backslashes, underscores, carets, braces, "
    "digits attached to letters (write 'v one' not 'v1'), or literal '...'."
)

VARIANTS = {
    "baseline": BASE,
    "base+direct": BASE_PLUS,
    "base+fewshot": BASE + FEWSHOT_EXAMPLES,
    "base+direct+fs": BASE_PLUS + FEWSHOT_EXAMPLES,
    "rules": RULES,
    "rules+fewshot": RULES + FEWSHOT_EXAMPLES,
}

CASES = [
    {"text": r"Let \(A \in R^{m \times n}\). The matrix \(A^T A\) is symmetric "
             r"and positive semidefinite, so it has an orthonormal eigenbasis "
             r"\(v_1, \ldots, v_n\) with eigenvalues \(\lambda_1 \geq \cdots "
             r"\geq \lambda_n \geq 0\). Define the singular values "
             r"\(\sigma_i = \sqrt{\lambda_i}\).",
     "keywords": ["symmetric", "positive semidefinite", "orthonormal",
                  "eigenvalues", "singular values"],
     "traps": []},
    {"text": r"\(\sigma_1 = \|A\|_2\) is the largest stretch factor any unit "
             r"vector experiences, and \(\sigma_r\) the smallest nonzero one; "
             r"their ratio \(\sigma_1 / \sigma_r\) is the condition number.",
     "keywords": ["largest", "stretch", "unit vector", "condition number"],
     # semantic traps: property attached to the wrong quantity, or misread norm
     "traps": [(r"sigma one (is|equals)[^.;]*smallest", "sigma1 called smallest"),
               (r"(this|which|it) is (equal to )?the smallest", "sigma1 called smallest"),
               (r"sigma r (is|equals)[^.;]*largest", "sigmar called largest"),
               (r"norm of A,? squared", "misread ||A||_2 as squared")]},
    {"text": r"When A has full column rank, \(A^+ = (A^T A)^{-1} A^T\), the "
             r"least-squares operator from the normal equations. The general "
             r"statement: \(\hat{x} = A^+ b\) is always a least-squares "
             r"solution of \(Ax = b\).",
     "keywords": ["full column rank", "least-squares", "normal equations"],
     "traps": []},
    {"text": "This is exactly what np.linalg.lstsq returns, since its "
             "SVD-based driver applies a truncated pseudoinverse. "
             "np.linalg.pinv applies an rcond cutoff before inverting "
             "singular values.",
     "keywords": ["cutoff", "singular values"],
     "traps": []},
]

BAD_PATTERNS = [
    (r"\\\(|\\\)|\\[a-zA-Z]+\{|\\sigma|\\lambda|\\geq|\\in", "latex"),
    (r"[_^]\{?[a-zA-Z0-9]", "sub/superscript"),
    (r"[≥≤∈∑√σλΣ×]", "math symbol"),
    (r"\^T|\^\+|\^\{-1\}|\^-1|\(A\)|\{|\}", "notation"),
    (r"(?i)^\s*(here is|here's|sure|certainly|rewritten|okay|below is)", "preamble"),
]


def chat(system, text):
    body = json.dumps({
        "model": MODEL, "stream": False,
        "options": {"temperature": 0, "num_predict": 400},
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": text}],
    }).encode()
    req = urllib.request.Request(f"{HOST}/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=3600) as r:
        out = json.load(r)["message"]["content"].strip()
    return out, time.perf_counter() - t0


def score(case, output):
    issues = [name for pat, name in BAD_PATTERNS if re.search(pat, output)]
    issues += [f"dropped: {k}" for k in case["keywords"]
               if k.lower() not in output.lower()]
    issues += [name for pat, name in case["traps"]
               if re.search(pat, output, re.I)]
    ratio = len(output) / len(case["text"])
    if ratio < 0.6:
        issues.append(f"too short ({ratio:.1f}x)")
    elif ratio > 2.5:
        issues.append(f"too long ({ratio:.1f}x)")
    return issues


def main():
    names = (sys.argv[3].split(",") if len(sys.argv) > 3 else list(VARIANTS))
    results = {}
    for name in names:
        print(f"\n{'='*60}\nvariant: {name}\n{'='*60}")
        total, elapsed = 0, 0.0
        for i, case in enumerate(CASES):
            out, dt = chat(VARIANTS[name], case["text"])
            issues = score(case, out)
            total += len(issues)
            elapsed += dt
            print(f"[case {i+1}] {'OK ' if not issues else 'BAD'} ({dt:.1f}s) "
                  f"{'; '.join(issues)}")
            print(f"    {out[:220]}{'...' if len(out) > 220 else ''}")
        results[name] = (total, elapsed)

    print(f"\n{'Variant':<15} {'Issues':>7} {'Time':>8}")
    print("-" * 32)
    for n, (t, e) in sorted(results.items(), key=lambda kv: kv[1][0]):
        print(f"{n:<15} {t:>7} {e:>7.1f}s")


if __name__ == "__main__":
    main()
