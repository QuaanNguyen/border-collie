import hashlib
import json
from pathlib import Path
import urllib.request


WORKSPACE = Path(__file__).resolve().parents[1]
REVISION = 'ef3cf7543204d99878c0dd913a05f6a506da4be8'
DESTINATION = WORKSPACE / 'artifacts' / 'public-source' / REVISION
DESTINATION.mkdir(parents=True, exist_ok=True)
records = []
for name in ('export.py', 'finetune.py', 'tokenizer.py'):
    url = f'https://raw.githubusercontent.com/cactus-compute/needle/{REVISION}/needle/model/{name}'
    file = DESTINATION / (name + '.txt')
    if file.exists():
        body = file.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read()
        with file.open('xb') as handle:
            handle.write(body)
    records.append({'source': url, 'file': str(file.relative_to(WORKSPACE)), 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)})
manifest = {'revision': REVISION, 'purpose': 'Public official source for local tokenizer and training-format inspection only.', 'privatePayloadSent': False, 'solContacted': False, 'records': records}
(DESTINATION / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
