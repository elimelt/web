#!/usr/bin/env python3
"""Consistent homelab exports, encrypted restic backups, and restore checks."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

STATE = Path('/var/lib/homelab-backup')
CURRENT = STATE / 'current'
EXCLUDED_CACHES = {'homelab_ollama_data', 'homelab_speaches_cache'}
DATABASE_VOLUMES = {'homelab_postgres_data', 'homelab_postgres_inbox_data', 'homelab_redis_data'}
RETENTION_WINDOWS_DAYS = (30, 90)
MIGRATION_TAG = 'migration-2026-10-15'
SQLITE_JOBS = [
    ('uptime-kuma', ['sqlite3'], '/app/data/kuma.db', 'uptime-kuma.db', 'homelab_uptime_kuma_data', 'kuma.db'),
    ('pihole', ['pihole-FTL', 'sqlite3'], '/etc/pihole/gravity.db', 'pihole-gravity.db', 'homelab-pihole_pihole_data', 'gravity.db'),
    ('pihole', ['pihole-FTL', 'sqlite3'], '/etc/pihole/pihole-FTL.db', 'pihole-history.db', 'homelab-pihole_pihole_data', 'pihole-FTL.db'),
]


def run(args, *, destination=None, stdin=None, env=None, timeout=1800):
    """Log only command names on failures: arguments can include private data."""
    with tempfile.TemporaryFile() as errors:
        if destination is None:
            result = subprocess.run(args, stdin=stdin, stdout=subprocess.PIPE, stderr=errors,
                                    env=env, timeout=timeout)
            value = result.stdout.decode()
        else:
            with Path(destination).open('wb') as stream:
                result = subprocess.run(args, stdin=stdin, stdout=stream, stderr=errors,
                                        env=env, timeout=timeout)
            value = ''
        if result.returncode:
            errors.seek(0)
            detail = errors.read().decode(errors='replace')
            # Private diagnostics remain local rather than being sent to the journal.
            with (STATE / 'last-error.log').open('a') as log:
                log.write(f'{args[0]} exited {result.returncode}\n{detail}\n')
            raise RuntimeError(f'{args[0]} exited {result.returncode}; see {STATE}/last-error.log')
        return value.strip()


def save_json(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.replace(path)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_exports(directory):
    checksums = json.loads((directory / 'checksums.json').read_text())
    for name, expected in checksums.items():
        if digest(directory / name) != expected:
            raise RuntimeError('Checksum mismatch in ' + name)
    manifest = json.loads((directory / 'manifest.json').read_text())
    for entry in manifest['sqlite']:
        with sqlite3.connect(f'file:{directory / entry["file"]}?mode=ro', uri=True) as connection:
            if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise RuntimeError('SQLite integrity check failed: ' + entry['file'])
    return manifest


def archive(destination, source, paths, excludes=()):
    args = ['tar', '--sort=name', '--numeric-owner', '--acls', '--xattrs', '--sparse']
    args += ['--exclude=' + pattern for pattern in excludes]
    args += ['-cpf', str(destination), '-C', str(source), *paths]
    run(args)


def prepare():
    incoming = STATE / 'preparing'
    if incoming.exists():
        shutil.rmtree(incoming)
    incoming.mkdir(mode=0o700)
    for name in ('databases', 'volumes', 'config', 'metadata'):
        (incoming / name).mkdir()
    root_snapshot, home_snapshot = STATE / 'root-source', STATE / 'home-source'
    for path in (root_snapshot, home_snapshot):
        if path.exists():
            run(['btrfs', 'subvolume', 'delete', str(path)])
    print('Exporting databases without stopping hosted services.', flush=True)
    containers = json.loads(run(['docker', 'inspect', *run(['docker', 'ps', '-aq']).splitlines()]))
    by_name = {c['Name'].lstrip('/'): c for c in containers}
    volumes = json.loads(run(['docker', 'volume', 'inspect', *run(['docker', 'volume', 'ls', '-q']).splitlines()]))
    save_json(incoming / 'metadata/containers.json', containers)
    save_json(incoming / 'metadata/volumes.json', volumes)
    run(['docker', 'network', 'inspect', *run(['docker', 'network', 'ls', '-q']).splitlines()],
        destination=incoming / 'metadata/networks.json')
    run(['pacman', '-Q'], destination=incoming / 'metadata/packages.txt')
    manifest = {'format': 1, 'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'postgres': [], 'sqlite': [], 'volumes': [], 'excluded_caches': sorted(EXCLUDED_CACHES),
                'notes': 'Databases are individually consistent online exports; file archives use read-only Btrfs snapshots. Not a full-machine image.'}
    for name in ('postgres', 'postgres-inbox'):
        if not by_name[name]['State']['Running']:
            raise RuntimeError(name + ' is not running; refusing an incomplete backup')
        prefix = ['docker', 'exec', name, 'sh', '-c']
        run(prefix + ['exec pg_dumpall -U "$POSTGRES_USER" --globals-only'],
            destination=incoming / f'databases/{name}-globals.sql')
        databases = run(prefix + ['exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname"']).splitlines()
        for index, database in enumerate(databases):
            safe = re.sub(r'[^a-zA-Z0-9_.-]', '_', database)
            relative = f'databases/{name}-{index}-{safe}.dump'
            run(prefix + ['exec pg_dump -U "$POSTGRES_USER" --format=custom --compress=0 --dbname="$1"', 'backup', database],
                destination=incoming / relative)
            with (incoming / relative).open('rb') as stream:
                run(['docker', 'exec', '-i', name, 'pg_restore', '--list'], stdin=stream)
            manifest['postgres'].append({'container': name, 'database': database, 'file': relative,
                                         'image': by_name[name]['Image'], 'image_reference': by_name[name]['Config']['Image']})
    for name, tool, source, filename, volume, volume_path in SQLITE_JOBS:
        temporary = '/tmp/homelab-r2-' + str(os.getpid()) + '-' + filename
        try:
            run(['docker', 'exec', name, *tool, source, '.timeout 30000', f".backup '{temporary}'"])
            run(['docker', 'cp', f'{name}:{temporary}', str(incoming / 'databases' / filename)])
        finally:
            run(['docker', 'exec', name, 'rm', '-f', temporary])
        manifest['sqlite'].append({'file': 'databases/' + filename, 'volume': volume, 'path': volume_path})
    run(['docker', 'exec', 'redis', 'redis-cli', '--rdb', '-'], destination=incoming / 'databases/redis.rdb')
    manifest['redis'] = {'file': 'databases/redis.rdb', 'image': by_name['redis']['Image'], 'volume': 'homelab_redis_data'}
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
         '--mount', f'type=bind,src={incoming / "databases/redis.rdb"},dst=/backup.rdb,readonly',
         '--entrypoint', 'redis-check-rdb', by_name['redis']['Image'], '/backup.rdb'])
    print('Archiving volume files and configuration from read-only snapshots.', flush=True)
    try:
        run(['btrfs', 'subvolume', 'snapshot', '-r', '/', str(root_snapshot)])
        run(['btrfs', 'subvolume', 'snapshot', '-r', '/home', str(home_snapshot)])
        for volume in volumes:
            name = volume['Name']
            if not name.startswith(('homelab_', 'homelab-pihole_', 'openclaw-private_')):
                continue
            if name in EXCLUDED_CACHES | DATABASE_VOLUMES:
                continue
            source = root_snapshot / volume['Mountpoint'].lstrip('/')
            if not source.is_dir():
                raise RuntimeError('Volume is outside the root snapshot: ' + name)
            excludes = []
            if name in ('homelab_uptime_kuma_data', 'homelab-pihole_pihole_data'):
                excludes = ['*.db', '*.db-wal', '*.db-shm', '*.db-journal']
            relative = f'volumes/{name}.tar'
            archive(incoming / relative, source, ['.'], excludes)
            manifest['volumes'].append({'name': name, 'file': relative})
        archive(incoming / 'config/etc.tar', root_snapshot, ['etc'], ['etc/homelab-backup'])
        archive(incoming / 'config/boot.tar', '/', ['boot'])
        user_paths = ['elimelt/.config', 'elimelt/.cloudflared', 'elimelt/.codex/auth.json',
                      'elimelt/repos/web', 'elimelt/repos/web-deploy']
        user_paths = [p for p in user_paths if (home_snapshot / p).exists()]
        archive(incoming / 'config/home.tar', home_snapshot, user_paths,
                ['.git', 'node_modules', '.terraform', '__pycache__', '.venv', 'venv',
                 'elimelt/repos/*/dist', 'elimelt/repos/*/infra/backups',
                 'elimelt/repos/*/notes/public', 'elimelt/repos/*/notes/.quartz',
                 'elimelt/.config/homelab-backup', 'elimelt/.config/.wrangler/logs',
                 '*/Cache', '*/Code Cache', '*/GPUCache'])
        manifest['config'] = [{'file': 'config/etc.tar', 'restore_root': '/'},
                              {'file': 'config/boot.tar', 'restore_root': '/'},
                              {'file': 'config/home.tar', 'restore_root': '/home'}]
    finally:
        for path in (home_snapshot, root_snapshot):
            if path.exists():
                run(['btrfs', 'subvolume', 'delete', str(path)])
    save_json(incoming / 'manifest.json', manifest)
    checksums = {str(p.relative_to(incoming)): digest(p) for p in sorted(incoming.rglob('*')) if p.is_file()}
    save_json(incoming / 'checksums.json', checksums)
    verify_exports(incoming)
    previous = STATE / 'previous'
    if previous.exists():
        shutil.rmtree(previous)
    if CURRENT.exists():
        CURRENT.rename(previous)
    incoming.rename(CURRENT)
    print(f'Prepared {len(checksums)} files ({sum(p.stat().st_size for p in CURRENT.rglob("*") if p.is_file()):,} bytes).', flush=True)


def restic_env(config):
    credentials = json.loads((config / 'r2.json').read_text())
    env = os.environ.copy()
    env.update(RESTIC_REPOSITORY=credentials['repository'], RESTIC_PASSWORD_FILE=str(config / 'password'),
               RESTIC_CACHE_DIR=str(STATE / 'restic-cache'), AWS_DEFAULT_REGION=credentials.get('region', 'auto'),
               AWS_ACCESS_KEY_ID=credentials.get('access_key_id', ''), AWS_SECRET_ACCESS_KEY=credentials.get('secret_access_key', ''))
    return env


def restic(config, args, **kwargs):
    return run(['restic', '--retry-lock', '5m', *args], env=restic_env(config), **kwargs)


def initialize(config):
    # Only an explicit "repository does not exist" permits initialization.
    env = restic_env(config)
    result = subprocess.run(['restic', 'snapshots', '--json'], env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, timeout=180)
    if result.returncode == 10:
        print(restic(config, ['init']), flush=True)
    elif result.returncode:
        (STATE / 'last-error.log').write_bytes(result.stderr)
        raise RuntimeError('Could not access repository; credentials/bucket must be checked before initialization.')


def backup(config, prepared=False):
    if not prepared:
        prepare()
    verify_exports(CURRENT)
    data = restic(config, ['backup', '--json', '--host', 'blink', '--tag', 'homelab', '--tag', 'scheduled',
                           '--group-by', 'host,tags', str(CURRENT)], timeout=7200)
    summaries = [json.loads(line) for line in data.splitlines() if json.loads(line).get('message_type') == 'summary']
    if not summaries or not summaries[-1].get('snapshot_id'):
        raise RuntimeError('Backup did not return a completed snapshot')
    result = summaries[-1]
    restic(config, ['check'])
    result['time'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result['repository'] = restic_env(config)['RESTIC_REPOSITORY']
    save_json(STATE / 'last-success.json', result)
    print('Backup stored and repository structure checked: ' + result['snapshot_id'], flush=True)
    return result['snapshot_id']


def verify_databases(directory, manifest):
    for name in ('postgres', 'postgres-inbox'):
        entries = [p for p in manifest['postgres'] if p['container'] == name]
        temporary = f'homelab-r2-restore-{name}-{os.getpid()}'
        try:
            run(['docker', 'run', '-d', '--rm', '--name', temporary, '--network', 'none',
                 '--memory', '1g', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
                 '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', entries[0]['image']])
            for attempt in range(60):
                ready = subprocess.run(['docker', 'exec', temporary, 'pg_isready', '-U', 'postgres'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Restore-test PostgreSQL did not start')
            for index, entry in enumerate(entries):
                database = 'restorecheck' + str(index)
                run(['docker', 'exec', temporary, 'createdb', '-U', 'postgres', database])
                with (directory / entry['file']).open('rb') as stream:
                    run(['docker', 'exec', '-i', temporary, 'pg_restore', '-U', 'postgres',
                         '--dbname', database, '--no-owner', '--no-privileges', '--exit-on-error'], stdin=stream)
        finally:
            subprocess.run(['docker', 'stop', '--timeout', '10', temporary], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
         '--mount', f'type=bind,src={directory / manifest["redis"]["file"]},dst=/backup.rdb,readonly',
         '--entrypoint', 'redis-check-rdb', manifest['redis']['image'], '/backup.rdb'])


def verify(config):
    print('Reading encrypted backup data and testing an isolated restore.', flush=True)
    restic(config, ['check', '--read-data'], timeout=7200)
    snapshots = json.loads(restic(config, ['snapshots', '--json', '--host', 'blink', '--tag', 'scheduled', '--latest', '1']))
    if len(snapshots) != 1:
        raise RuntimeError('Expected one latest scheduled backup')
    snapshot = snapshots[0]['id']
    target = Path(tempfile.mkdtemp(prefix='restore-check-', dir=STATE))
    try:
        restic(config, ['restore', snapshot + ':' + str(CURRENT), '--target', str(target), '--verify'], timeout=7200)
        manifest = verify_exports(target)
        verify_databases(target, manifest)
        save_json(STATE / 'last-restore-check.json', {'snapshot_id': snapshot, 'success': True,
                  'repository': restic_env(config)['RESTIC_REPOSITORY'],
                  'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'checks': ['all repository data read', 'restored files verified', 'all export checksums matched',
                             'SQLite integrity', 'all PostgreSQL dumps restored in isolated containers', 'Redis RDB validated']})
        print('Full restore test passed: ' + snapshot, flush=True)
    finally:
        shutil.rmtree(target)


def retention_plan(snapshots):
    """Keep the newest export and the oldest available points within 30/90 days.

    One snapshot may serve multiple tiers. The migration archive occupies a spare
    slot only; it is never exempt from the three-snapshot cap.
    """
    def when(snapshot):
        value = datetime.datetime.fromisoformat(snapshot['time'].replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise RuntimeError('Snapshot timestamp has no timezone')
        return value

    scheduled, migration = [], []
    for snapshot in snapshots:
        tags = set(snapshot.get('tags', []))
        if snapshot.get('hostname') != 'blink':
            raise RuntimeError('Unexpected host in this dedicated backup repository; retention stopped')
        if {'homelab', 'scheduled'} <= tags:
            scheduled.append(snapshot)
        elif {'maintenance', MIGRATION_TAG} <= tags:
            migration.append(snapshot)
        else:
            raise RuntimeError('Unrecognized snapshot in this dedicated repository; retention stopped')
    scheduled.sort(key=lambda s: (when(s), s['id']))
    if not scheduled:
        raise RuntimeError('No scheduled backup; retention stopped')
    newest = scheduled[-1]
    keep = {newest['id']}
    tiers = {'newest': newest['id']}
    for days in RETENTION_WINDOWS_DAYS:
        cutoff = when(newest) - datetime.timedelta(days=days)
        selected = next(s for s in scheduled if when(s) >= cutoff)
        keep.add(selected['id'])
        tiers[f'up_to_{days}_days'] = selected['id']
    for snapshot in sorted(migration, key=when, reverse=True):
        if len(keep) < 3:
            keep.add(snapshot['id'])
    return {'newest': newest['id'], 'tiers': tiers, 'keep': sorted(keep),
            'remove': sorted(s['id'] for s in snapshots if s['id'] not in keep)}


def retain(config):
    snapshots = json.loads(restic(config, ['snapshots', '--json']))
    plan = retention_plan(snapshots)
    verification = json.loads((STATE / 'last-restore-check.json').read_text())
    repository = restic_env(config)['RESTIC_REPOSITORY']
    if (verification.get('success') is not True
            or verification.get('snapshot_id') != plan['newest']
            or verification.get('repository') != repository):
        raise RuntimeError('The newest backup must pass a restore test in this repository before retention')
    plan.update(repository=repository, time=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                maximum_snapshots=3, windows_days=list(RETENTION_WINDOWS_DAYS))
    save_json(STATE / 'retention-plan.json', plan)
    if plan['remove']:
        print(restic(config, ['forget', '--prune', *plan['remove']], timeout=7200))
    restic(config, ['check'])
    remaining = json.loads(restic(config, ['snapshots', '--json']))
    if {s['id'] for s in remaining} != set(plan['keep']) or len(remaining) > 3:
        raise RuntimeError('Unexpected snapshot set after retention')
    save_json(STATE / 'last-retention.json', plan)
    print(f'Retention checked: {len(remaining)} of at most 3 snapshots retained.', flush=True)


def maintain(config):
    verify(config)
    retain(config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-dir', type=Path, default=Path('/etc/homelab-backup'))
    parser.add_argument('--prepared', action='store_true', help='Upload already prepared exports without taking new ones')
    parser.add_argument('action', choices=['prepare', 'init', 'backup', 'run', 'verify', 'retain', 'maintain', 'restic'])
    parser.add_argument('restic_args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo; consistent exports include protected service data.')
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'job.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            if args.action == 'prepare':
                prepare()
            elif args.action == 'init':
                initialize(args.config_dir)
            elif args.action == 'backup':
                backup(args.config_dir, args.prepared)
            elif args.action == 'run':
                backup(args.config_dir, args.prepared)
                maintain(args.config_dir)
            elif args.action == 'verify':
                verify(args.config_dir)
            elif args.action == 'retain':
                retain(args.config_dir)
            elif args.action == 'maintain':
                maintain(args.config_dir)
            else:
                print(restic(args.config_dir, args.restic_args, timeout=7200))
        except Exception as error:
            save_json(STATE / 'last-failure.json', {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                                  'action': args.action, 'error': str(error)})
            print(str(error), file=sys.stderr)
            raise SystemExit(1)


if __name__ == '__main__':
    main()
