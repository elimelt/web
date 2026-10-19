# Pi-hole on blink

Pi-hole serves devices connected to Tailscale. DNS and the admin page are bound
to blink's Tailscale address, with loopback endpoints for local checks.

- DNS: `100.88.172.77:53`, UDP and TCP.
- Admin: <http://100.88.172.77:8081/admin/> (Tailscale required).
- Local checks: DNS `127.0.0.1:8053`, admin `127.0.0.1:18081`.
- Image: Pi-hole Docker `2026.09.0`, pinned by digest.
- Data: Docker volume `homelab-pihole_pihole_data`.
- Password: `secrets/admin_password`, mode 0600, ignored by Git.

Read the generated password on blink:

```bash
cat /home/elimelt/repos/web/infra/pihole/secrets/admin_password
```

The existing CoreDNS service answers `grep.elimelt.com` on
`100.88.172.77:5354`; Pi-hole forwards only that zone to it. Preview-domain
queries for `oasisdev.team` go to Cloudflare (`1.1.1.1` / `1.0.0.1`); other
queries go directly to Quad9 (`9.9.9.9` / `149.112.112.112`). Pi-hole's container also uses
explicit upstream DNS for startup and blocklist downloads, avoiding a dependency
on the host's resolver. The host retains Tailscale DNS for its private names.
DHCP and NTP are not provided by this container.

## Enable filtering for Tailscale clients

In the [Tailscale DNS console](https://login.tailscale.com/admin/dns):

1. Add **Custom nameserver** `100.88.172.77` as a **global** nameserver, with no
   domain restriction. Keep the existing split DNS entries and MagicDNS enabled.
2. Enable **Override DNS servers**. Keep this as the only global nameserver if
   every ordinary DNS query should be filtered; public alternatives can bypass
   Pi-hole.
3. Enable **Use with exit node** for this nameserver if clients use an exit node.
4. Keep **Use Tailscale DNS settings** enabled on each client.

The tailnet-wide change must be made in the console; local `tailscale set`
commands do not configure global nameservers. This repository has no configured
Tailscale admin API credential. The console change has been applied: blink
receives `100.88.172.77` as its global resolver, and queries from both online
MacBook clients have been observed in Pi-hole. Verify each additional device
using the checks below.

Clients outside Tailscale use their usual DNS. Browsers or apps using independent
secure DNS can bypass Pi-hole. DNS filtering does not remove every kind of ad.
If blink is unavailable, disable the override/remove this global nameserver to
restore clients' usual DNS; the single-server setup has no filtered failover.

## Start and maintain

From this directory:

```bash
docker compose up -d --wait
docker compose ps
docker compose logs --tail 80
docker exec pihole pihole -g
```

The default StevenBlack blocklist is installed and Pi-hole schedules its own
updates. Settings and lists persist in the named volume. Compose-managed settings
are read-only in the UI; edit `compose.yml` and recreate the container to change
them. To rotate the admin password, replace `secrets/admin_password` without
changing its permissions, then run `docker compose up -d --force-recreate`.

An enabled user systemd unit, `pihole.service`, retries startup until Docker and
blink's Tailscale address are ready, then starts CoreDNS and Pi-hole. User
lingering is already enabled on this machine, so this also runs at boot without
an interactive login. Containers use their own restart policies afterward.

```bash
mkdir -p ~/.config/systemd/user
ln -s /home/elimelt/repos/web/infra/pihole/pihole.service ~/.config/systemd/user/pihole.service
systemctl --user daemon-reload
systemctl --user enable --now pihole.service
systemctl --user status pihole.service
```

The unit assumes the existing `openclaw-private-dns-1` container is present.
If it has been removed, recreate it using `../openclaw/README.md` first. Image
upgrades require changing the pinned tag and digest; back up the volume before
an upgrade. Never use `docker compose down -v` unless intentionally deleting
Pi-hole's configuration and query history.

## Verify

On a Tailscale-connected computer with `dig`:

```bash
dig @100.88.172.77 example.com
dig @100.88.172.77 doubleclick.net
dig +tcp @100.88.172.77 grep.elimelt.com
```

Expected: ordinary public addresses, `0.0.0.0` for the blocked domain, and
`100.72.185.96` for the private service. These direct queries test reachability;
after the console change, also test the client's normal resolver:

- macOS: `dscacheutil -q host -a name doubleclick.net`
- Windows PowerShell: `Resolve-DnsName doubleclick.net -Type A`
- Linux: `getent ahostsv4 doubleclick.net`

Expect `0.0.0.0`. Repeat with `example.com` and expect public addresses. On
macOS, `dig` and `nslookup` do not reliably follow the system's scoped DNS
configuration, so use the native resolver command above.

For a browser or phone, visit a fresh name such as
`http://iphone-check-1.example.com` and find that exact name in Pi-hole's query
log with the device's Tailscale IP. The test page is intentionally nonexistent;
its appearance in the log confirms routing, while page failure alone does not.
Use a new label for each attempt to avoid DNS caches. Also check that a query
for `doubleclick.net` is marked blocked. Test with any exit node normally used
by that client, and test phones on cellular as well as Wi-Fi.

## DNS cache behavior and new preview records

Pi-hole honors positive record TTLs (`dns.cache.optimizer=-1` disables serving
expired records). `no-negcache` prevents Pi-hole itself from retaining negative
upstream answers. Positive caching and ad blocking remain enabled.

This was configured after `pr-4596.oasisdev.team` returned a cached NXDOMAIN
from Pi-hole and one Quad9 endpoint while the authoritative Cloudflare servers
and both Cloudflare recursive resolvers returned the new record. The zone's
negative TTL was 1800 seconds. The conditional Cloudflare route resolved this
incident, but cannot guarantee immediate availability for every new record:
upstream resolvers and client devices can still cache negative answers.

To clear Pi-hole's cache without restarting DNS:

```bash
docker exec pihole pihole reloaddns
```

On a Mac with an old negative answer, hold Option while opening the Tailscale
menu, then choose **Debug → Flush DNS Cache** (requires administrator
credentials). Restart the affected browser if needed. Compare the server and
the Mac's system resolver using:

```bash
dig @100.88.172.77 pr-4596.oasisdev.team A
dscacheutil -q host -a name pr-4596.oasisdev.team
```

For future preview deployments, create the DNS record before testing or
distributing the URL. A wildcard preview DNS record can avoid per-PR NXDOMAIN
caching when the application's routing supports it; that requires a separate
Cloudflare/application configuration change.

To revert only the cache tuning and preview-domain forwarding:

```bash
cd /home/elimelt/repos/web/infra/pihole
cp backups/compose.before-cache-fix.yml compose.yml
docker compose up -d --wait
```

## Roll back

First remove the global Pi-hole nameserver/disable the DNS override in Tailscale,
while preserving the pre-existing split DNS entries. Then, on blink:

```bash
systemctl --user disable --now pihole.service
cd /home/elimelt/repos/web/infra/pihole
docker compose stop
cp backups/Corefile.before-pihole ../openclaw/Corefile
docker restart openclaw-private-dns-1
```

This restores CoreDNS directly on port 53 and retains Pi-hole's data. The backup
contains the Corefile from immediately before installation; review it first if
the private DNS configuration has subsequently changed.

References: [Pi-hole Docker configuration](https://docs.pi-hole.net/docker/configuration/),
[Tailscale and Pi-hole](https://tailscale.com/kb/1114/pi-hole),
[Tailscale DNS](https://tailscale.com/docs/reference/dns-in-tailscale).
