import sys
import ptload
from ctranslate2.converters import opennmt_py as O
from ctranslate2.converters.converter import Converter

class NumpyOnmt(Converter):
    def __init__(self, path): self.path = path
    def _load(self):
        ck = ptload.load(self.path)
        itos = lambda side: ck["vocab"][side]._state["fields"][0][1]._state["vocab"]._state["itos"]
        src, tgt = [itos("src")], [itos("tgt")]
        O.check_opt(ck["opt"], num_source_embeddings=1)
        v = dict(ck["model"]); v.update({"generator.%s" % k: x for k, x in ck["generator"].items()})
        return O._get_model_spec_seq2seq(ck["opt"], v, src, tgt, num_source_embeddings=1)

NumpyOnmt(sys.argv[1]).convert(sys.argv[2], force=True)
