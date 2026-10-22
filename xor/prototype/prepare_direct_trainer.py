import argparse
import hashlib
from pathlib import Path

PINNED_TRAINERS = {
    '677b2e4aba1fd9ce5ff6e6e19763d0a66b8425eccf626f7107e2e3ace5d99241',
    '1b3eb3006c32804a47f5e9f603dbee8e4104ea3c6179199807dd3690d31fc832',
}
ORIGINAL = '    think = THINK_START + "\\n" + reasoning + "\\n" + THINK_END + "\\n" if reasoning else ""'
DIRECT = '    if reasoning:\n        raise ValueError("Direct checker targets cannot include reasoning")\n    think = THINK_START + "\\n" + THINK_END + "\\n"'


def prepare(source, output):
    content = Path(source).read_bytes()
    if hashlib.sha256(content).hexdigest() not in PINNED_TRAINERS:
        raise ValueError('Unrecognized trainer source; verify the new revision first')
    if Path(output).exists():
        raise FileExistsError('Preserve existing trainer copies; choose a new output')
    text = content.decode()
    if text.count(ORIGINAL) != 1:
        raise ValueError('The pinned render boundary changed')
    result = text.replace(ORIGINAL, DIRECT)
    compile(result, str(output), 'exec')
    with Path(output).open('x') as target:
        target.write(result)
    return hashlib.sha256(result.encode()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('new_output', type=Path)
    args = parser.parse_args()
    print(prepare(args.source, args.new_output))
