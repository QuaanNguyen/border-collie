import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('direct_trainer', ROOT / 'xor/prototype/prepare_direct_trainer.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE = ROOT / 'analysis/needle-judge-2026-10-09/artifacts/public-source/ef3cf7543204d99878c0dd913a05f6a506da4be8/finetune.py.txt'


class DirectTargetTest(unittest.TestCase):
    def test_direct_targets_close_the_forced_opening_without_reasoning(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'finetune.py'
            module.prepare(SOURCE, output)
            tree = ast.parse(output.read_text())
            render = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'render_example')
            scope = {'json': json, 'IM_START': '<|im_start|>', 'IM_END': '<|im_end|>', 'THINK_START': '<think>', 'THINK_END': '</think>', 'TOOLS_START': '<tools>', 'TOOLS_END': '</tools>', 'TOOL_CALL_START': '<tool_call>', 'TOOL_CALL_END': '</tool_call>'}
            exec(compile(ast.Module(body=[render], type_ignores=[]), str(output), 'exec'), scope)
            for verdict in ['approve', 'deny', 'ask']:
                prompt, target = scope['render_example']({'query': 'fixture request', 'tools': [], 'answers': [{'name': verdict, 'arguments': {}}]})
                self.assertTrue(target.startswith('<think>\n</think>\n<tool_call>'))
                self.assertTrue(target.endswith('</tool_call><|im_end|>'))
                self.assertEqual(json.loads(target.split('<tool_call>')[1].split('</tool_call>')[0]), [{'name': verdict, 'arguments': {}}])
                self.assertIn('fixture request', prompt)
            with self.assertRaisesRegex(ValueError, 'cannot include reasoning'):
                scope['render_example']({'query': 'fixture', 'reasoning': 'outside reviewer explanation'})
            with self.assertRaises(FileExistsError):
                module.prepare(SOURCE, output)

    def test_unknown_trainer_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'unknown.py'
            source.write_text('unexpected source')
            with self.assertRaisesRegex(ValueError, 'Unrecognized trainer'):
                module.prepare(source, Path(directory) / 'new.py')
