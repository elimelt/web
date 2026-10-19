# Private OpenClaw DNS and HTTPS

Target URL: **https://grep.elimelt.com** (Tailscale required).

## Architecture

- Pi-hole on `100.88.172.77:53` (blink) forwards `grep.elimelt.com` to
  CoreDNS on `100.88.172.77:5354`, which answers only that private zone.
- Tailscale split DNS sends that domain's lookups to this resolver.
- The record points to a separate userspace Tailscale node, `grep-private`.
- That node forwards private TCP 443 to Caddy on `127.0.0.1:18443` using
  PROXY protocol v2, preserving the original tailnet client's IP.
- Caddy terminates TLS and forwards HTTP/WebSockets to `127.0.0.1:18789`.
- OpenClaw retains token authentication and browser pairing. Only the local
  Caddy proxy is trusted, and allowed origins include `https://grep.elimelt.com`.

The host Tailscale instance and its existing public Funnel on 443 are separate.
No Funnel is enabled on `grep-private`. Public websites keep using their current
Cloudflare records and Tunnel routes.

Caddy obtains/renews certificates through Cloudflare DNS-01, using the token in
`../.env`. A public A record is not required. Public certificate transparency
logs can still disclose the hostname: private DNS does not make its name secret.
Use a dedicated Cloudflare token scoped to elimelt.com with Zone:DNS:Edit and
Zone:Zone:Read. Certificate and Tailscale state stay in Docker volumes.

## Deployed addresses

- Resolver: `100.88.172.77:53` (UDP and TCP)
- Authoritative backend: CoreDNS at `100.88.172.77:5354`; the port-53
  frontend is managed by [`../pihole`](../pihole/README.md).
- Private proxy node: `100.72.185.96:443`
- Public A/AAAA records for grep.elimelt.com: none

The temporary port-8443 listener has been retired. The old public A record was
removed through Terraform. The private address is saved in ignored `.env.private`.

## Enroll the private node

From this directory, always set the project name explicitly because `../.env`
contains the public homelab's Compose project name.

```bash
docker compose --project-name openclaw-private --env-file ../.env up -d tailnet
docker compose --project-name openclaw-private --env-file ../.env exec tailnet tailscale --socket=/tmp/tailscaled.sock up --hostname=grep-private --accept-dns=false
```

Open the printed login link and enroll it in the intended tailnet. State persists
across restarts; do not delete the `tailscale_state` volume. No enrollment key is
stored in the tracked configuration.

Configure TCP forwarding (saved in the node's persistent state):

```bash
docker compose --project-name openclaw-private --env-file ../.env exec tailnet tailscale --socket=/tmp/tailscaled.sock serve --bg --tcp=443 --proxy-protocol=2 tcp://127.0.0.1:18443
docker compose --project-name openclaw-private --env-file ../.env exec tailnet tailscale --socket=/tmp/tailscaled.sock ip -4
```

Put that IPv4 address in an ignored `.env.private` file as `PRIVATE_PROXY_IP=...`.

## Start DNS and HTTPS

```bash
docker compose --project-name openclaw-private --env-file ../.env build proxy
docker compose --project-name openclaw-private --env-file ../.env run --rm proxy caddy validate --config /etc/caddy/Caddyfile
docker compose --project-name openclaw-private --env-file ../.env --env-file .env.private -f compose.yml -f compose.dns.yml up -d
```

In the Tailscale admin console, DNS → Nameservers → Add custom nameserver:

- Nameserver: `100.88.172.77`
- Enable **Restrict to domain / Split DNS**
- Domain: **`grep.elimelt.com`**, not all of `elimelt.com`

Clients must have “Use Tailscale DNS” enabled. Browsers using an independent
secure-DNS resolver may bypass the operating system's split DNS settings.
Existing unrelated split DNS routes should be preserved. The CoreDNS backend is
non-recursive and does not serve the public elimelt.com zone. Pi-hole handles
general filtered resolution separately; see its README for global DNS setup.

Tailnet ACLs/grants must allow the intended users/devices to reach blink on
TCP/UDP 53 and grep-private on TCP 443. Tailnet policy is administered in the
Tailscale console, not in this repository.

## Verify

```bash
dig @100.88.172.77 grep.elimelt.com A
dig +tcp @100.88.172.77 grep.elimelt.com A
curl -I https://grep.elimelt.com/
openclaw security audit
```

Public DNS should return no A/AAAA address for this hostname. Test from another
tailnet device, then disconnect Tailscale and check again after cached entries
expire. Private access still requires gateway authentication and device pairing.

Validate Caddy and restart the proxy to apply file changes (admin API is disabled).

To stop the private services while retaining their state:

```bash
docker compose --project-name openclaw-private --env-file ../.env --env-file .env.private -f compose.yml -f compose.dns.yml down
```
