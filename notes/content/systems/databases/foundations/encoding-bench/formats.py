"""Encoders and decoders for one logical record type in several formats.

Each codec maps a Python dict (the record from dataset.py) to bytes and back.
Protobuf classes are generated with grpcio-tools' protoc into a temp dir.
"""
import base64, importlib, io, json, os, struct, subprocess, sys, tempfile

import fastavro, msgpack, orjson
import thriftpy2
from thriftpy2.protocol import TCompactProtocolFactory, TBinaryProtocolFactory
from thriftpy2.transport import TMemoryBuffer
from thriftpy2.utils import serialize as thrift_serialize, deserialize as thrift_deserialize

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMAS = os.path.join(HERE, "schemas")
FIELDS = ["name", "version", "filename", "packagetype", "python_version",
          "requires_python", "size", "upload_time", "yanked", "sha256"]

_GEN = tempfile.mkdtemp(prefix="pbgen-")
sys.path.insert(0, _GEN)

def proto_module(stem):
    """Compile schemas/<stem>.proto and import the generated module."""
    subprocess.run([sys.executable, "-m", "grpc_tools.protoc", f"-I{SCHEMAS}",
                    f"--python_out={_GEN}", os.path.join(SCHEMAS, stem + ".proto")],
                   check=True)
    return importlib.import_module(stem + "_pb2")

def avro_schema(stem):
    with open(os.path.join(SCHEMAS, stem + ".avsc")) as fh:
        return fastavro.parse_schema(json.load(fh))

def thrift_module(stem):
    return thriftpy2.load(os.path.join(SCHEMAS, stem + ".thrift"),
                          module_name=stem.replace(".", "_") + "_thrift")

# ---- JSON -----------------------------------------------------------------
def _b64(r):
    return {**r, "sha256": base64.b64encode(r["sha256"]).decode()}

def _unb64(d):
    d["sha256"] = base64.b64decode(d["sha256"])
    return d

def json_enc(r):
    return json.dumps(_b64(r), separators=(",", ":")).encode()

def json_dec(b):
    return _unb64(json.loads(b))

def orjson_enc(r):
    return orjson.dumps(_b64(r))

def orjson_dec(b):
    return _unb64(orjson.loads(b))

# ---- MessagePack ----------------------------------------------------------
def msgpack_enc(r):
    return msgpack.packb(r)

def msgpack_dec(b):
    return msgpack.unpackb(b)

def msgpack_arr_enc(r):
    return msgpack.packb([r[k] for k in FIELDS])

def msgpack_arr_dec(b):
    return dict(zip(FIELDS, msgpack.unpackb(b)))

# ---- Protobuf -------------------------------------------------------------
pb1 = proto_module("record_v1")

def proto_build(r, cls=None):
    m = (cls or pb1.FileRecord)()
    m.name = r["name"]; m.version = r["version"]; m.filename = r["filename"]
    m.packagetype = r["packagetype"]; m.python_version = r["python_version"]
    if r["requires_python"] is not None:
        m.requires_python = r["requires_python"]
    m.size = r["size"]; m.upload_time = r["upload_time"]; m.yanked = r["yanked"]
    m.sha256 = r["sha256"]
    return m

def proto_enc(r):
    return proto_build(r).SerializeToString()

def proto_parse(b):
    m = pb1.FileRecord(); m.ParseFromString(b); return m

def proto_dec(b):
    m = pb1.FileRecord(); m.ParseFromString(b)
    return {"name": m.name, "version": m.version, "filename": m.filename,
            "packagetype": m.packagetype, "python_version": m.python_version,
            "requires_python": m.requires_python if m.HasField("requires_python") else None,
            "size": m.size, "upload_time": m.upload_time, "yanked": m.yanked,
            "sha256": m.sha256}

# ---- Avro -----------------------------------------------------------------
av1 = avro_schema("record_v1")

def avro_enc(r, schema=av1):
    buf = io.BytesIO(); fastavro.schemaless_writer(buf, schema, r); return buf.getvalue()

def avro_dec(b, writer=av1, reader=None):
    return fastavro.schemaless_reader(io.BytesIO(b), writer, reader)

def avro_container(records, schema=av1, codec="null"):
    buf = io.BytesIO(); fastavro.writer(buf, schema, records, codec=codec); return buf.getvalue()

# ---- Thrift ---------------------------------------------------------------
th1 = thrift_module("record_v1")

def thrift_enc(r, factory=TCompactProtocolFactory()):
    return thrift_serialize(th1.FileRecord(**r), factory)

def thrift_bin_enc(r):
    return thrift_enc(r, TBinaryProtocolFactory())

def thrift_dec(b, factory=TCompactProtocolFactory()):
    o = thrift_deserialize(th1.FileRecord(), b, factory)
    return {k: getattr(o, k) for k in FIELDS}

CODECS = {
    # name: (encode, decode)
    "JSON (json)": (json_enc, json_dec),
    "JSON (orjson)": (orjson_enc, orjson_dec),
    "MessagePack": (msgpack_enc, msgpack_dec),
    "MessagePack (array)": (msgpack_arr_enc, msgpack_arr_dec),
    "Protobuf": (proto_enc, proto_dec),
    "Avro": (avro_enc, avro_dec),
    "Thrift compact": (thrift_enc, thrift_dec),
    "Thrift binary": (thrift_bin_enc, lambda b: thrift_dec(b, TBinaryProtocolFactory())),
}
