"""Read data written under one schema with code built for another.

python3 evolution.py pypi_files.jsonl.gz > evolution.json

For every schema change and format, encode all records with the writer schema,
decode them with the reader schema, and classify the outcome against what the
reader should see (the writer's values for shared fields, the reader's default
for fields the writer lacks). JSON and MessagePack carry no schema, so their
"reader" is modelled as typical application code: a fixed set of field names,
d.get(name, default) where the field has a default, d[name] where it does not,
extra keys ignored.
"""
import copy, io, json, os, re, sys, tempfile, traceback
import fastavro, msgpack
import thriftpy2
from thriftpy2.protocol import TCompactProtocolFactory
from thriftpy2.utils import serialize, deserialize
import dataset, formats

TMP = tempfile.mkdtemp(prefix="evo-")
sys.path.insert(0, TMP)
PROTO_V1 = open(os.path.join(formats.SCHEMAS, "record_v1.proto")).read()
AVRO_V1 = json.load(open(os.path.join(formats.SCHEMAS, "record_v1.avsc")))
THRIFT_V1 = open(os.path.join(formats.SCHEMAS, "record_v1.thrift")).read()
_n = [0]

# ---- schema variants --------------------------------------------------------
def proto(text):
    _n[0] += 1
    stem = "evo%d" % _n[0]
    text = text.replace("package enc.v1;", "package enc.%s;" % stem)
    open(os.path.join(TMP, stem + ".proto"), "w").write(text)
    import subprocess, importlib
    subprocess.run([sys.executable, "-m", "grpc_tools.protoc", "-I" + TMP,
                    "--python_out=" + TMP, os.path.join(TMP, stem + ".proto")], check=True)
    return importlib.import_module(stem + "_pb2").FileRecord

def thrift(text):
    _n[0] += 1
    p = os.path.join(TMP, "evo%d.thrift" % _n[0])
    open(p, "w").write(text)
    return thriftpy2.load(p, module_name="evo%d_thrift" % _n[0]).FileRecord

def avro(edit):
    s = copy.deepcopy(AVRO_V1); edit(s["fields"]); return fastavro.parse_schema(s)

def drop(fields, name):
    fields[:] = [f for f in fields if f["name"] != name]

# Each change: a v2 schema for each format, plus the field list (with defaults)
# that hand-written JSON/MessagePack code would use for v2.
V1_FIELDS = [(k, None if k == "requires_python" else "REQUIRED") for k in formats.FIELDS]

def fields_without(name):
    return [f for f in V1_FIELDS if f[0] != name]

CHANGES = {}

CHANGES["add field (with default)"] = dict(
    note="v2 appends downloads: int64, default 0",
    proto=PROTO_V1.replace("bytes sha256 = 10;", "bytes sha256 = 10;\n  int64 downloads = 11;"),
    thrift=THRIFT_V1.replace("10: required binary sha256", "10: required binary sha256\n  11: optional i64 downloads = 0"),
    avro=lambda f: f.append({"name": "downloads", "type": "long", "default": 0}),
    fields=V1_FIELDS + [("downloads", 0)],
    new_values={"downloads": 12345})

CHANGES["remove optional field"] = dict(
    note="v2 drops requires_python (optional, default null)",
    proto=PROTO_V1.replace("  optional string requires_python = 6;\n", "  reserved 6;\n"),
    thrift=THRIFT_V1.replace("  6: optional string requires_python\n", ""),
    avro=lambda f: drop(f, "requires_python"),
    fields=fields_without("requires_python"))

CHANGES["remove required field"] = dict(
    note="v2 drops python_version (no default in v1)",
    proto=PROTO_V1.replace("  string python_version = 5;\n", "  reserved 5;\n"),
    thrift=THRIFT_V1.replace("  5: required string python_version\n", ""),
    avro=lambda f: drop(f, "python_version"),
    fields=fields_without("python_version"))

def _rename(alias):
    def edit(f):
        for x in f:
            if x["name"] == "size":
                x["name"] = "size_bytes"
                if alias:
                    x["aliases"] = ["size"]
    return edit

