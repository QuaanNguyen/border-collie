import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'docs/research-data-manifest.json'


def records():
    paths = set()
    for line in (ROOT / '.gitattributes').read_text().splitlines():
        if 'filter=lfs' not in line:
            continue
        pattern = line.split()[0].replace('/**', '/**/*')
        paths.update(path for path in ROOT.glob(pattern) if path.is_file())
    result = []
    for path in sorted(paths):
        data = path.read_bytes()
        if data.startswith(b'version https://git-lfs.github.com/spec/v1'):
            raise ValueError('Download the LFS objects before checking their contents')
        result.append({'path': str(path.relative_to(ROOT)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = records()
    if args.check:
        if json.loads(MANIFEST.read_text())['files'] != result:
            raise ValueError('The research data differs from its manifest')
    else:
        MANIFEST.write_text(json.dumps({'storage': 'Git LFS', 'revision': 'Use the commit containing this manifest; LFS objects are addressed by their SHA-256 values.', 'files': result}, indent=2) + '\n')
    print(f'Checked {len(result)} data files, {sum(row["bytes"] for row in result)} bytes')
