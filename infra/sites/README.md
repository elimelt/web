# Static sites

elimelt.com and notes.elimelt.com are plain static files on Cloudflare Pages.
Nothing they serve runs on the homelab.

| Host | Source | Workflow | Pages project |
| --- | --- | --- | --- |
| elimelt.com (www redirects) | repository root (Astro) | `.github/workflows/web-deploy.yml` | `elimelt` |
| notes.elimelt.com | `notes/` (Quartz) | `.github/workflows/notes-deploy.yml` | `elimelt-notes` |

Each workflow builds on a GitHub-hosted runner and uploads the output as an
artifact. `publish-site.yml` downloads it and runs `wrangler pages deploy`
against the project, then checks that the host answers. Pages keeps every
deployment and purges its own cache, so changes show up immediately.

The projects, custom domains, DNS records, and the www redirect are in
`infra/terraform/main.tf`. Response headers live in `frontend/public/_headers`
and `notes/quartz-site/routes/_headers`.

## Setup

1. Create a Cloudflare API token with **Account > Cloudflare Pages > Edit**
   only. Save it as the `CLOUDFLARE_PAGES_TOKEN` repository secret, and save
   the account ID as the `CLOUDFLARE_ACCOUNT_ID` repository variable.
2. `terraform apply` in `infra/terraform` to create the projects, attach the
   domains, and point DNS at Pages.
3. Run both deploy workflows once (below).

## Deploy and roll back

Redeploy the current `main` with `gh workflow run web-deploy.yml` or
`gh workflow run notes-deploy.yml`. Roll back from the project's Deployments
tab in the Cloudflare dashboard (Rollback to this deployment).

## Homelab (offline)

`publish.sh` and `purge-cache.sh` published to Caddy on the homelab and purged
the edge cache. Nothing calls them now; they are kept for when the homelab
comes back.