CHANGES["rename field (Avro alias)"] = dict(
    note="v2 renames size to size_bytes; same tag/id; Avro reader schema lists aliases: [size]",
    proto=PROTO_V1.replace("int64 size = 7;", "int64 size_bytes = 7;"),
    thrift=THRIFT_V1.replace("i64 size", "i64 size_bytes"),
    avro=_rename(True),
    fields=[("size_bytes", "REQUIRED") if k == "size" else (k, d) for k, d in V1_FIELDS],
    rename={"size": "size_bytes"})

CHANGES["rename field (no alias)"] = dict(
    note="as above, without the Avro alias",
    avro=_rename(False),
    fields=[("size_bytes", "REQUIRED") if k == "size" else (k, d) for k, d in V1_FIELDS],
    rename={"size": "size_bytes"})

def _narrow(f):
    for x in f:
        if x["name"] == "upload_time":
            x["type"] = "int"

CHANGES["narrow int64 to int32"] = dict(
    note="v2 declares upload_time (microseconds, ~1.6e15) as int32",
    proto=PROTO_V1.replace("int64 upload_time = 8;", "int32 upload_time = 8;"),
    thrift=THRIFT_V1.replace("i64 upload_time", "i32 upload_time"),
    avro=_narrow,
    fields=V1_FIELDS, int32="upload_time")

CHANGES["reuse a removed tag"] = dict(
    note="v2 deletes size (tag 7) and adds downloads: int64 with tag 7",
    proto=PROTO_V1.replace("int64 size = 7;", "int64 downloads = 7;"),
    thrift=THRIFT_V1.replace("7: required i64 size", "7: optional i64 downloads = 0"),
    fields=fields_without("size") + [("downloads", 0)],
    new_values={"downloads": 12345}, reuse=True)

def _insert(f):
    f.insert(1, {"name": "downloads", "type": "long", "default": 0})

CHANGES["insert field mid-record"] = dict(
    note="v2 inserts downloads after name (Avro field order and MessagePack array position)",
    avro=_insert,
    fields=V1_FIELDS[:1] + [("downloads", 0)] + V1_FIELDS[1:],
    new_values={"downloads": 12345}, positional=True)

# ---- expected reader view ---------------------------------------------------
def expected(rec_written, reader_fields, change, writer_is_v2):
    """What a correct reader with `reader_fields` should see for a record."""
    ren = change.get("rename", {})
    src = dict(rec_written)
    if not writer_is_v2:                      # v1 data read by v2 code
        for old, new in ren.items():
            src[new] = src.pop(old)
    else:                                     # v2 data read by v1 code
        for old, new in ren.items():
            src[old] = src.pop(new)
    out = {}
    for k, d in reader_fields:
        if k in src:
            out[k] = src[k]
        elif d != "REQUIRED":
            out[k] = d
        else:
            out[k] = "<missing>"
    return out

def v2_record(r, change):
    x = dict(r)
    for old, new in change.get("rename", {}).items():
        x[new] = x.pop(old)
    v2_names = [k for k, _ in change["fields"]]
    x = {k: x[k] for k in x if k in v2_names}
    for k, v in change.get("new_values", {}).items():
        x[k] = v
    return x

# ---- per-format write/read ---------------------------------------------------
def py_reader(fields):
    def read(d):
        return {k: (d[k] if dv == "REQUIRED" else d.get(k, dv)) for k, dv in fields}
    return read

def run_dictlike(enc, dec, rows, change, direction):
    v1f, v2f = V1_FIELDS, change["fields"]
    if direction == "backward":   # v2 code reads v1 data
        written, rfields, wv2 = rows, v2f, False
    else:                         # v1 code reads v2 data
        written, rfields, wv2 = [v2_record(r, change) for r in rows], v1f, True
    read = py_reader(rfields)
    return [(lambda b: read(dec(b)), enc(w), expected(w, rfields, change, wv2)) for w in written]

def run_msgpack_array(rows, change, direction):
    v1f, v2f = V1_FIELDS, change["fields"]
    if direction == "backward":
        written, wf, rfields, wv2 = rows, v1f, v2f, False
    else:
        written, wf, rfields, wv2 = [v2_record(r, change) for r in rows], v2f, v1f, True
    names = [k for k, _ in rfields]
    def read(b):
        arr = msgpack.unpackb(b)
        return dict(zip(names, arr + [d for _, d in rfields[len(arr):]]))
    return [(read, msgpack.packb([w[k] for k, _ in wf]), expected(w, rfields, change, wv2)) for w in written]

