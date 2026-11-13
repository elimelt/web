"""Loads the Python code blocks from dynamic-programming.mdx.

Each block runs in its own namespace, seeded with everything the earlier
blocks defined, so a block can use earlier functions (alignment() calls
align_cost()) while a later name can't clobber an earlier block's globals
(string building's A = 0 and P1's function A coexist).
"""
import pathlib
import re

NOTE = pathlib.Path(__file__).resolve().parent.parent / "dynamic-programming.mdx"


def blocks(text=None):
    text = text if text is not None else NOTE.read_text()
    out, cur, prefix = [], None, ""
    for line in text.splitlines():
        stripped = re.sub(r"^>\s?", "", line) if line.startswith(">") else line
        if cur is None:
            if stripped.strip() == "```python":
                cur, prefix = [], line[: len(line) - len(stripped)]
        else:
            if stripped.strip() == "```":
                out.append("\n".join(cur))
                cur = None
            else:
                cur.append(stripped)
    return out


def load():
    shared = {}
    for src in blocks():
        ns = {"__name__": "note_block", **shared}
        exec(compile(src, str(NOTE), "exec"), ns)
        shared.update({k: v for k, v in ns.items() if not k.startswith("__")})
    return shared
