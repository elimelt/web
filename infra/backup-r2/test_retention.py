"""Safety checks for bounded retention; no network or production data used."""
import datetime
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import homelab_backup as backup


def snapshot(day, migration=False):
    return {
        'id': ('migration-' if migration else 'backup-') + str(day),
        'hostname': 'blink',
        'time': (datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
                 + datetime.timedelta(days=day)).isoformat(),
        'tags': ['maintenance', backup.MIGRATION_TAG] if migration else ['homelab', 'scheduled'],
    }


class RetentionTests(unittest.TestCase):
    def test_initial_migration_counts_toward_cap(self):
        plan = backup.retention_plan([snapshot(0), snapshot(0, migration=True)])
        self.assertEqual(set(plan['keep']), {'backup-0', 'migration-0'})
        self.assertEqual(plan['remove'], [])

    def test_monthly_and_quarterly_points_evict_migration(self):
        plan = backup.retention_plan([snapshot(day) for day in (0, 7, 14, 21, 28, 35)]
                                     + [snapshot(0, migration=True)])
        self.assertEqual(set(plan['keep']), {'backup-0', 'backup-7', 'backup-35'})
        self.assertIn('migration-0', plan['remove'])

    def test_expired_points_are_replaced(self):
        plan = backup.retention_plan([snapshot(day) for day in (0, 14, 70, 98)])
        self.assertEqual(set(plan['keep']), {'backup-14', 'backup-70', 'backup-98'})
        self.assertEqual(plan['remove'], ['backup-0'])

    def test_years_of_weekly_rotation_never_exceed_cap(self):
        retained = [snapshot(0, migration=True)]
        for day in range(0, 1096, 7):
            retained.append(snapshot(day))
            plan = backup.retention_plan(retained)
            retained = [s for s in retained if s['id'] in plan['keep']]
            self.assertLessEqual(len(retained), 3)
            self.assertIn('backup-' + str(day), plan['keep'])
            for s in retained:
                if 'scheduled' in s['tags']:
                    age = day - int(s['id'].split('-')[1])
                    self.assertLessEqual(age, 90)

    def test_unrecognized_snapshots_stop_deletion(self):
        unknown = snapshot(7)
        unknown['tags'] = ['manual']
        with self.assertRaises(RuntimeError):
            backup.retention_plan([snapshot(0), unknown])
        unknown['tags'] = ['homelab', 'scheduled']
        unknown['hostname'] = 'another-machine'
        with self.assertRaises(RuntimeError):
            backup.retention_plan([snapshot(0), unknown])

    def test_missing_fresh_remote_restore_proof_prevents_deletion(self):
        snapshots = [snapshot(day) for day in (0, 14, 70, 98)]
        for proof in (
            {'success': False, 'snapshot_id': 'backup-98', 'repository': 'remote'},
            {'success': True, 'snapshot_id': 'backup-70', 'repository': 'remote'},
            {'success': True, 'snapshot_id': 'backup-98', 'repository': 'local-test'},
        ):
            with self.subTest(proof=proof), tempfile.TemporaryDirectory() as temporary:
                state = Path(temporary)
                (state / 'last-restore-check.json').write_text(json.dumps(proof))
                with patch.object(backup, 'STATE', state), \
                        patch.object(backup, 'restic_env', return_value={'RESTIC_REPOSITORY': 'remote'}), \
                        patch.object(backup, 'restic', return_value=json.dumps(snapshots)) as restic:
                    with self.assertRaises(RuntimeError):
                        backup.retain(Path('/unused'))
                    restic.assert_called_once_with(Path('/unused'), ['snapshots', '--json'])


if __name__ == '__main__':
    unittest.main()