def proto_dict(m, fields):
    out = {}
    for k, _ in fields:
        if k == "requires_python":
            out[k] = m.requires_python if m.HasField("requires_python") else None
        else:
            out[k] = getattr(m, k)
    return out

def run_proto(rows, change, direction):
    v1cls, v2cls = formats.pb1.FileRecord, proto(change["proto"])
    if direction == "backward":
        wcls, rcls, written, rfields, wv2 = v1cls, v2cls, rows, change["fields"], False
    else:
        wcls, rcls, written, rfields, wv2 = v2cls, v1cls, [v2_record(r, change) for r in rows], V1_FIELDS, True
    def build(w):
        m = wcls()
        for k, v in w.items():
            if v is not None:
                setattr(m, k, v)
        return m.SerializeToString()
    def read(b):
        m = rcls(); m.ParseFromString(b); return proto_dict(m, rfields)
    exp = []
    for w in written:
        e = expected(w, rfields, change, wv2)
        if change.get("reuse") and direction == "backward":
            e["downloads"] = 0              # v1 data has no downloads
        exp.append(e)
    return [(read, build(w), e) for w, e in zip(written, exp)]

def run_thrift(rows, change, direction):
    v1cls, v2cls = formats.th1.FileRecord, thrift(change["thrift"])
    f = TCompactProtocolFactory()
    if direction == "backward":
        wcls, rcls, written, rfields, wv2 = v1cls, v2cls, rows, change["fields"], False
    else:
        wcls, rcls, written, rfields, wv2 = v2cls, v1cls, [v2_record(r, change) for r in rows], V1_FIELDS, True
    def read(b):
        o = deserialize(rcls(), b, f)
        return {k: getattr(o, k) for k, _ in rfields}
    exp = []
    for w in written:
        e = expected(w, rfields, change, wv2)
        if change.get("reuse") and direction == "backward":
            e["downloads"] = 0
        exp.append(e)
    return [(read, serialize(wcls(**w), f), e) for w, e in zip(written, exp)]

def run_avro(rows, change, direction, resolve=True):
    v1, v2 = formats.av1, avro(change["avro"])
    if direction == "backward":
        ws, rs, written, rfields, wv2 = v1, v2, rows, change["fields"], False
    else:
        ws, rs, written, rfields, wv2 = v2, v1, [v2_record(r, change) for r in rows], V1_FIELDS, True
    def enc(w):
        b = io.BytesIO(); fastavro.schemaless_writer(b, ws, w); return b.getvalue()
    if resolve:     # reader is given the writer's schema and resolves (the Avro way)
        read = lambda b: fastavro.schemaless_reader(io.BytesIO(b), ws, rs)
    else:           # reader wrongly assumes the bytes were written with its own schema
        read = lambda b: fastavro.schemaless_reader(io.BytesIO(b), rs, None)
    return [(read, enc(w), expected(w, rfields, change, wv2)) for w in written]

# ---- classify --------------------------------------------------------------
def classify(cases):
    n = len(cases); errors = {}; wrong = 0; example = None
    for read, blob, exp in cases:
        try:
            got = read(blob)
        except Exception as e:  # noqa: BLE001 - recording the failure is the point
            msg = "%s: %s" % (type(e).__name__, str(e).splitlines()[0][:120] if str(e) else "")
            errors[msg] = errors.get(msg, 0) + 1
            continue
        got = {k: got.get(k) for k in exp}
        if got != exp:
            wrong += 1
            if example is None:
                diff = {k: {"expected": exp[k], "got": got[k]} for k in exp if got[k] != exp[k]}
                example = {k: {kk: (vv.hex() if isinstance(vv, bytes) else vv) for kk, vv in v.items()}
                           for k, v in diff.items()}
    ok = n - wrong - sum(errors.values())
    if errors:
        status = "error"
    elif wrong:
        status = "silent wrong value"
    else:
        status = "ok"
    by_type = {}
    for msg, k in errors.items():
        t = msg.split(":")[0]
        by_type.setdefault(t, {"count": 0, "first": msg})
        by_type[t]["count"] += k
    return {"status": status, "records": n, "ok": ok, "wrong": wrong,
            "errors": by_type, "example": example}

