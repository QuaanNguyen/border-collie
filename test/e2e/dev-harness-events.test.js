'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PET_DIR = path.join(ROOT, 'pet');
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'renderer-probe');
const electron = require(path.join(PET_DIR, 'node_modules', 'electron'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-dev-harness-'));
const statusPath = path.join(tempDir, 'status.json');
const frame = pathToFileURL(path.join(PET_DIR, 'assets', 'default-animations', 'border-collie-normal', 'border-collie-normal-1.png')).href;
const env = { ...process.env, BORDER_COLLIE_ROOT: ROOT, BORDER_COLLIE_STATUS_PATH: statusPath, BORDER_COLLIE_EVENT_PATH: path.join(tempDir, 'events.jsonl'), BORDER_COLLIE_TEST_FRAME: frame, BORDER_COLLIE_DEV_HARNESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const args = [`--user-data-dir=${path.join(tempDir, 'user-data')}`, FIXTURE_DIR];
if (process.env.CI === 'true' && process.platform === 'linux') args.unshift('--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage');
let diagnostic = '';
const child = spawn(electron, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', (chunk) => { diagnostic += chunk; });
child.on('error', (error) => { diagnostic += error.message; });

async function main() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    let status;
    try {
      status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch {
    }
    if (status?.error) throw new Error(status.error);
    if (status?.ready) {
      assert.strictEqual(status.state, 'denied');
      assert.strictEqual(status.devControlCount, 1);
      process.stdout.write('ok - Pet development controls render their Event stream reaction\n');
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`development harness exited: ${child.exitCode} ${child.signalCode}\n${diagnostic}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`development harness did not render its refused scenario\n${diagnostic}`);
}

main().finally(async () => {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(timer);
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
