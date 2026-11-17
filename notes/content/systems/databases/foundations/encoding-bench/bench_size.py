"""Encoded size of every record in every format, raw and compressed.

python3 bench_size.py pypi_files.jsonl.gz > size.json
Each record is encoded on its own. 'stream' sizes concatenate the encoded
records with a 4-byte length prefix (what a file or log of records would hold)
and compress the stream with gzip -6 and zstd -3. 'Avro container' is one
Avro object container file holding all records, schema written once.
"""
import gzip, json, statistics, struct, sys, zlib
import zstandard
import dataset, formats

def main(path):
    rows = dataset.load(path)
    out = {"records": len(rows), "formats": {}}
    for name, (enc, _) in formats.CODECS.items():
        sizes = [len(enc(r)) for r in rows]
        stream = b"".join(struct.pack(">I", len(b)) + b for b in (enc(r) for r in rows))
        out["formats"][name] = {
            "total_bytes": sum(sizes),
            "mean": statistics.fmean(sizes),
            "median": statistics.median(sizes),
            "min": min(sizes), "max": max(sizes),
            "stream_bytes": len(stream),
            "gzip6": len(gzip.compress(stream, 6, mtime=0)),
            "zstd3": len(zstandard.ZstdCompressor(level=3).compress(stream)),
        }
        # Same stream with every sha256 replaced by 32 zero bytes, to separate
        # the incompressible digests from the rest of the record.
        z = b"".join(struct.pack(">I", len(b)) + b for b in
                     (enc({**r, "sha256": bytes(32)}) for r in rows))
        out["formats"][name]["gzip6_zero_hash"] = len(gzip.compress(z, 6, mtime=0))
        out["formats"][name]["zstd3_zero_hash"] = len(zstandard.ZstdCompressor(level=3).compress(z))
    for codec in ("null", "deflate"):
        b = formats.avro_container(rows, codec=codec)
        out["formats"]["Avro container (%s)" % codec] = {"total_bytes": len(b)}
    # Where the bytes go: string payload vs everything else, for one record type.
    payload = sum(len(r[k].encode()) for r in rows for k in
                  ("name", "version", "filename", "packagetype", "python_version"))
    payload += sum(len(r["requires_python"].encode()) for r in rows if r["requires_python"])
    out["string_payload_bytes"] = payload
    out["sha256_bytes"] = 32 * len(rows)
    json.dump(out, sys.stdout, indent=1)

if __name__ == "__main__":
    main(sys.argv[1])