def main(path):
    rows = dataset.load(path)
    out = {}
    for cname, ch in CHANGES.items():
        out[cname] = {"note": ch["note"]}
        for direction in ("backward", "forward"):
            if "int32" in ch and direction == "forward":
                continue          # v2 cannot write a microsecond timestamp as int32
            res = {}
            if not ch.get("positional"):
                res["JSON"] = classify(run_dictlike(formats.json_enc, formats.json_dec, rows, ch, direction))
                res["MessagePack (map)"] = classify(run_dictlike(formats.msgpack_enc, formats.msgpack_dec, rows, ch, direction))
            if "rename" not in ch and not ch.get("reuse") and "int32" not in ch:
                res["MessagePack (array)"] = classify(run_msgpack_array(rows, ch, direction))
            if "proto" in ch:
                res["Protobuf"] = classify(run_proto(rows, ch, direction))
            if "thrift" in ch:
                res["Thrift compact"] = classify(run_thrift(rows, ch, direction))
            if "avro" in ch:
                res["Avro (writer schema known)"] = classify(run_avro(rows, ch, direction))
                res["Avro (writer schema assumed)"] = classify(run_avro(rows, ch, direction, resolve=False))
            out[cname][direction] = res
    out["read-modify-write"] = rmw(rows)
    json.dump(out, sys.stdout, indent=1, default=str)

# ---- read-modify-write by old code --------------------------------------------
def rmw(rows):
    """v1 code reads a v2 record (with downloads), sets yanked, writes it back;
    v2 code then reads it. Does downloads survive?"""
    ch = CHANGES["add field (with default)"]
    v2 = [v2_record(r, ch) for r in rows]
    res = {}
    def tally(survived):
        return {"records": len(survived), "downloads_preserved": sum(survived)}
    # JSON, kept as a dict
    res["JSON, dict passed through"] = tally([
        formats.json_dec(formats.json_enc({**formats.json_dec(formats.json_enc(w)), "yanked": True})).get("downloads") == 12345
        for w in v2])
    # JSON, mapped to the v1 field list (a typed object) and back
    read1 = py_reader(V1_FIELDS)
    res["JSON, mapped to v1 fields"] = tally([
        formats.json_dec(formats.json_enc({**read1(formats.json_dec(formats.json_enc(w))), "yanked": True})).get("downloads") == 12345
        for w in v2])
    # Protobuf: v1 message keeps unknown fields
    v2cls = proto(ch["proto"])
    surv = []
    for w in v2:
        m2 = v2cls(**{k: v for k, v in w.items() if v is not None})
        m1 = formats.pb1.FileRecord(); m1.ParseFromString(m2.SerializeToString())
        m1.yanked = True
        back = v2cls(); back.ParseFromString(m1.SerializeToString())
        surv.append(back.downloads == 12345)
    res["Protobuf"] = tally(surv)
    # Avro: v1 reader resolves, writes v1, v2 reader resolves
    av2 = avro(ch["avro"])
    surv = []
    for w in v2:
        b = io.BytesIO(); fastavro.schemaless_writer(b, av2, w)
        d1 = fastavro.schemaless_reader(io.BytesIO(b.getvalue()), av2, formats.av1)
        d1["yanked"] = True
        b = io.BytesIO(); fastavro.schemaless_writer(b, formats.av1, d1)
        d2 = fastavro.schemaless_reader(io.BytesIO(b.getvalue()), formats.av1, av2)
        surv.append(d2["downloads"] == 12345)
    res["Avro"] = tally(surv)
    # Thrift (thriftpy2)
    t2 = thrift(ch["thrift"]); f = TCompactProtocolFactory()
    surv = []
    for w in v2:
        o1 = deserialize(formats.th1.FileRecord(), serialize(t2(**w), f), f)
        o1.yanked = True
        o2 = deserialize(t2(), serialize(o1, f), f)
        surv.append(o2.downloads == 12345)
    res["Thrift compact (thriftpy2)"] = tally(surv)
    return res

if __name__ == "__main__":
    main(sys.argv[1])
