#!/usr/bin/env python3
"""Activate only after a successful R2 upload and remote restore test."""
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo after configure.py.')
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    user_config = Path('/home/elimelt/.config/homelab-backup')
    credentials = json.loads((user_config / 'r2.json').read_text())
    if not re.fullmatch(r's3:https://[a-fA-F0-9]{32}\.r2\.cloudflarestorage\.com/[a-z0-9-]+/blink', credentials['repository']):
        raise SystemExit('Expected a private R2 endpoint and the /blink repository prefix.')
    if (not re.fullmatch(r'[a-fA-F0-9]{32}', credentials.get('access_key_id', ''))
            or not re.fullmatch(r'[a-fA-F0-9]{64}', credentials.get('secret_access_key', ''))):
        raise SystemExit('Expected the R2 Access Key ID and Secret Access Key. Run configure.py again; do not use the API token value.')
    password = (user_config / 'password').read_bytes()
    if len(password.strip()) < 32:
        raise SystemExit('The encryption password is missing or unexpectedly short.')
    installed_password = Path('/etc/homelab-backup/password')
    if installed_password.exists() and installed_password.read_bytes() != password:
        raise SystemExit('Saved encryption passwords differ; preserve the original repository password before continuing.')
    subprocess.run(['bash', str(source / 'install.sh')], check=True)
    for name in ('r2.json', 'password'):
        subprocess.run(['install', '-m', '600', str(user_config / name), '/etc/homelab-backup/' + name], check=True)
    command = ['/usr/local/sbin/homelab-r2-backup']
    subprocess.run(command + ['init'], check=True)
    subprocess.run(command + ['backup'], check=True)
    tag = 'migration-2026-10-15'
    snapshots = json.loads(subprocess.check_output(command + ['restic', 'snapshots', '--json', '--tag', tag]))
    maintenance = Path('/home/elimelt/.local/state/machine-maintenance/2026-10-15')
    archives = [maintenance / 'services-20261015-110237', maintenance / 'protected-20261015-110343']
    if not snapshots and all(path.exists() for path in archives):
        with Path('/var/lib/homelab-backup/migration-upload.jsonl').open('w') as log:
            subprocess.run(command + ['restic', 'backup', '--json', '--host', 'blink', '--tag', 'maintenance',
                                      '--tag', tag, *map(str, archives)], stdout=log, check=True)
    subprocess.run(command + ['verify'], check=True)
    subprocess.run(command + ['retain'], check=True)
    subprocess.run(['systemctl', 'disable', '--now', 'homelab-r2-maintain.timer'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'homelab-r2-backup.timer'], check=True)
    Path('/var/lib/homelab-backup/activated.json').write_text(json.dumps({
        'repository': credentials['repository'], 'remote_restore_verified': True,
        'weekly_backup_timer_enabled': True, 'restore_test_after_each_backup': True,
        'maximum_retained_snapshots': 3, 'retention_windows_days': [30, 90],
    }, indent=2) + '\n')
    print('R2 upload and restore verified; weekly backups with three-snapshot retention are enabled.')


if __name__ == '__main__':
    main()
