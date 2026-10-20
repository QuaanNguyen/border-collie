import json
import os
from pathlib import Path
import platform
import re
import shutil
import select
import signal
import socket
import subprocess
import tarfile
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[2]


def wait_for(read, label, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = read()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError('Timed out waiting for ' + label)


def process_rows():
    output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,comm='], text=True)
    return [(int(parts[0]), int(parts[1]), parts[2]) for row in output.splitlines()
            if len(parts := row.split(None, 2)) == 3]


class Tui:
    def __init__(self, command, env, work):
        import fcntl
        import pty
        import termios

        self.master, slave = pty.openpty()
        def own_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        self.process = subprocess.Popen(command, env=env, cwd=work, stdin=slave,
                                        stdout=slave, stderr=slave, preexec_fn=own_terminal)
        os.close(slave)
        self.closed = False
        self.reader = threading.Thread(target=self.drain, daemon=True)
        self.reader.start()

    def drain(self):
        while not self.closed:
            try:
                if not select.select([self.master], [], [], 0.1)[0]:
                    continue
                chunk = os.read(self.master, 65536)
                if not chunk:
                    break
            except OSError:
                break

    def close_terminal(self):
        self.closed = True
        self.reader.join(timeout=1)
        os.close(self.master)
        self.process.wait(timeout=10)

    def stop(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=5)
        if not self.closed:
            self.closed = True
            os.close(self.master)


def main():
    if platform.system() != 'Darwin' or not shutil.which('opencode'):
        print('SKIP: requires macOS and OpenCode on PATH')
        return
    with tempfile.TemporaryDirectory(prefix='bordercollie-opencode-lifecycle-') as temporary:
        workroot = Path(temporary)
        config = workroot / 'config'
        plugin = config / 'plugins' / 'bordercollie'
        plugin.mkdir(parents=True)
        packed = subprocess.run(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
                                cwd=ROOT, text=True, capture_output=True, check=True)
        archive = workroot / json.loads(packed.stdout)[0]['filename']
        with tarfile.open(archive) as package:
            package.extractall(workroot / 'unpacked', filter='data')
        source = workroot / 'unpacked' / 'package'
        for name in ['bordercollie', 'events', 'pet']:
            shutil.copytree(source / name, plugin / name)
        for entry in (source / 'plugin').iterdir():
            if entry.suffix in ['.js', '.mjs']:
                shutil.copy(entry, plugin / entry.name)
        shutil.copy(source / 'plugin' / 'bordercollie.js', plugin / 'index.mjs')
        (plugin / 'package.json').write_text(json.dumps({'name': 'bordercollie',
                                                       'exports': {'.': './index.mjs', './tui': './tui.mjs'}}))
        (config / 'opencode.json').write_text(json.dumps({'enabled_providers': [], 'server': {'port': 0}}))
        subprocess.run(['node', str(ROOT / 'scripts' / 'build-native-pet.js'), '--pet-dir=' + str(plugin / 'pet')],
                       check=True, capture_output=True, text=True)
        pointer = workroot / 'macos-pointer'
        subprocess.run(['xcrun', 'swiftc', '-module-cache-path', str(workroot / 'swift-cache'),
                        str(ROOT / 'test' / 'fixtures' / 'macos-pointer.swift'), '-o', str(pointer),
                        '-framework', 'AppKit', '-framework', 'ApplicationServices'],
                       check=True, capture_output=True, text=True)
        work = workroot / 'work'
        work.mkdir()
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('OPENCODE', 'BORDERCOLLIE', 'BORDER_COLLIE', 'XDG_'))}
        env.update(OPENCODE_CONFIG_DIR=str(config), XDG_DATA_HOME=str(workroot / 'data'),
                   XDG_STATE_HOME=str(workroot / 'state'), XDG_CACHE_HOME=str(workroot / 'cache'),
                   XDG_CONFIG_HOME=str(workroot / 'xdg-config'), BORDERCOLLIE_CONFIG_ROOT=str(workroot / 'owner'),
                   TERM='xterm-256color')
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        server = subprocess.Popen(['opencode', 'serve', '--hostname', '127.0.0.1', '--port', str(port)],
                                  cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  start_new_session=True)
        output = []

        def read_server():
            for line in iter(server.stdout.readline, b''):
                output.append(line.decode(errors='replace'))

        threading.Thread(target=read_server, daemon=True).start()
        clients = []
        owned_pets = set()

        def pets():
            rows = process_rows()
            owners = {server.pid} | {client.process.pid for client in clients}
            for unused in range(12):
                owners.update(pid for pid, parent, name in rows if parent in owners)
            found = {pid for pid, parent, name in rows if pid in owners and name.endswith('/pet-host')}
            owned_pets.update(found)
            return found

        def visible(pid):
            result = subprocess.run([str(pointer), 'find', str(pid)], capture_output=True, text=True)
            return json.loads(result.stdout) if result.returncode == 0 else None

        def start_tui():
            previous = pets()
            client = Tui(['opencode', '--server', f'http://127.0.0.1:{port}', str(work)], env, work)
            clients.append(client)
            try:
                born = wait_for(lambda: pets() - previous, 'native dog for new TUI')
            except AssertionError:
                for log in (workroot / 'data').rglob('*.log'):
                    for line in log.read_text(errors='replace').splitlines():
                        if 'plugin operation failed' in line:
                            print(line.replace(env['OPENCODE_PASSWORD'], '<REDACTED>'), flush=True)
                print('TUI startup failed; client exit', client.process.poll(), flush=True)
                raise
            assert len(born) == 1, 'Expected exactly one dog per TUI'
            dog = next(iter(born))
            assert any(pid == dog and parent == client.process.pid for pid, parent, name in process_rows()), 'Native dog is not owned by its TUI'
            wait_for(lambda: visible(dog), 'visible native dog window')
            return client, dog

        def gone(pid):
            return not any(item[0] == pid for item in process_rows()) and not visible(pid)

        try:
            wait_for(lambda: 'http' in ''.join(output), 'isolated server readiness')
            match = re.search(r'(?:password|Password)[\s:=]+([^\s\x1b]+)', ''.join(output))
            assert match, 'Server did not provide its private authentication password'
            env['OPENCODE_PASSWORD'] = match.group(1)
            time.sleep(1)
            assert not pets(), 'FAIL: backend alone launched a dog without a TUI'
            print('PASS: backend alone has no native dog', flush=True)
            first, first_dog = start_tui()
            second, second_dog = start_tui()
            initial_width = visible(first_dog)['width']
            resized = subprocess.run(['node', str(ROOT / 'scripts' / 'bordercollie.js'), 'pet', 'size', '135'],
                                     env=env, cwd=work, capture_output=True, text=True, check=True)
            assert 'active Pet resized' in resized.stdout, 'Size command did not reach the backend control socket'

            def resized_width(pid):
                bounds = visible(pid)
                return bounds and abs(bounds['width'] - initial_width * 1.35) <= 2

            wait_for(lambda: resized_width(first_dog) and resized_width(second_dog), 'both native dogs to resize through backend RPC')
            persisted_width = visible(first_dog)['width']
            print('PASS: both native dogs resized through backend RPC', flush=True)
            first.close_terminal()
            wait_for(lambda: gone(first_dog), 'dog to close with its terminal')
            assert second.process.poll() is None and visible(second_dog), 'Closing one TUI closed the other dog'
            os.kill(second.process.pid, signal.SIGKILL)
            second.process.wait(timeout=5)
            wait_for(lambda: gone(second_dog), 'dog to close after TUI SIGKILL')
            assert server.poll() is None, 'Shared OpenCode server stopped with a TUI'
            print('PASS: terminal close and PID-only SIGKILL removed their dogs', flush=True)
            reopened, reopened_dog = start_tui()
            assert reopened_dog not in {first_dog, second_dog}, 'Reopening reused an old native process'
            try:
                wait_for(lambda: abs(visible(reopened_dog)['width'] - persisted_width) <= 2, 'reopened dog to load persisted size')
            except AssertionError:
                print('Reopened width', visible(reopened_dog)['width'], 'expected width', persisted_width, flush=True)
                for log in (workroot / 'data').rglob('*.log'):
                    for line in log.read_text(errors='replace').splitlines():
                        if 'configuration could not' in line or 'plugin operation failed' in line or 'rpc call failed' in line:
                            print(line.replace(env['OPENCODE_PASSWORD'], '<REDACTED>'), flush=True)
                raise
            reopened.close_terminal()
            wait_for(lambda: gone(reopened_dog), 'reopened dog to close with its terminal')
            assert not pets(), 'A native dog remained after all TUI windows closed'
            print('PASS: backend dogs 0; two TUI dogs 2; terminal-close survivors 1; SIGKILL survivors 0; reopen survivors 0; RPC resize and persisted size verified')
        finally:
            pets()
            for client in clients:
                client.stop()
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid, signal.SIGKILL)
                    server.wait(timeout=5)
            for pid in owned_pets:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass


if __name__ == '__main__':
    main()
