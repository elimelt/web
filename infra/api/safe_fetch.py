"""Fetch public HTTP resources without following redirects into private networks."""

import ipaddress
import socket
import time
from urllib.parse import urljoin, urlsplit

import urllib3


def public_addresses(host: str, port: int) -> list[str]:
    addresses = sorted({item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Only public Internet addresses are allowed")
    return addresses


def fetch_public_url(url: str, max_bytes: int = 5000) -> str:
    max_bytes = max(1, min(max_bytes, 20_000))
    deadline = time.monotonic() + 12
    for _ in range(4):
        if time.monotonic() >= deadline:
            raise ValueError("Fetch deadline exceeded")
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Only public HTTP/HTTPS URLs without credentials are allowed")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in (80, 443):
            raise ValueError("Only ports 80 and 443 are allowed")
        if len(url) > 2048:
            raise ValueError("URL is too long")
        host = parsed.hostname.encode("idna").decode("ascii")
        address = public_addresses(host, port)[0]
        # Pin the checked address, keeping the original hostname for Host/SNI/certificate checks.
        # Resolving again at connect time would permit DNS rebinding.
        options = {"timeout": urllib3.Timeout(connect=3, read=3, total=6), "maxsize": 1}
        if parsed.scheme == "https":
            pool = urllib3.HTTPSConnectionPool(address, port, server_hostname=host,
                                               assert_hostname=host, cert_reqs="CERT_REQUIRED", **options)
        else:
            pool = urllib3.HTTPConnectionPool(address, port, **options)
        response = None
        try:
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            response = pool.urlopen("GET", path, headers={"Host": parsed.netloc, "Accept-Encoding": "identity"},
                                    redirect=False, retries=False, preload_content=False, decode_content=False)
            if response.status in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                if not location:
                    raise ValueError("Redirect has no destination")
                url = urljoin(url, location)
                continue
            if not 200 <= response.status < 300:
                raise ValueError(f"HTTP {response.status}")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("Compressed responses are not accepted")
            chunks = []
            remaining = max_bytes
            while remaining:
                if time.monotonic() >= deadline:
                    raise ValueError("Fetch deadline exceeded")
                chunk = response.read1(min(1024, remaining), decode_content=False)
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            content = b"".join(chunks)
            return f"status={response.status}\n{content.decode('utf-8', errors='replace')}"
        finally:
            if response is not None:
                response.close()
            pool.close()
    raise ValueError("Too many redirects")
