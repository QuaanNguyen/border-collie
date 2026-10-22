import json
import os
from pathlib import Path
import sys

from run_needle_batch import execute


directory = Path(sys.argv[1]).resolve()
plan = json.loads((directory / 'official-plan.json').read_text())
index = int(os.environ['SLURM_ARRAY_TASK_ID'])
execute(directory, plan['runs'][index]['label'])
