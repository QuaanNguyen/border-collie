import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/audit-checker-tokens.py'
ARCHIVE = ROOT / 'xor/prototype/output/current-runtime-cache/2ae11323dc000f5e70c49f7403efa6af12ba9e67/needle3.cact'
CREATE_SNAPSHOT = r'''
const fs = require('node:fs');
const path = require('node:path');
const data = require(path.resolve('xor/prototype/checker-data.js'));
const rows = [{id: 'audit-case', family: 'audit-family', split: 'train', agent: 'codex', tool: 'exec_command', args: {cmd: 'pwd'}, userMessage: 'Show the current folder.', preference: {text: 'Allow reading the current folder path.'}}];
const contents = rows.map(JSON.stringify).join('\n') + '\n';
const requests = data.reviewPacket(rows);
fs.writeFileSync(path.join(process.argv[1], 'proposals.jsonl'), contents);
fs.writeFileSync(path.join(process.argv[1], 'review-packet.json'), JSON.stringify({instructions: data.REVIEW_INSTRUCTIONS, instructionHash: data.REVIEW_INSTRUCTION_HASH, requests}));
fs.writeFileSync(path.join(process.argv[1], 'manifest.json'), JSON.stringify({cases: rows.length, requestFormatVersion: '3', proposalsSha256: data.digest(contents), requestsSha256: data.digest(requests)}));
'''


class TokenAuditTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='checker-token-test-')
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        subprocess.run(['node', '-e', CREATE_SNAPSHOT, str(self.directory)], cwd=ROOT, check=True, capture_output=True)
        self.output = self.directory / 'report.json'

    def run_audit(self, maximum=4096):
        return subprocess.run(['python3', str(SCRIPT), str(self.directory), '--archive', str(ARCHIVE), '--output', str(self.output), '--max-length', str(maximum)], cwd=ROOT, capture_output=True, text=True)

    def test_rejects_proposal_hash_change_before_loading_tokenizer(self):
        proposal = self.directory / 'proposals.jsonl'
        proposal.write_text(proposal.read_text().replace('Show the current folder.', 'Delete the current folder.'))
        result = self.run_audit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Proposal hash changed', result.stderr)
        self.assertFalse(self.output.exists())

    def test_rejects_request_change_before_loading_tokenizer(self):
        file = self.directory / 'review-packet.json'
        packet = json.loads(file.read_text())
        packet['requests'][0]['query'] = 'Changed input'
        file.write_text(json.dumps(packet))
        result = self.run_audit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Captured inputs differ from production inputs', result.stderr)
        self.assertFalse(self.output.exists())

    def test_preserves_existing_evidence(self):
        self.output.write_text('existing evidence')
        result = self.run_audit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Preserve existing token reports', result.stderr)
        self.assertEqual(self.output.read_text(), 'existing evidence')

    @unittest.skipUnless(ARCHIVE.is_file(), 'Pinned local tokenizer archive is required')
    def test_limit_failure_reports_complete_lengths_without_truncation(self):
        names = ('manifest.json', 'proposals.jsonl', 'review-packet.json')
        before = {name: (self.directory / name).read_bytes() for name in names}
        result = self.run_audit(1)
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(self.output.read_text())
        self.assertEqual(report['status'], 'length-limit-exceeded')
        self.assertTrue(report['frozenInputsUnchanged'])
        self.assertFalse(report['trainingEligibilityAssessed'])
        self.assertEqual(report['inputFilesSha256'].keys(), before.keys())
        for name in names:
            self.assertEqual((self.directory / name).read_bytes(), before[name])
        for renderer in ('official', 'emptyThinkingDirect'):
            self.assertGreater(report['results'][renderer]['maximum'], 1)
            self.assertEqual(report['results'][renderer]['overConfiguredLimit'], 1)
            self.assertEqual(set(report['rows'][0]['renderers'][renderer]['byVerdict']), {'approve', 'deny', 'ask'})
        self.assertEqual(report['results']['emptyThinkingDirect']['maximum'], report['results']['official']['maximum'] + 4)


if __name__ == '__main__':
    unittest.main()
