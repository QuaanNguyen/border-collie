import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


source = Path(__file__).resolve().parents[2] / 'xor/prototype/submit-v2-pilot.py'
spec = importlib.util.spec_from_file_location('pilot_submission', source)
submission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(submission)


class PilotSubmissionTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        archive = self.directory / 'base.cact'
        archive.write_bytes(b'base')
        requests = self.directory / 'requests.jsonl'
        requests.write_text('{}\n')
        self.plan = {
            'status': 'frozen-diagnostic-pilot',
            'runs': [{}] * 24,
            'seeds': [0, 1, 2],
            'hashes': {'requests.jsonl': hashlib.sha256(requests.read_bytes()).hexdigest()},
            'wrapperHashes': {},
            'baseArchive': {'path': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()},
            'executionWaves': [[0, 1, 8, 9, 16, 17], [i for i in range(24) if i not in [0, 1, 8, 9, 16, 17]]],
        }
        (self.directory / 'preflight.json').write_text(json.dumps({'status': 'complete', 'maximumTokens': 690, 'sourceSha256': self.plan['hashes']['requests.jsonl']}))
        self.invocations = []

    def queue(self, command, text):
        self.invocations.append(command)
        return str(100 + len(self.invocations)) + '\n'

    def run_submission(self):
        (self.directory / 'study-plan.json').write_text(json.dumps(self.plan))
        with patch.object(submission.subprocess, 'check_output', side_effect=self.queue), contextlib.redirect_stdout(io.StringIO()):
            submission.submit(self.directory, '100')

    def test_waves_preserve_every_condition_and_global_worker_limits(self):
        self.run_submission()
        record = json.loads((self.directory / 'submission.json').read_text())
        jobs = record['jobs']
        commands = record['commands']
        fitting = commands['v2-pilot-fit']
        remaining = commands['v2-pilot-fit-wave2']
        self.assertIn('--array=0,1,8,9,16,17%2', fitting)
        self.assertIn('--dependency=afterok:' + jobs['v2-pilot-fit'] + ':' + jobs['v2-pilot-evaluate'], remaining)
        for name, command in commands.items():
            if name.startswith('v2-pilot-evaluate'):
                self.assertTrue(next(arg for arg in command if arg.startswith('--array=')).endswith('%4'))
        summary_dependency = next(arg for arg in commands['v2-pilot-summary'] if arg.startswith('--dependency='))
        for name in ['v2-pilot-fit', 'v2-pilot-evaluate', 'v2-pilot-fit-wave2', 'v2-pilot-evaluate-wave2']:
            self.assertIn(jobs[name], summary_dependency)
        self.assertEqual(record['executionWaves'], self.plan['executionWaves'])

    def test_overlapping_or_missing_conditions_cannot_queue_any_jobs(self):
        self.plan['executionWaves'][1].append(0)
        with self.assertRaisesRegex(RuntimeError, 'Execution waves'):
            self.run_submission()
        self.assertEqual(self.invocations, [])
        self.assertFalse((self.directory / 'submission.json').exists())


if __name__ == '__main__':
    unittest.main()
