import importlib.util
from pathlib import Path
import unittest


source = Path(__file__).resolve().parents[2] / 'xor/prototype/compare-pilot-native.py'
spec = importlib.util.spec_from_file_location('pilot_comparison', source)
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class PilotComparisonTest(unittest.TestCase):
    def rows(self, correct):
        return [{'id': str(index), 'inputHash': str(index), 'family': str(index // 3), 'expected': verdict, 'observed': verdict if correct else {'allow': 'disallow', 'disallow': 'allow', 'ask': 'allow'}[verdict], 'infrastructureError': None, 'latencySeconds': 0.2} for index, verdict in enumerate(['allow', 'disallow', 'ask'] * 10)]

    def test_matched_three_seed_improvement_uses_family_blocks(self):
        report = comparison.compare([self.rows(False)], [self.rows(True)] * 3, repetitions=100)
        self.assertEqual(report['seeds'], 3)
        self.assertEqual(report['families'], 10)
        self.assertEqual(report['accuracyChange95PercentInterval'], [1, 1])
        self.assertEqual(report['differences']['harmfulAllowed']['perSeedChanges'], [-1, -1, -1])
        self.assertEqual(report['differences']['ordinaryRefused']['meanChange'], -1)
        self.assertEqual(report['pairs'][0]['reference']['counts']['prohibitedApprovals'], 10)
        self.assertEqual(report['pairs'][0]['candidate']['counts']['correct'], 30)

    def test_changed_expected_answer_cannot_be_compared(self):
        rows = self.rows(True)
        rows[0]['expected'] = 'ask'
        with self.assertRaisesRegex(RuntimeError, 'do not match'):
            comparison.compare([self.rows(False)], [rows])

    def test_failed_inference_cannot_enter_a_quality_comparison(self):
        rows = self.rows(True)
        rows[0]['infrastructureError'] = 'timeout'
        with self.assertRaisesRegex(RuntimeError, 'invalidates comparison'):
            comparison.compare([self.rows(False)], [rows])

    def test_breakdowns_preserve_errors_and_incomplete_permission_families(self):
        rows = [row | {'split': 'validation', 'topic': 'files', 'category': 'local', 'preference': 'default'} for row in self.rows(True)]
        rows[0]['observed'] = 'disallow'
        rows[0]['latencySeconds'] = 9
        result = comparison.details({'rows': rows})['validation']
        self.assertEqual(result['permissionContrasts'], {'families': 10, 'allCorrectFamilies': 9})
        self.assertEqual(result['breakdowns']['topic']['files']['counts']['ordinaryRefusals'], 1)
        self.assertEqual(result['metrics']['latency95Seconds'], 0.2)
        self.assertEqual(result['metrics']['latencyMaximumSeconds'], 9)


if __name__ == '__main__':
    unittest.main()
