"""Load a zip-format PyTorch checkpoint into numpy without importing torch."""
import collections, pickle, zipfile
import numpy as np

_DT = {"FloatStorage": np.float32, "HalfStorage": np.float16, "LongStorage": np.int64,
       "IntStorage": np.int32, "ByteStorage": np.uint8, "BoolStorage": np.bool_, "DoubleStorage": np.float64}

class Stub:
    def __init__(self, *a, **k): self._args = a
    def __setstate__(self, s): self.__dict__["_state"] = s
    def __repr__(self): return f"Stub({type(self).__name__})"

def _rebuild_tensor_v2(storage, offset, size, stride, *rest):
    arr = storage
    if len(size) == 0:
        return arr[offset].copy()
    itemsize = arr.itemsize
    return np.lib.stride_tricks.as_strided(arr[offset:], shape=tuple(size),
                                           strides=tuple(s * itemsize for s in stride)).copy()

def load(path):
    z = zipfile.ZipFile(path)
    prefix = z.namelist()[0].split("/")[0]
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if mod == "torch._utils" and name == "_rebuild_tensor_v2":
                return _rebuild_tensor_v2
            if mod == "torch" and name in _DT:
                return name
            if mod == "collections" and name == "OrderedDict":
                return collections.OrderedDict
            if mod in ("builtins", "copyreg", "__builtin__"):
                return super().find_class(mod, name)
            if mod == "argparse" and name == "Namespace":
                return super().find_class(mod, name)
            return type(name, (Stub,), {"_module": mod})
        def persistent_load(self, pid):
            _, stype, key, loc, numel = pid
            raw = z.read(f"{prefix}/data/{key}")
            return np.frombuffer(raw, dtype=_DT[stype])
    with z.open(f"{prefix}/data.pkl") as f:
        return U(f).load()
