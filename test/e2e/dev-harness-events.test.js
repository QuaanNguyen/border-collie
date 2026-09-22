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
const child = spawn(electron, [FIXTURE_DIR], { env: { ...process.env, BORDER_COLLIE_ROOT: ROOT, BORDER_COLLIE_STATUS_PATH: statusPath, BORDER_COLLIE_EVENT_PATH: path.join(tempDir, 'events.jsonl'), BORDER_COLLIE_TEST_FRAME: frame, BORDER_COLLIE_DEV_HARNESS: '1' }, stdio: 'ignore' });

async function main() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      if (status.ready) {
        assert.strictEqual(status.state, 'denied');
        assert.strictEqual(status.devControlCount, 1);
        process.stdout.write('ok - Pet development controls render their Event stream reaction\n');
        return;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('development harness did not render its refused scenario');
}

main().finally(() => {
  if (child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
});
