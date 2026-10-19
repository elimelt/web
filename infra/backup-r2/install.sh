#!/usr/bin/env bash
set -euo pipefail
if (( EUID != 0 )); then
  echo 'Run this installer with sudo.' >&2
  exit 1
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 700 /var/lib/homelab-backup /etc/homelab-backup
install -m 755 "$source_dir/homelab_backup.py" /usr/local/sbin/homelab-r2-backup
for unit in "$source_dir"/*.service "$source_dir"/*.timer; do
  install -m 644 "$unit" /etc/systemd/system/
done
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/homelab-r2-{backup,maintain}.service /etc/systemd/system/homelab-r2-{backup,maintain}.timer
echo 'Installed. Timers are not enabled until the remote upload and restore test succeed.'
