#!/usr/bin/env python3
"""Enter R2 credentials locally without placing secrets in shell history."""
import getpass
import json
import os
from pathlib import Path
import re
import secrets


def private_write(path, content):
    temporary = path.with_name(path.name + '.tmp-' + secrets.token_hex(4))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
    temporary.replace(path)


def main():
    os.umask(0o077)
    directory = Path.home() / '.config/homelab-backup'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    print('Use an R2 Object Read & Write token restricted to the backup bucket.')
    account = input('Cloudflare account ID [8bc69aa4361608f17a792636299a44be]: ').strip() or '8bc69aa4361608f17a792636299a44be'
    bucket = input('Private Standard-storage bucket [blink-homelab-backups]: ').strip() or 'blink-homelab-backups'
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account):
        raise SystemExit('Invalid account ID; nothing saved.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket):
        raise SystemExit('Invalid bucket name; nothing saved.')
    access = getpass.getpass('R2 Access Key ID (hidden): ').strip()
    if not re.fullmatch(r'[a-fA-F0-9]{32}', access):
        raise SystemExit('Expected the 32-character Access Key ID, not the API token value; nothing saved.')
    secret = getpass.getpass('R2 Secret Access Key (hidden): ').strip()
    if not re.fullmatch(r'[a-fA-F0-9]{64}', secret):
        raise SystemExit('Expected the 64-character Secret Access Key; nothing saved.')
    configuration = {
        'repository': f's3:https://{account}.r2.cloudflarestorage.com/{bucket}/blink',
        'access_key_id': access,
        'secret_access_key': secret,
        'region': 'auto',
    }
    private_write(directory / 'r2.json', json.dumps(configuration, indent=2) + '\n')
    password = directory / 'password'
    if not password.exists():
        private_write(password, secrets.token_urlsafe(48) + '\n')
    recovery = (
        'BLINK HOMELAB BACKUP RECOVERY — STORE THIS IN YOUR PASSWORD MANAGER\n\n'
        f"Restic repository: {configuration['repository']}\n"
        f"Restic encryption password: {password.read_text().strip()}\n\n"
        'You also need R2 credentials. A new token for this bucket can be created\n'
        'in Cloudflare if the original token is lost. The encryption password\n'
        'cannot be recreated by Cloudflare. Keep this record off this machine.\n'
    )
    private_write(directory / 'RECOVERY.txt', recovery)
    print(f'Credentials saved privately to {directory / "r2.json"}.')
    print(f'Save the contents of {directory / "RECOVERY.txt"} in your password manager.')
    print('Configuration saved. Tell the assistant to continue the upload and restore test.')


if __name__ == '__main__':
    main()
