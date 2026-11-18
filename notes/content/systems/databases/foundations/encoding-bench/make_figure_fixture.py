"""Write the test fixture for the EncodingBytes figure.

python3 make_figure_fixture.py pypi_files.jsonl.gz OUT.json
The figure re-implements each encoder in TypeScript; its test checks that the
TypeScript bytes equal the bytes these Python libraries produce, and that its
Avro and Protobuf decoders agree with fastavro and protobuf on misreads.
"""
import io, json, random, sys
import fastavro
import dataset, formats, evolution

FEATURED = ["numpy-2.3.0-cp313-cp313-manylinux_2_28_x86_64.whl",
            "requests-0.2.0.tar.gz", "pip-20.0-py2.py3-none-any.whl"]

def jsonable(r):
    return {**r, "sha256": r["sha256"].hex()}

def main(path, out):
    rows = dataset.load(path)
    by_file = {r["filename"]: r for r in rows}
    sample = [by_file[f] for f in FEATURED] + random.Random(1).sample(rows, 30)
    # v2 drops requires_python: a v1 record read by v2 code.
    ch = evolution.CHANGES["remove optional field"]
    av2 = evolution.avro(ch["avro"])
    pb2 = evolution.proto(ch["proto"])
    cases = []
    for r in sample:
        c = {"record": jsonable(r), "bytes": {}}
        for name, key in [("JSON (json)", "json"), ("MessagePack", "msgpack"),
                          ("Protobuf", "protobuf"), ("Avro", "avro"),
                          ("Thrift compact", "thrift")]:
            c["bytes"][key] = formats.CODECS[name][0](r).hex()
        b = formats.avro_enc(r)
        try:
            got = fastavro.schemaless_reader(io.BytesIO(b), av2, None)
            c["avro_misread"] = {"ok": True, "value": {k: (v.hex() if isinstance(v, bytes) else v) for k, v in got.items()}}
        except Exception as e:  # noqa: BLE001
            c["avro_misread"] = {"ok": False, "error": type(e).__name__}
        c["avro_resolved"] = {k: (v.hex() if isinstance(v, bytes) else v)
                              for k, v in fastavro.schemaless_reader(io.BytesIO(b), formats.av1, av2).items()}
        m = pb2(); m.ParseFromString(formats.proto_enc(r))
        c["proto_v2_reserialized"] = m.SerializeToString().hex()
        cases.append(c)
    json.dump(cases, open(out, "w"), separators=(",", ":"))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
