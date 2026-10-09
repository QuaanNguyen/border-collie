import importlib.util
from pathlib import Path


def execute(directory, label):
    source = Path(__file__).with_name('run-needle-ladder.py')
    specification = importlib.util.spec_from_file_location('needle_ladder', source)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    module.run(directory, label)
