import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil


WORKSPACE = Path(__file__).resolve().parents[1]
REPOSITORY = WORKSPACE.parents[1]
TEXT_SUFFIXES = {'.js', '.json', '.jsonl', '.py', '.md', '.txt', '.csv', '.log'}
SOURCE_DIRECTORIES = ('guard', 'plugin', 'events', 'test', 'docs/agents')
SOURCE_FILES = ('package.json', '.gitignore', '.env.example', 'AGENTS.md', 'CONTEXT.md', 'docs/guard-and-judge.md')


def digest(file):
    with file.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def originals():
    files = set()
    for directory in SOURCE_DIRECTORIES:
        for file in (REPOSITORY / directory).rglob('*'):
            if any(part in {'node_modules', '__pycache__', '.venv'} for part in file.parts):
                continue
            if file.is_file() or file.is_symlink():
                files.add(file)
    for relative in SOURCE_FILES:
        file = REPOSITORY / relative
        if file.exists():
            files.add(file)
    return sorted(files)


def create():
    destination = WORKSPACE / 'snapshot'
    if destination.exists() or (WORKSPACE / 'snapshot-manifest.json').exists():
        raise RuntimeError('An existing snapshot cannot be replaced')
    destination.mkdir()
    records = []
    for original in originals():
        relative = original.relative_to(REPOSITORY)
        if original.is_symlink():
            records.append({'path': str(relative), 'kind': 'symlink', 'linkTarget': os.readlink(original), 'bytes': original.lstat().st_size, 'copied': False})
            continue
        before = original.stat()
        fingerprint = digest(original)
        copied = original.suffix in TEXT_SUFFIXES or str(relative) in SOURCE_FILES
        if copied:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            if digest(target) != fingerprint:
                raise RuntimeError('Source changed during copy: ' + str(relative))
            target.chmod(0o444)
        after = original.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise RuntimeError('Source changed during snapshot: ' + str(relative))
        records.append({'path': str(relative), 'sha256': fingerprint, 'bytes': before.st_size, 'mtimeNs': before.st_mtime_ns, 'copied': copied})
    manifest = {'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'repository': str(REPOSITORY), 'workspace': str(WORKSPACE), 'remoteContacted': False, 'records': records}
    (WORKSPACE / 'snapshot-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    verify()


def verify():
    manifest = json.loads((WORKSPACE / 'snapshot-manifest.json').read_text())
    failures = []
    for record in manifest['records']:
        file = REPOSITORY / record['path']
        if record.get('kind') == 'symlink':
            if not file.is_symlink() or os.readlink(file) != record['linkTarget']:
                failures.append(record['path'])
            continue
        if not file.is_file() or file.is_symlink() or digest(file) != record['sha256']:
            failures.append(record['path'])
        if record['copied']:
            copy = WORKSPACE / 'snapshot' / record['path']
            if not copy.is_file() or copy.is_symlink() or digest(copy) != record['sha256']:
                failures.append('snapshot/' + record['path'])
    result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'protectedFiles': len(manifest['records']), 'snapshotFiles': sum(record['copied'] for record in manifest['records']), 'snapshotBytes': sum(record['bytes'] for record in manifest['records'] if record['copied']), 'unchanged': not failures, 'changedPaths': failures, 'remoteContacted': False}
    (WORKSPACE / 'integrity-check.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if failures:
        raise RuntimeError('Protected files changed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['create', 'verify'])
    options = parser.parse_args()
    create() if options.operation == 'create' else verify()
