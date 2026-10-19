import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch


source = Path(__file__).resolve().parents[2] / 'bordercollie/prototype/needle-4bit-study.py'
spec = importlib.util.spec_from_file_location('needle_study', source)
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class StudyExportTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.archive = self.directory / 'base.cact'
        self.archive.write_bytes(b'pinned base archive')
        self.destination = self.directory / 'baseline'
        self.destination.mkdir()
        self.plan = {
            'hashes': {},
            'runs': [{'label': 'baseline'}],
            'checkpoint': {'path': '/frozen/checkpoint'},
            'training': {'exportLayers': 20},
            'officialTrainerSourceSha256': study.digest(source),
            'baseArchive': {'path': str(self.archive), 'sha256': study.digest(self.archive)},
        }
        (self.directory / 'study-plan.json').write_text(json.dumps(self.plan))
        self.fetch = types.ModuleType('needle.agent.fetch')
        self.network = Mock(side_effect=RuntimeError('forced download in offline mode'))
        self.fetch.fetch_weights = self.network
        self.finetune = types.ModuleType('needle.model.finetune')
        self.finetune.__file__ = str(source)
        self.finetune.build_main = self.export
        needle = types.ModuleType('needle')
        agent = types.ModuleType('needle.agent')
        model = types.ModuleType('needle.model')
        agent.fetch = self.fetch
        model.finetune = self.finetune
        self.modules = {'needle': needle, 'needle.agent': agent, 'needle.agent.fetch': self.fetch, 'needle.model': model, 'needle.model.finetune': self.finetune}

    def export(self, args):
        self.assertEqual(self.fetch.fetch_weights(3, force=True), str(self.archive))
        self.assertEqual(args.checkpoint, '/frozen/checkpoint')
        self.assertEqual(args.lora, str(self.destination / 'adapter.safetensors'))
        self.assertEqual(args.layers, 20)
        self.assertIsNone(args.platform)
        self.assertFalse(args.upload)
        Path(args.out).write_bytes(b'exported model')

    def run_export(self):
        with patch.dict(sys.modules, self.modules), patch.object(study.importlib.metadata, 'version', return_value='3.1.2'):
            study.build(self.directory, 0)

    def test_official_export_uses_verified_local_archive_without_network(self):
        self.run_export()
        self.assertEqual((self.destination / 'candidate.cact').read_bytes(), b'exported model')
        self.network.assert_not_called()
        self.assertIs(self.fetch.fetch_weights, self.network)

    def test_changed_archive_cannot_reach_exporter(self):
        self.archive.write_bytes(b'changed archive')
        self.finetune.build_main = Mock()
        with self.assertRaisesRegex(RuntimeError, 'base archive changed'):
            self.run_export()
        self.finetune.build_main.assert_not_called()

    def test_changed_trainer_cannot_reach_exporter(self):
        self.plan['officialTrainerSourceSha256'] = 'changed'
        (self.directory / 'study-plan.json').write_text(json.dumps(self.plan))
        self.finetune.build_main = Mock()
        with self.assertRaisesRegex(RuntimeError, 'Official trainer changed'):
            self.run_export()
        self.finetune.build_main.assert_not_called()

    def test_fetch_override_is_restored_after_export_failure(self):
        self.finetune.build_main = Mock(side_effect=RuntimeError('export sentinel'))
        with self.assertRaisesRegex(RuntimeError, 'export sentinel'):
            self.run_export()
        self.assertIs(self.fetch.fetch_weights, self.network)

    def test_unregistered_generation_is_rejected(self):
        self.finetune.build_main = lambda args: self.fetch.fetch_weights(2, force=True)
        with self.assertRaisesRegex(RuntimeError, 'Unexpected base archive request'):
            self.run_export()
        self.network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
