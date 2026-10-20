import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DIST_CANDIDATES = [
  "node_modules/electron/dist/electron.exe",
  "node_modules/electron/dist/electron",
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
];

function electronBinary(petDir) {
  for (const rel of DIST_CANDIDATES) {
    const candidate = path.join(petDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  const pkg = path.join(petDir, "node_modules/electron");
  if (!fs.existsSync(pkg)) return null;
  try {
    const bin = require(pkg);
    if (typeof bin === "string" && fs.existsSync(bin)) return bin;
  } catch {
    return null;
  }
  return null;
}

export function launchPet(petDir) {
  if (process.env.BORDERCOLLIE_NO_PET === "1") return;
  const native = path.join(petDir, "native", "pet-host");
  const bin = process.platform === "darwin" ? native : electronBinary(petDir);
  if (!bin) {
    console.error(
      "[bordercollie] Pet bordercollie not launched: Electron binary missing under " + petDir +
      ". Re-run: bash scripts/install-plugin.sh",
    );
    return;
  }
  if (!fs.existsSync(bin)) {
    console.error(
      "[bordercollie] Pet bordercollie not launched: native macOS host missing under " + petDir +
      ". Re-run: bash scripts/install-plugin.sh",
    );
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const args = process.platform === "darwin"
    ? [`--pet-dir=${petDir}`]
    : ["."];
  const child = spawn(bin, args, {
    cwd: petDir,
    detached: false,
    stdio: ["pipe", "ignore", "ignore"],
    env,
  });
  child.on("error", (err) => {
    console.error("[bordercollie] failed to launch Pet bordercollie:", err.message);
  });
  child.stdin.on("error", () => {});
  child.unref();
  child.stdin.unref?.();
  return child;
}
