#!/usr/bin/env bash
# Publish a built static site for Caddy to serve.
#
# Usage: infra/sites/publish.sh <web|notes> <build-dir> <release-id>
#
# Each build is copied to $SITES_PATH/<site>/releases/<release-id>, then the
# $SITES_PATH/<site>/current symlink is swapped to it in one rename, so Caddy
# never serves a half-copied tree. Older releases are pruned. To roll back,
# point current at an earlier release:
#   ln -sfn releases/<release-id> current.tmp && mv -T current.tmp current
set -euo pipefail

site="${1:?site name required}"
source_dir="${2:?build directory required}"
release="${3:?release id required}"
sites_path="${SITES_PATH:-/home/elimelt/sites}"
keep="${KEEP_RELEASES:-3}"

case "$site" in
  web | notes) ;;
  *)
    echo "Unknown site: $site" >&2
    exit 2
    ;;
esac

if [[ ! -f "$source_dir/index.html" ]]; then
  echo "Refusing to publish $source_dir: no index.html" >&2
  exit 1
fi

site_dir="$sites_path/$site"
releases="$site_dir/releases"
target="$releases/$release"
mkdir -p "$releases"

rm -rf "$target.partial"
# Hardlink files whose content matches the live release (releases are never
# modified in place), so unchanged assets don't take extra space. Checksums are
# needed because downloaded artifacts carry fresh mtimes.
link_dest=()
if [[ -d "$site_dir/current/" ]]; then
  link_dest=(--checksum --link-dest="$(readlink -f "$site_dir/current")")
fi
rsync -rlD "${link_dest[@]}" --chmod=a+rX "$source_dir/" "$target.partial/"
rm -rf "$target"
mv "$target.partial" "$target"

# Relative target so the link also resolves inside the Caddy container.
ln -sfn "releases/$release" "$site_dir/current.tmp"
mv -T "$site_dir/current.tmp" "$site_dir/current"
echo "Published $site release $release"

live="$(readlink "$site_dir/current")"
find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' \
  | sort -rn | tail -n +"$((keep + 1))" | while read -r _ old; do
      if [[ "releases/$old" != "$live" ]]; then
        rm -rf "${releases:?}/$old"
        echo "Pruned $site release $old"
      fi
    done
