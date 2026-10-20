FROM caddy:2.11.4-builder AS builder
RUN xcaddy build v2.11.4 --with github.com/caddy-dns/cloudflare@v0.2.4
# Port 8443 needs no privileged bind capability. Remove xcaddy's file capability
# so the binary can execute with cap_drop: ALL and no-new-privileges.
RUN setcap -r /usr/bin/caddy

FROM caddy:2.11.4
RUN apk upgrade --no-cache ca-certificates
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
