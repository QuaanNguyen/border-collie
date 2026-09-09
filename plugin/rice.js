import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

function findRepo(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "assay/lib/session.js"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveRoot(start) {
  if (process.env.RICE_ROOT) return process.env.RICE_ROOT;
  const bundled = path.join(start, "rice");
  if (fs.existsSync(path.join(bundled, "assay/lib/session.js"))) return bundled;
  return findRepo(start);
}

const repoRoot = resolveRoot(here);
if (!repoRoot) {
  throw new Error(
    "Rice cannot find assay/lib/session.js. Run scripts/install-plugin (copies assay + pet next to the plugin), or set RICE_ROOT.",
  );
}

const { createSession } = require(path.join(repoRoot, "assay/lib/session.js"));
const { EventBus, defaultInboxPath } = require(path.join(repoRoot, "assay/lib/events.js"));
const { loadOwnerPolicy, ownerProtocol } = require(path.join(repoRoot, "assay/lib/owner-policy.js"));
const { resolvePolicy, policyConflicts } = require(path.join(repoRoot, "assay/lib/policy-resolution.js"));
const { protectedPathDecision } = require(path.join(repoRoot, "assay/lib/protected-paths.js"));

const TOOL_ACTION = {
  read: "read",
  glob: "glob",
  grep: "grep",
  edit: "edit",
  write: "edit",
  patch: "edit",
  bash: "shell",
  shell: "shell",
  webfetch: "webfetch",
  websearch: "webfetch",
};

function loadProtocol(workdir) {
  const local = path.join(workdir, ".opencode", "protocol.json");
  if (!fs.existsSync(local)) return { protocol: null, policyPath: local };
  try {
    return { protocol: JSON.parse(fs.readFileSync(local, "utf8")), policyPath: local };
  } catch (error) {
    return { protocol: null, policyPath: local, error };
  }
}

function resourcesFromArgs(tool, args) {
  const a = args || {};
  if (tool === "bash" || tool === "shell") return [a.command || a.cmd].filter(Boolean);
  if (tool === "webfetch" || tool === "websearch") return [a.url || a.query].filter(Boolean);
  return [a.filePath || a.path || a.pattern || a.glob].filter(Boolean);
}

function denialMessage({ action, target, rule, layer, reason, alternative, retry }) {
  return [
    'ASSAY refused this action.',
    'Requested action: ' + action,
    'Target: ' + target,
    'Governing rule: ' + rule,
    'Policy layer: ' + layer,
    'Reason: ' + reason,
    'Permitted alternative: ' + alternative,
    'Retry: ' + retry,
  ].join('\n');
}

function ordinaryDenialMessage(tool, args, event, workdir) {
  const target = resourcesFromArgs(tool, args)[0] || tool;
  const rule = event?.rule || 'resolved_policy';
  const alternative = rule === 'read_paths' || rule === 'write_paths'
    ? 'Use a path within the active project: ' + workdir
    : 'Choose an action allowed by the resolved Rice policy.';
  return denialMessage({
    action: tool,
    target,
    rule,
    layer: 'resolved Rice policy',
    reason: event?.reason || 'the action is not permitted',
    alternative,
    retry: 'do not retry this target; use the permitted alternative or ask the owner to change policy.',
  });
}

function resultText(output) {
  if (!output) return "";
  if (typeof output.output === "string") return output.output;
  if (typeof output.content === "string") return output.content;
  if (output.error) return String(output.error.message || output.error);
  return typeof output === "string" ? output : JSON.stringify(output);
}

function lastAssistantText(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.data || payload?.messages || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    const info = item.info || item;
    const role = info.role;
    if (role !== "assistant") continue;
    const parts = item.parts || info.parts || [];
    const text = parts.map((p) => p.text || p.content || "").join("");
    if (text.trim()) return text;
    if (typeof item.content === "string") return item.content;
  }
  return "";
}

function sessionIDOf(event) {
  const props = event.properties || event;
  return props.sessionID || props.session?.id || event.sessionID;
}

function isBusy(event) {
  const props = event.properties || event;
  const status = props.status;
  return status === "busy" || status?.type === "busy";
}

function isIdle(event) {
  if (event.type === "session.idle") return true;
  if (event.type === "session.error") return true;
  const props = event.properties || event;
  const status = props.status;
  const type = typeof status === "string" ? status : status?.type;
  return ["idle", "stopped", "stop", "cancelled", "canceled", "error"].includes(type);
}

// The plugin runs inside OpenCode, which is a Bun binary, so require() of the
// electron package is not a reliable way to get the executable path - it works
// under Node and silently returns nothing here, which is why Rice stopped
// appearing while the run record kept filling. Look on disk first.
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

