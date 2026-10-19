#!/usr/bin/env bash
set -euo pipefail
if (( EUID != 0 )); then
  echo 'Run with sudo.' >&2
  exit 1
fi
python3 - <<'PY'
import json,os,secrets
from pathlib import Path
os.umask(0o077)
p=Path('/var/lib/homelab-backup/test-config')
p.mkdir(mode=0o700,exist_ok=True)
(p/'r2.json').write_text(json.dumps({'repository':'/var/lib/homelab-backup/test-repository'}))
if not (p/'password').exists():
 (p/'password').write_text(secrets.token_urlsafe(48)+'\n')
PY
/usr/local/sbin/homelab-r2-backup --config-dir /var/lib/homelab-backup/test-config init
/usr/local/sbin/homelab-r2-backup --config-dir /var/lib/homelab-backup/test-config --prepared backup
/usr/local/sbin/homelab-r2-backup --config-dir /var/lib/homelab-backup/test-config verify
