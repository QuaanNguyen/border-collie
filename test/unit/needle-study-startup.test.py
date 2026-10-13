import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


source = Path(__file__).resolve().parents[2] / 'guard/prototype/needle-4bit-study.py'
spec = importlib.util.spec_from_file_location('needle_study', source)
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class StudyStartupTest(unittest.TestCase):
    def test_registered_configuration_survives_a_model_load_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            plan = {
                'runs': [{'label': 'startup', 'size': 0, 'seed': 0, 'training': {'loraRank': 32}}],
                'training': {'loraRank': 16, 'loraAlpha': 32},
                'checkpoint': {'path': str(directory / 'checkpoint'), 'sha256': 'verified'},
                'officialTrainerSourceSha256': 'verified',
            }
            jax = types.ModuleType('jax')
            jax.default_backend = lambda: 'gpu'
            numpy = types.ModuleType('numpy')
            needle = types.ModuleType('needle')
            model = types.ModuleType('needle.model')
            finetune = types.ModuleType('needle.model.finetune')
            checkpoints = types.ModuleType('needle.model.checkpoints')
            checkpoints.write_adapter = lambda *args: None
            runtime = types.ModuleType('needle.model.run')
            runtime.load_checkpoint = lambda *args: (_ for _ in ()).throw(RuntimeError('model load sentinel'))
            model.finetune = finetune
            modules = {'jax': jax, 'numpy': numpy, 'needle': needle, 'needle.model': model, 'needle.model.finetune': finetune, 'needle.model.checkpoints': checkpoints, 'needle.model.run': runtime}
            with patch.dict(sys.modules, modules), patch.dict(os.environ, {'SLURM_JOB_ID': 'fixture'}), patch.object(study, 'load_plan', return_value=plan), patch.object(study, 'digest', return_value='verified'), patch.object(study.inspect, 'getfile', return_value=str(source)), patch.object(study.importlib.metadata, 'version', return_value='3.1.2'), patch.object(study.subprocess, 'check_output', return_value='fixture GPU'):
                with self.assertRaisesRegex(RuntimeError, 'model load sentinel'):
                    study.train(directory, 0)
            record = json.loads((directory / 'startup/run.json').read_text())
            self.assertEqual(record['trainingConfiguration'], {'loraRank': 32, 'loraAlpha': 32})
            self.assertEqual(record['status'], 'failed')
            self.assertEqual(record['error'], 'model load sentinel')


if __name__ == '__main__':
    unittest.main()
