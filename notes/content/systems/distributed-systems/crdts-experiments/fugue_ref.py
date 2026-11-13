"""An independent Fugue (Weidner and Kleppmann, Algorithm 1) in Python.

Replays every session in reference-sessions.json and stores the converged text
under "fugue", so the figure's TypeScript Fugue can be checked against it.

    python3 fugue_ref.py
"""
import json
import pathlib

ROOT = None  # the root's id


class Fugue:
    def __init__(self, replica):
        self.replica = replica
        self.counter = 0
        # id -> {"value", "deleted", "left": [ids], "right": [ids]}
        self.nodes = {ROOT: {"value": None, "deleted": True, "left": [], "right": []}}

    def _walk(self, nid, out):
        node = self.nodes[nid]
        for c in node["left"]:
            self._walk(c, out)
        if nid is not ROOT:
            out.append(nid)
        for c in node["right"]:
            self._walk(c, out)

    def traversal(self):
        out = []
        self._walk(ROOT, out)
        return out

    def visible(self):
        return [n for n in self.traversal() if not self.nodes[n]["deleted"]]

    def insert(self, i, value):
        vis = self.visible()
        left_origin = vis[i - 1] if i > 0 else ROOT
        self.counter += 1
        nid = (self.replica, self.counter)
        if not self.nodes[left_origin]["right"]:
            op = ("ins", nid, value, left_origin, "R")
        else:
            order = self.traversal()
            nxt = order.index(left_origin) + 1 if left_origin is not ROOT else 0
            op = ("ins", nid, value, order[nxt], "L")
        self.receive(op)
        return op

    def delete(self, i):
        op = ("del", self.visible()[i])
        self.receive(op)
        return op

    def receive(self, op):
        if op[0] == "del":
            self.nodes[op[1]]["deleted"] = True
            return
        _, nid, value, parent, side = op
        if nid in self.nodes:
            return
        self.nodes[nid] = {"value": value, "deleted": False, "left": [], "right": []}
        sibs = self.nodes[parent]["left" if side == "L" else "right"]
        sibs.append(nid)
        sibs.sort()  # ids are (replica, counter) tuples: lexicographic order

    def text(self):
        return "".join(self.nodes[n]["value"] for n in self.visible())


def replay(session):
    origin = Fugue("o")
    base_ops = [origin.insert(i, ch) for i, ch in enumerate(session["base"])]
    reps = {"A": Fugue("A"), "B": Fugue("B")}
    for r in reps.values():
        for op in base_ops:
            r.receive(op)
    queue = {"A": [], "B": []}
    for a in session["actions"]:
        if a.get("sync"):
            for op in queue["A"]:
                reps["B"].receive(op)
            for op in queue["B"]:
                reps["A"].receive(op)
            queue = {"A": [], "B": []}
        elif "del" in a:
            queue[a["r"]].append(reps[a["r"]].delete(a["del"]))
        else:
            queue[a["r"]].append(reps[a["r"]].insert(a["ins"], a["ch"]))
    assert reps["A"].text() == reps["B"].text(), session["seed"]
    return reps["A"].text()


if __name__ == "__main__":
    path = pathlib.Path(__file__).with_name("reference-sessions.json")
    data = json.loads(path.read_text())
    for s in data["sessions"]:
        s["fugue"] = replay(s)
    data["fugue"] = "fugue_ref.py"
    path.write_text(json.dumps(data) + "\n")
    print(f"added fugue results to {len(data['sessions'])} sessions")