function launchPet(inboxPath) {
  if (process.env.RICE_NO_PET === "1") return;
  const petDir = path.join(repoRoot, "pet");
  const bin = electronBinary(petDir);
  if (!bin) {
    console.error(
      "[rice] Pet Rice not launched: Electron binary missing under " + petDir +
      ". Re-run: bash scripts/install-plugin.sh",
    );
    return;
  }
  const env = {
    ...process.env,
    RICE_EVENTS: inboxPath,
    RICE_OWNER_PID: String(process.pid),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const child = spawn(bin, ["."], {
    cwd: petDir,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.on("error", (err) => {
    console.error("[rice] failed to launch Pet Rice:", err.message);
  });
  child.unref();
}

export const Rice = async ({ client, directory }) => {
  const workdir = directory || process.cwd();
  const projectPolicy = loadProtocol(workdir);
  const ownerPolicy = loadOwnerPolicy();
  const resolvedOwnerProtocol = ownerProtocol(ownerPolicy);
  const conflicts = projectPolicy.error
    ? []
    : policyConflicts(resolvedOwnerProtocol || {}, projectPolicy.protocol, ownerPolicy?.trusted_workspace_roots || []);
  const protocol = projectPolicy.error
    ? null
    : resolvePolicy(resolvedOwnerProtocol, projectPolicy.protocol);
  const inboxPath = process.env.RICE_EVENTS || defaultInboxPath();
  const runsDir = process.env.RICE_RUNS || path.join(os.homedir(), ".rice", "runs");
  const bus = new EventBus({ inboxPath, runsDir });
  const session = projectPolicy.error || conflicts.length ? null : createSession({ protocol, workdir });
  const claimed = new Set();
  let ended = false;
  const invalidPolicyMessage = projectPolicy.error
    ? "Rice blocked this session because the active project policy is malformed. Fix or remove the project policy at " + projectPolicy.policyPath + " and restart OpenCode."
    : conflicts.length
      ? "Rice blocked this session because the project policy attempts to broaden the owner policy for " + conflicts.map((conflict) => conflict.field).join(', ') + ". Remove or narrow those project policy settings, then restart OpenCode."
      : null;

  function publish(out) {
    if (!out || !out.events) return;
    for (const e of out.events) bus.emit(e);
  }

  function endSession() {
    if (ended) return;
    ended = true;
    if (!session) return;
    try {
      publish(session.handle({ kind: "session.end" }));
    } catch {
    }
  }

  process.on("beforeExit", endSession);
  process.on("exit", endSession);

  if (projectPolicy.error || conflicts.length) {
    bus.emit({
      type: "notification",
      status: "error",
      petState: "refused",
      summary: projectPolicy.error ? "Project policy is malformed" : "Project policy broadens owner authority",
      reason: projectPolicy.error
        ? "The active project policy is malformed and was not loaded."
        : "The active project policy attempts to broaden the owner policy.",
      detail: {
        priority: "high",
        policyPath: projectPolicy.policyPath,
        conflicts,
        remediation: invalidPolicyMessage,
      },
    });
  } else {
    publish(session.handle({ kind: "session.start" }));
  }
  launchPet(inboxPath);

  async function reviewClaims(sessionID) {
    if (!sessionID || !client?.session?.messages) return;
    let payload;
    try { payload = await client.session.messages({ path: { id: sessionID } }); }
    catch { return; }
    const text = lastAssistantText(payload);
    if (!text || claimed.has(text)) return;
    const out = session.handle({ kind: "assistant", text });
    publish(out);
    if (out.events.some((e) => e.type === "claim" || e.type === "ask" || e.type === "verdict")) {
      claimed.add(text);
    }
    if (out.inject && client?.session?.prompt) {
      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: out.inject }] },
      });
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool || "";
      const args = output?.args || input.args || {};
      const target = resourcesFromArgs(tool, args)[0] || tool;
      if (invalidPolicyMessage) {
        throw new Error(denialMessage({
          action: tool,
          target,
          rule: projectPolicy.error ? 'project_policy_validity' : 'owner_policy_broadening',
          layer: projectPolicy.error ? 'active project policy' : 'owner policy',
          reason: invalidPolicyMessage,
          alternative: 'Fix or remove the active project policy, then restart OpenCode.',
          retry: 'owner action is required; do not retry until the policy is fixed.',
        }));
      }
      const protection = protectedPathDecision(tool, args, protocol, workdir);
      if (protection) {
        bus.emit({
          type: "excursion",
          status: "block",
          petState: "refused",
          tool,
          summary: tool + " targets a protected path",
          reason: protection.reason,
          rule: protection.rule,
        });
        throw new Error(denialMessage({
          action: tool,
          target,
          rule: protection.rule,
          layer: 'resolved Rice policy',
          reason: protection.reason,
          alternative: protection.rule === 'protected_paths' ? 'Read the path without modifying it, or ask the owner to change protection.' : 'Ask the owner to change read protection.',
          retry: 'do not retry this action until policy changes.',
        }));
      }
      const resources = resourcesFromArgs(tool, args);
      const out = session.handle({
        kind: "permission",
        action: TOOL_ACTION[tool] || tool,
        resources: resources.length ? resources : [tool],
      });
      publish(out);
      if (out.deny) {
        const event = out.events.find((item) => item.type === 'excursion');
        throw new Error(ordinaryDenialMessage(tool, args, event, workdir));
      }
    },

    "tool.execute.after": async (input, output) => {
      if (invalidPolicyMessage) return;
      publish(session.handle({
        kind: "tool.after",
        tool: input.tool,
        status: output?.error ? "error" : "completed",
        result: resultText(output),
        error: output?.error,
      }));
    },

    event: async ({ event }) => {
      if (invalidPolicyMessage) return;
      if (!event) return;
      if (event.type === "session.status" && isBusy(event)) {
        publish(session.handle({ kind: "busy" }));
      }
      if (event.type === "session.idle" || isIdle(event)) {
        publish(session.handle({ kind: "idle" }));
        await reviewClaims(sessionIDOf(event));
        return;
      }
      if (event.type === "message.updated") {
        await reviewClaims(sessionIDOf(event));
      }
    },
  };
};
