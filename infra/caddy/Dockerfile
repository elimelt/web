# Custom Caddy build with rate limiting plugin
FROM caddy:2.11.4-builder AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2.11.4

RUN apk upgrade --no-cache ca-certificates
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
