"""Per-record encode and decode time, Python dict <-> bytes.

python3 bench_speed.py pypi_files.jsonl.gz REPS > one_process.json
run_speed.sh runs this in several fresh processes pinned to one CPU.
Each rep encodes (or decodes) all records in a list comprehension; the
reported value is ns per record. One warmup rep is discarded.
"""
import gc, json, sys, time
import dataset, formats

def bench(fn, items, reps):
    fn_items = [fn(x) for x in items]  # warmup, and keeps outputs alive once
    del fn_items
    out = []
    for _ in range(reps):
        gc.collect(); gc.disable()
        t0 = time.perf_counter_ns()
        res = [fn(x) for x in items]
        t1 = time.perf_counter_ns()
        gc.enable(); del res
        out.append((t1 - t0) / len(items))
    return out

def main(path, reps):
    rows = dataset.load(path)
    C = formats.CODECS
    ops = {}
    for name in ["JSON (json)", "JSON (orjson)", "MessagePack", "Protobuf", "Avro", "Thrift compact"]:
        enc, dec = C[name]
        blobs = [enc(r) for r in rows]
        ops[name] = {"encode": bench(enc, rows, reps), "decode": bench(dec, blobs, reps)}
    pbs = [formats.proto_enc(r) for r in rows]
    msgs = [formats.proto_parse(b) for b in pbs]
    ops["Protobuf (message only)"] = {
        "encode": bench(lambda m: m.SerializeToString(), msgs, reps),
        "decode": bench(formats.proto_parse, pbs, reps)}
    # Avro object container: whole file at once, reported per record.
    import io, fastavro
    def cont_write(_):
        return formats.avro_container(rows)
    blob = formats.avro_container(rows)
    def cont_read(_):
        return list(fastavro.reader(io.BytesIO(blob)))
    ops["Avro container"] = {
        "encode": [x / len(rows) for x in bench(cont_write, [0], reps)],
        "decode": [x / len(rows) for x in bench(cont_read, [0], reps)]}
    json.dump(ops, sys.stdout)

if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]))
