"""Fetch PyPI release-file metadata and normalize it to one logical record type.

Usage:
  python3 dataset.py fetch  OUT.jsonl.gz   # download from pypi.org/pypi/<pkg>/json
The snapshot used in the note is pypi_files.jsonl.gz (fetched 2026-11-17).
"""
import base64, datetime, gzip, json, sys, urllib.request

PACKAGES = ["numpy", "pandas", "requests", "urllib3", "setuptools", "pip",
            "cryptography", "protobuf", "grpcio", "msgpack", "fastavro", "orjson"]

def normalize(pkg, version, f):
    t = datetime.datetime.fromisoformat(f["upload_time_iso_8601"].replace("Z", "+00:00"))
    return {
        "name": pkg,
        "version": version,
        "filename": f["filename"],
        "packagetype": f["packagetype"],
        "python_version": f["python_version"],
        "requires_python": f["requires_python"] or None,
        "size": f["size"],
        "upload_time": int(t.timestamp() * 1_000_000),   # microseconds since epoch
        "yanked": bool(f["yanked"]),
        "sha256": bytes.fromhex(f["digests"]["sha256"]),
    }

def to_jsonable(r):
    return {**r, "sha256": r["sha256"].hex()}

def from_jsonable(r):
    return {**r, "sha256": bytes.fromhex(r["sha256"])}

def load(path):
    with gzip.open(path, "rt") as fh:
        return [from_jsonable(json.loads(line)) for line in fh]

def fetch(out):
    rows = []
    for pkg in PACKAGES:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{pkg}/json") as resp:
            d = json.load(resp)
        for version, files in d["releases"].items():
            for f in files:
                rows.append(normalize(pkg, version, f))
    rows.sort(key=lambda r: (r["name"], r["upload_time"], r["filename"]))
    with gzip.open(out, "wt") as fh:
        for r in rows:
            fh.write(json.dumps(to_jsonable(r), separators=(",", ":")) + "\n")
    print(len(rows), "records")

if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        fetch(sys.argv[2])
