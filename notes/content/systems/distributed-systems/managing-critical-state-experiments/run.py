"""Start etcd clusters on loopback with a delay proxy in front of each
member's peer URL, and measure request latency with bench.

Each raft message from member A to member B travels on a stream that B dialed
to A's advertised peer URL, so it passes A's proxy once. A proxy delay of d_A
on A therefore delays everything A sends by d_A, and the round trip between A
and B is d_A + d_B. The leader gets d = 0, so a follower's proxy delay equals
its round-trip time to the leader.

usage: python3 run.py OUT.json [quick]
"""
import json, os, re, shutil, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BIN = os.environ.get("BIN", os.path.join(ROOT, "..", "bin"))
ETCD = os.environ.get("ETCD", os.path.join(ROOT, "..", "etcd-v3.6.16-linux-amd64"))
DATA = os.environ.get("DATA", "/home/claude/exp/data")

def ports(i):
    b = 12379 + 10 * i
    return b, b + 1, b + 2  # client, peer listen, proxy (advertised peer)

def metric(i, name):
    txt = urllib.request.urlopen(f"http://127.0.0.1:{ports(i)[0]}/metrics", timeout=5).read().decode()
    return sum(float(m) for m in re.findall(rf"^{name} ([0-9.e+-]+)$", txt, re.M))

class Cluster:
    def __init__(self, delays_ms):
        self.d = delays_ms  # delays_ms[0] is the intended leader and should be 0
        self.procs = {}
        shutil.rmtree(DATA, ignore_errors=True)
        init = ",".join(f"m{i}=http://127.0.0.1:{ports(i)[2]}" for i in range(len(self.d)))
        for i, d in enumerate(self.d):
            c, p, x = ports(i)
            self.procs[("proxy", i)] = subprocess.Popen(
                [f"{BIN}/delayproxy", "-listen", f"127.0.0.1:{x}", "-target", f"127.0.0.1:{p}", "-delay", f"{d}ms"])
        for i in range(len(self.d)):
            self.start(i, init)
        self.wait_ready()
        self.make_leader(0)

    def start(self, i, init):
        c, p, x = ports(i)
        log = open(f"{DATA}-m{i}.log", "w")
        self.procs[("etcd", i)] = subprocess.Popen([
            f"{ETCD}/etcd", "--name", f"m{i}", "--data-dir", f"{DATA}/m{i}",
            "--listen-client-urls", f"http://127.0.0.1:{c}", "--advertise-client-urls", f"http://127.0.0.1:{c}",
            "--listen-peer-urls", f"http://127.0.0.1:{p}", "--initial-advertise-peer-urls", f"http://127.0.0.1:{x}",
            "--initial-cluster", init, "--initial-cluster-state", "new",
            "--heartbeat-interval", "100", "--election-timeout", "2000"], stdout=log, stderr=log)

    def ctl(self, i, *args):
        return subprocess.run([f"{ETCD}/etcdctl", f"--endpoints=127.0.0.1:{ports(i)[0]}", *args],
                              capture_output=True, text=True, timeout=20)

    def status(self, i):
        r = self.ctl(i, "endpoint", "status", "-w", "json")
        return json.loads(r.stdout)[0]["Status"] if r.returncode == 0 else None

    def wait_ready(self):
        for _ in range(120):
            st = [self.status(i) for i in range(len(self.d))]
            if all(st) and len({s["leader"] for s in st}) == 1 and st[0]["leader"] != 0:
                return
            time.sleep(0.5)
        raise RuntimeError("cluster not ready")

    def make_leader(self, target):
        for _ in range(10):
            st = [self.status(i) for i in range(len(self.d))]
            ids = [s["header"]["member_id"] for s in st]
            lead = st[0]["leader"]
            if lead == ids[target]:
                time.sleep(1.0)
                return
            cur = ids.index(lead)
            self.ctl(cur, "move-leader", format(ids[target], "x"))
            time.sleep(1.5)
        raise RuntimeError("could not move leader")

    def kill(self, i):
        self.procs[("etcd", i)].kill(); self.procs[("etcd", i)].wait()

    def close(self):
        for p in self.procs.values():
            p.kill()
        for p in self.procs.values():
            p.wait()

def bench(member, op, n=300, budget="15s"):
    r = subprocess.run([f"{BIN}/bench", "-endpoint", f"127.0.0.1:{ports(member)[0]}", "-op", op,
                        "-n", str(n), "-budget", budget], capture_output=True, text=True, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return json.loads(r.stdout)["us"]

def fsync_snapshot(alive):
    return {i: (metric(i, "etcd_disk_wal_fsync_duration_seconds_sum"),
                metric(i, "etcd_disk_wal_fsync_duration_seconds_count")) for i in alive}

def fsync_mean_ms(a, b):
    out = {}
    for i in b:
        ds, dc = b[i][0] - a[i][0], b[i][1] - a[i][1]
        out[i] = 1e3 * ds / dc if dc else None
    return out

def main():
    out_path = sys.argv[1]
    quick = len(sys.argv) > 2
    reps = 1 if quick else 3
    res = {"etcd": "3.6.16", "runs": []}
    def save():
        json.dump(res, open(out_path, "w"))

    # E1: three members, both followers at round-trip time r from the leader.
    for rep in range(reps):
        for r in ([0, 10] if quick else [0, 1, 2, 5, 10, 20, 50]):
            c = Cluster([0, r, r])
            try:
                a = fsync_snapshot(range(3))
                row = {"exp": "sym3", "rep": rep, "delays": c.d}
                for op in ["put", "get-linearizable", "get-serializable"]:
                    row[op] = bench(0, op)
                row["fsync_ms"] = fsync_mean_ms(a, fsync_snapshot(range(3)))
                res["runs"].append(row); save()
                print("sym3", rep, r, {op: sorted(row[op])[len(row[op]) // 2] / 1e3 for op in ["put", "get-linearizable", "get-serializable"]}, row["fsync_ms"], flush=True)
            finally:
                c.close()

    # E2: five members at different distances; then the nearest followers fail.
    for rep in range(reps):
        c = Cluster([0, 1, 3, 10, 30])
        try:
            alive = [0, 1, 2, 3, 4]
            for killed in [[], [1], [1, 2]]:
                for k in killed:
                    if k in alive:
                        c.kill(k); alive.remove(k)
                time.sleep(1.0)
                row = {"exp": "five", "rep": rep, "delays": c.d, "killed": killed, "put": bench(0, "put"),
                       "get-linearizable": bench(0, "get-linearizable")}
                res["runs"].append(row); save()
                print("five", rep, killed, sorted(row["put"])[len(row["put"]) // 2] / 1e3, flush=True)
        finally:
            c.close()

    # E3: the same write sent to the leader and to each follower.
    for rep in range(reps):
        c = Cluster([0, 5, 20])
        try:
            for m in range(3):
                row = {"exp": "via", "rep": rep, "delays": c.d, "member": m, "put": bench(m, "put"),
                       "get-serializable": bench(m, "get-serializable")}
                res["runs"].append(row); save()
                print("via", rep, m, sorted(row["put"])[len(row["put"]) // 2] / 1e3, flush=True)
        finally:
            c.close()

if __name__ == "__main__":
    main()
