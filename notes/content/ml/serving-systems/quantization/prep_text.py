"""Build the evaluation text: English prose from the Go blog
(github.com/golang/website, _content/blog/*.md) with code, markup and links
stripped, plus Karpathy's tinyshakespeare as an out-of-domain check.

usage: python3 prep_text.py GO_WEBSITE_DIR TINYSHAKESPEARE_TXT OUT_DIR
"""
import json, pathlib, re, sys

def clean_markdown(src: str) -> list[str]:
    src = re.sub(r"\A---\n.*?\n---\n", "", src, flags=re.S)   # front matter
    src = re.sub(r"```.*?```", "", src, flags=re.S)            # fenced code
    src = re.sub(r"\{\{.*?\}\}", "", src, flags=re.S)          # template calls
    src = re.sub(r"<[^>\n]+>", "", src)                        # html tags
    paras = []
    for block in re.split(r"\n\s*\n", src):
        lines = [l for l in block.split("\n") if l.strip()]
        if not lines or any(l.startswith(("    ", "\t", "|", "#", "!", ">", "*", "-", ".")) for l in lines):
            continue  # code, tables, headings, quotes, lists, directives
        text = " ".join(l.strip() for l in lines)
        text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)   # links -> text
        text = re.sub(r"\[([^\]]*)\]\[[^\]]*\]", r"\1", text)
        text = text.replace("`", "")
        text = re.sub(r"\\([!*_#\[\]()<>.-])", r"\1", text)   # markdown escapes
        text = re.sub(r"\s+", " ", text).strip()
        if len(text.split()) >= 12 and text[0].isalpha():
            paras.append(text)
    return paras

def main(go_dir, shakes, out):
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    docs = []
    for p in sorted(pathlib.Path(go_dir, "_content/blog").glob("*.md")):
        paras = clean_markdown(p.read_text(encoding="utf-8"))
        if sum(len(x.split()) for x in paras) >= 300:
            docs.append({"name": p.stem, "text": "\n".join(paras)})
    (out / "goblog.json").write_text(json.dumps(docs))
    sh = pathlib.Path(shakes).read_text(encoding="utf-8")
    (out / "shakespeare.json").write_text(json.dumps([{"name": "tinyshakespeare", "text": sh}]))
    print(len(docs), "go blog posts,", sum(len(d["text"].split()) for d in docs), "words")

if __name__ == "__main__":
    main(*sys.argv[1:])
