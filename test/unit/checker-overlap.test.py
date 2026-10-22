import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('overlap_audit', Path(__file__).resolve().parents[2] / 'scripts/audit-checker-overlap.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckerOverlapTest(unittest.TestCase):
    def snapshot(self, root, rows):
        packets = []
        for row in rows:
            visible = {'version': '3', 'query': row.pop('visibleQuery', row['userMessage']), 'tools': []}
            digest = hashlib.sha256(json.dumps(visible, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            row['inputHash'] = digest
            packets.append({'id': row['id'], 'inputHash': digest, **visible})
        contents = ''.join(json.dumps(row) + '\n' for row in rows).encode()
        (root / 'proposals.jsonl').write_bytes(contents)
        packet_hash = hashlib.sha256(json.dumps(packets, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        (root / 'manifest.json').write_text(json.dumps({'cases': len(rows), 'proposalsSha256': hashlib.sha256(contents).hexdigest(), 'requestsSha256': packet_hash}))
        (root / 'review-packet.json').write_text(json.dumps({'requests': packets}))

    def test_detects_duplicate_input_and_crossed_family(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = {'id': 'one', 'family': 'same', 'inputHash': 'same-input', 'agent': 'opencode', 'tool': 'read', 'split': 'train', 'userMessage': 'Read the local catalog implementation and explain its sorting rules.'}
            self.snapshot(root, [base, {**base, 'id': 'two', 'split': 'test'}])
            report = module.inspect([root])
            self.assertEqual(report['status'], 'overlap-found')
            self.assertEqual(len(report['crossSplitExactInputs']), 1)
            self.assertEqual(len(report['crossSplitFamilies']), 1)

    def test_missing_source_and_changed_bytes_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(FileNotFoundError):
                module.inspect([root])
            self.snapshot(root, [{'id': 'one', 'family': 'family', 'inputHash': 'input', 'agent': 'opencode', 'tool': 'read', 'split': 'train', 'userMessage': 'Read project files.'}])
            (root / 'proposals.jsonl').write_text('altered')
            with self.assertRaisesRegex(ValueError, 'bytes changed'):
                module.inspect([root])

    def test_forged_hashes_cannot_hide_identical_visible_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = {'id': 'one', 'family': 'train-family', 'agent': 'opencode', 'tool': 'read', 'split': 'train', 'userMessage': 'Read the project catalog.'}
            self.snapshot(root, [base, {**base, 'id': 'two', 'family': 'test-family', 'split': 'test'}])
            packet = json.loads((root / 'review-packet.json').read_text())
            packet['requests'][1]['inputHash'] = 'forged'
            (root / 'review-packet.json').write_text(json.dumps(packet))
            manifest = json.loads((root / 'manifest.json').read_text())
            manifest['requestsSha256'] = hashlib.sha256(json.dumps(packet['requests'], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            (root / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'Visible request hash changed'):
                module.inspect([root])

    def test_no_sources_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'At least one'):
            module.inspect([])

    def test_isolated_inputs_do_not_claim_blindness(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.snapshot(root, [{'id': 'one', 'family': 'family', 'inputHash': 'input', 'agent': 'opencode', 'tool': 'read', 'split': 'train', 'userMessage': 'Read the project catalog.'}])
            report = module.inspect([root])
            self.assertEqual(report['status'], 'exact-overlap-check-passed')
            self.assertFalse(report['blindEvaluationQualified'])
            self.assertFalse(report['generatedCommandsExecuted'])


if __name__ == '__main__':
    unittest.main()
