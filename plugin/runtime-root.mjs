import fs from "node:fs";
import path from "node:path";

function findRepo(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "xor/lib/session.js"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveRoot(start) {
  if (process.env.XOR_ROOT) return process.env.XOR_ROOT;
  const bundled = path.join(start, "xor");
  if (fs.existsSync(path.join(bundled, "xor/lib/session.js"))) return bundled;
  return findRepo(start);
}
