"""Reads row groups of the minicrawl parquet file over HTTP range requests and
writes each one's rank, domain and page content to rg/rg_N.parquet.

Usage: python3 -I fetch_crawl.py FIRST LAST
"""
import io
import os
import ssl
import sys
import urllib.request

import pyarrow.parquet as pq

URL = "https://clickhouse-public-datasets.s3.amazonaws.com/minicrawl/data20230923.parquet"
# CA_BUNDLE names a certificate bundle when a proxy requires one.
CTX = ssl.create_default_context(cafile=os.environ.get("CA_BUNDLE"))


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), context=CTX, timeout=60)
        self.size = int(r.headers["Content-Length"])
        self.pos = 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        for attempt in range(5):
            try:
                req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
                data = urllib.request.urlopen(req, context=CTX, timeout=300).read()
                break
            except Exception as e:
                if attempt == 4:
                    raise
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


f = pq.ParquetFile(RangeFile(URL))
for i in range(int(sys.argv[1]), int(sys.argv[2])):
    t = f.read_row_group(i, columns=["rank", "domain", "content"])
    pq.write_table(t, f"rg/rg_{i}.parquet", compression="zstd")
    print(i, t.num_rows, flush=True)
print("CRAWLDONE", flush=True)
