# Static sites

Caddy serves elimelt.com and notes.elimelt.com from the homelab through the
Cloudflare Tunnel, like the other services.

| Host | Source | Workflow |
| --- | --- | --- |
| elimelt.com (www redirects) | repository root (Astro) | `.github/workflows/web-deploy.yml` |
| notes.elimelt.com | `notes/` (Quartz) | `.github/workflows/notes-deploy.yml` |

Each workflow builds on a GitHub-hosted runner and uploads the output as an
artifact. `publish-site.yml` then runs on the `blink` self-hosted runner and calls
`publish.sh`, which copies the build to `$SITES_PATH/<site>/releases/<id>` and
atomically repoints `$SITES_PATH/<site>/current`. Caddy mounts `$SITES_PATH`
(default `/home/elimelt/sites`) read-only at `/srv/sites`. The last three
releases are kept.

Roll back by repointing `current` at an earlier release; Caddy picks it up on
the next request:

```bash
cd /home/elimelt/sites/notes
ls releases
ln -sfn releases/<release-id> current.tmp && mv -T current.tmp current
```

Redeploy the current `main` with `gh workflow run web-deploy.yml` or
`gh workflow run notes-deploy.yml`.
