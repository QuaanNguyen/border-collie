import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

function findRepo(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "guard/lib/session.js"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveRoot(start) {
  if (process.env.BORDER_COLLIE_ROOT) return process.env.BORDER_COLLIE_ROOT;
  const bundled = path.join(start, "border-collie");
  if (fs.existsSync(path.join(bundled, "guard/lib/session.js"))) return bundled;
  return findRepo(start);
}

const repoRoot = resolveRoot(here);
if (!repoRoot) {
  throw new Error(
    "Border Collie cannot find guard/lib/session.js. Run scripts/install-plugin (copies guard + pet next to the plugin), or set BORDER_COLLIE_ROOT.",
  );
}

const { createSession } = require(path.join(repoRoot, "guard/lib/session.js"));
const { EventBus } = require(path.join(repoRoot, "events/index.js"));
const { loadOwnerPolicy, ownerProtocol } = require(path.join(repoRoot, "guard/lib/owner-policy.js"));
const { createLiveProtocol } = require(path.join(repoRoot, "guard/lib/live-protocol.js"));
const { protectedPathDecision } = require(path.join(repoRoot, "guard/lib/protected-paths.js"));
const { parseSizeArgument } = require(path.join(repoRoot, "events/size-command.js"));

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

function resourcesFromArgs(tool, args) {
  const a = args || {};
  if (tool === "bash" || tool === "shell") return [a.command || a.cmd].filter(Boolean);
  if (tool === "webfetch" || tool === "websearch") return [a.url || a.query].filter(Boolean);
  return [a.filePath || a.path || a.pattern || a.glob].filter(Boolean);
}

function toolCallFromArgs(tool, args) {
  return {
    id: 'opencode',
    type: 'function',
    function: { name: tool, arguments: JSON.stringify(args || {}) },
  };
}

function denialMessage({ action, target, rule, layer, reason, alternative, retry }) {
  return [
    'Guard refused this action.',
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
    : 'Choose an action allowed by the resolved Border Collie policy.';
  return denialMessage({
    action: tool,
    target,
    rule,
    layer: 'resolved Border Collie policy',
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

function lastAssistantCompletion(payload) {
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
    const content = text.trim() ? text : typeof item.content === "string" ? item.content : "";
    return {
      id: info.id || item.id || null,
      text: content,
      completed: info.time?.completed != null && !info.error && info.finish === "stop",
      error: info.error || null,
      finish: info.finish || null,
    };
  }
  return null;
}

function sessionIDOf(event) {
  const props = event.properties || event.data || event;
  return props.sessionID || props.session?.id || event.sessionID;
}

function isBusy(event) {
  const props = event.properties || event.data || event;
  const status = props.status;
  return status === "busy" || status?.type === "busy";
}

function isIdle(event) {
  if (event.type === "session.idle") return true;
  if (event.type === "session.error") return true;
  const props = event.properties || event.data || event;
  const status = props.status;
  const type = typeof status === "string" ? status : status?.type;
  return ["idle", "stopped", "stop", "cancelled", "canceled", "error"].includes(type);
}

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

function launchPet() {
  if (process.env.BORDER_COLLIE_NO_PET === "1") return;
  const petDir = path.join(repoRoot, "pet");
  const native = path.join(petDir, "native", "pet-host");
  const bin = process.platform === "darwin" ? native : electronBinary(petDir);
  if (!bin) {
    console.error(
      "[border-collie] Pet Border Collie not launched: Electron binary missing under " + petDir +
      ". Re-run: bash scripts/install-plugin.sh",
    );
    return;
  }
  if (!fs.existsSync(bin)) {
    console.error(
      "[border-collie] Pet Border Collie not launched: native macOS host missing under " + petDir +
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
    console.error("[border-collie] failed to launch Pet Border Collie:", err.message);
  });
  child.stdin.on("error", () => {});
  child.unref();
  child.stdin.unref?.();
  return child;
}

export const BorderCollie = async ({ client, directory }) => {
  const workdir = directory || process.cwd();
  const ownerPolicy = loadOwnerPolicy();
  const resolvedOwnerProtocol = ownerProtocol(ownerPolicy);
  const liveProtocol = createLiveProtocol({
    workdir,
    owner: resolvedOwnerProtocol,
    ownerTrustedWorkspaceRoots: ownerPolicy?.trusted_workspace_roots || [],
  });
  let policyState = liveProtocol.refresh();
  const petProcess = launchPet();
  const bus = new EventBus({
    sink: petProcess?.stdin
      ? (event) => petProcess.stdin.write(JSON.stringify(event) + "\n")
      : null,
  });
  const sessions = new Map();
  let sizeCommandRegistered = false;
  let ended = false;
  let lastActiveSessionID = null;
  let quarantinedProtocolFingerprint = null;

  function policyFailureMessage(state) {
    const action = state.conflicts?.length
      ? 'Remove or narrow the project policy'
      : 'Fix or remove the project policy';
    return "Border Collie blocked this session because " + state.reason + ". " + action + " at " + state.file + ".";
  }

  function refreshPolicy() {
    const nextPolicy = liveProtocol.refresh();
    if (quarantinedProtocolFingerprint === nextPolicy.fingerprint) {
      policyState = {
        ...nextPolicy,
        valid: false,
        reason: 'the Protocol changed during an agent tool execution. A human must save a corrected Protocol before work can continue',
        conflicts: [],
      };
      return policyState;
    }
    quarantinedProtocolFingerprint = null;
    policyState = nextPolicy;
    return policyState;
  }

  function publish(out) {
    if (!out || !out.events) return;
    for (const e of out.events) bus.emit(e);
  }

  function syncProtocol(state, nextPolicy) {
    if (!nextPolicy.valid || state.protocolRevision === nextPolicy.revision) return;
    state.guard.replaceProtocol(nextPolicy.protocol);
    state.protocolRevision = nextPolicy.revision;
    state.protocolFingerprint = nextPolicy.fingerprint;
    publish({
      events: [{
        type: "protocol",
        status: "ok",
        petState: "calm",
        summary: "Protocol reloaded",
        detail: nextPolicy.protocol.summary(),
      }],
    });
  }

  function stateFor(sessionID, nextPolicy = refreshPolicy()) {
    const key = sessionID || "plugin";
    let state = sessions.get(key);
    if (state) {
      syncProtocol(state, nextPolicy);
      return state;
    }
    state = {
      guard: createSession({ protocol: nextPolicy.valid ? nextPolicy.protocol : null, workdir }),
      reviewed: new Set(),
      completionPending: true,
      review: null,
      protocolRevision: nextPolicy.valid ? nextPolicy.revision : null,
      protocolFingerprint: nextPolicy.valid ? nextPolicy.fingerprint : null,
    };
    sessions.set(key, state);
    publish(state.guard.handle({ kind: "session.start" }));
    return state;
  }

  function releaseSession(sessionID) {
    if (!sessionID) return;
    const state = sessions.get(sessionID);
    if (!state) return;
    try {
      publish(state.guard.handle({ kind: "session.end" }));
    } catch {
    }
    sessions.delete(sessionID);
    if (lastActiveSessionID === sessionID) lastActiveSessionID = null;
  }

  function endSession() {
    if (ended) return;
    ended = true;
    for (const state of sessions.values()) {
      try {
        publish(state.guard.handle({ kind: "session.end" }));
      } catch {
      }
    }
    bus.close();
    petProcess?.stdin?.end();
  }

  process.on("beforeExit", endSession);
  process.on("exit", endSession);

  if (!policyState.valid) {
    bus.emit({
      type: "notification",
      status: "error",
      petState: "denied",
      summary: "Project policy cannot be applied",
      reason: policyState.reason,
      detail: {
        priority: "high",
        policyPath: policyState.file,
        conflicts: policyState.conflicts || [],
        remediation: policyFailureMessage(policyState),
      },
    });
  }
  function resizeCommand(input, output) {
    if (!sizeCommandRegistered || input.command !== "size") return;
    const size = parseSizeArgument(input.arguments);
    if (!size) {
      output.parts.splice(0, output.parts.length, {
        type: "text",
        text: "Usage: /size reset or /size 60|75|90|100|115|135|160|200",
      });
      return;
    }
    bus.emit({
      type: "control",
      status: "ok",
      petState: "calm",
      summary: `Pet size ${size.percent}%`,
      detail: { action: "size", scale: size.scale, percent: size.percent },
    });
    output.parts.splice(0, output.parts.length, {
      type: "text",
      text: `Border Collie size set to ${size.percent}%.`,
    });
  }

  async function reviewCompletion(sessionID) {
    if (!sessionID) return;
    const nextPolicy = refreshPolicy();
    const state = stateFor(sessionID, nextPolicy);
    if (!nextPolicy.valid) {
      bus.emit({
        type: "notification",
        status: "error",
        petState: "denied",
        summary: "Project policy cannot be applied",
        reason: nextPolicy.reason,
      });
      return;
    }
    if (!client?.session?.messages) {
      if (state.guard.protocol.doneCriteria.length) {
        bus.emit({
          type: "notification",
          status: "error",
          petState: "error",
          summary: "Completion observation is unavailable",
          reason: "The OpenCode client does not provide session messages.",
        });
      }
      return;
    }
    let payload;
    try {
      payload = await client.session.messages({ path: { id: sessionID } });
    } catch (error) {
      bus.emit({
        type: "notification",
        status: "error",
        petState: "error",
        summary: "Completion observation failed",
        reason: String(error?.message || error),
      });
      return;
    }
    const completion = lastAssistantCompletion(payload);
    if (!completion) {
      if (state.guard.protocol.doneCriteria.length) {
        bus.emit({
          type: "notification",
          status: "error",
          petState: "error",
          summary: "Completion observation found no assistant response",
        });
      }
      return;
    }
    const reviewKey = completion.id || `${completion.finish || ""}:${completion.text}`;
    if (state.reviewed.has(reviewKey)) return;
    state.reviewed.add(reviewKey);
    const out = state.guard.handle({ kind: "assistant", ...completion });
    publish(out);
    const sendFeedback = client?.session?.promptAsync || client?.session?.prompt;
    if (out.inject && sendFeedback) {
      Promise.resolve().then(() => sendFeedback.call(client.session, {
        path: { id: sessionID },
        body: { noReply: true, parts: [{ type: "text", text: out.inject }] },
      })).catch((error) => {
        bus.emit({
          type: "notification",
          status: "error",
          petState: "error",
          summary: "Completion feedback could not be recorded",
          reason: String(error?.message || error),
        });
      });
    }
  }

  function scheduleCompletionReview(sessionID) {
    if (!sessionID) return;
    const state = stateFor(sessionID);
    if (state.review) return state.review;
    if (!state.completionPending) return Promise.resolve();
    state.completionPending = false;
    const review = Promise.resolve()
      .then(() => reviewCompletion(sessionID))
      .catch(() => {})
      .finally(() => {
        if (state.review === review) state.review = null;
      });
    state.review = review;
    return review;
  }

  return {
    config(input) {
      input.command ||= {};
      if (Object.hasOwn(input.command, "size")) return;
      input.command.size = {
        template: "$ARGUMENTS",
        description: "Resize Border Collie: 60|75|90|100|115|135|160|200 or reset",
      };
      sizeCommandRegistered = true;
    },

    "command.execute.before": resizeCommand,

    "tool.execute.before": async (input, output) => {
      const tool = input.tool || "";
      const args = output?.args || input.args || {};
      const target = resourcesFromArgs(tool, args)[0] || tool;
      const nextPolicy = refreshPolicy();
      if (!nextPolicy.valid) {
        throw new Error(denialMessage({
          action: tool,
          target,
          rule: 'project_policy_validity',
          layer: 'active project policy',
          reason: policyFailureMessage(nextPolicy),
          alternative: 'Ask the owner to correct the active project policy.',
          retry: 'owner action is required; do not retry until the policy is fixed.',
        }));
      }
      const protectedPolicy = {
        ...nextPolicy.protocol.raw,
        protected_paths: [...(nextPolicy.protocol.raw.protected_paths || []), '.opencode/protocol.json'],
      };
      const protection = protectedPathDecision(tool, args, protectedPolicy, workdir);
      if (protection) {
        bus.emit({
          type: "excursion",
          status: "block",
          petState: "denied",
          tool,
          summary: tool + " targets a protected path",
          reason: protection.reason,
          rule: protection.rule,
        });
        throw new Error(denialMessage({
          action: tool,
          target,
          rule: protection.rule,
          layer: 'resolved Border Collie policy',
          reason: protection.reason,
          alternative: protection.rule === 'protected_paths' ? 'Read the path without modifying it, or ask the owner to change protection.' : 'Ask the owner to change read protection.',
          retry: 'do not retry this action until policy changes.',
        }));
      }
      const resources = resourcesFromArgs(tool, args);
      const state = stateFor(input.sessionID, nextPolicy);
      const out = state.guard.handle({
        kind: "permission",
        action: TOOL_ACTION[tool] || tool,
        resources: resources.length ? resources : [tool],
        toolCall: toolCallFromArgs(tool, args),
      });
      publish(out);
      if (out.deny) {
        const event = out.events.find((item) => item.type === 'excursion');
        throw new Error(ordinaryDenialMessage(tool, args, event, workdir));
      }
    },

    "tool.execute.after": async (input, output) => {
      const existing = sessions.get(input.sessionID || "plugin");
      const observedPolicy = liveProtocol.refresh();
      if (existing && existing.protocolFingerprint && existing.protocolFingerprint !== observedPolicy.fingerprint) {
        quarantinedProtocolFingerprint = observedPolicy.fingerprint;
        const quarantinedPolicy = refreshPolicy();
        bus.emit({
          type: "notification",
          status: "error",
          petState: "denied",
          summary: "Project policy needs human correction",
          reason: quarantinedPolicy.reason,
        });
        return;
      }
      const nextPolicy = refreshPolicy();
      if (!nextPolicy.valid) return;
      const state = stateFor(input.sessionID, nextPolicy);
      publish(state.guard.handle({
        kind: "tool.after",
        tool: input.tool,
        status: output?.error ? "error" : "completed",
        result: resultText(output),
        error: output?.error,
      }));
    },

    event: async ({ event }) => {
      if (!event) return;
      const nextPolicy = refreshPolicy();
      if (!nextPolicy.valid) return;
      let sessionID = sessionIDOf(event);
      if (sessionID) lastActiveSessionID = sessionID;
      else if (event.type === "session.idle" || isIdle(event)) sessionID = lastActiveSessionID;
      if (event.type === "session.deleted") {
        releaseSession(sessionID);
        return;
      }
      const state = stateFor(sessionID, nextPolicy);
      if (event.type === "session.status" && isBusy(event)) {
        state.completionPending = true;
        publish(state.guard.handle({ kind: "busy" }));
      }
      if (event.type === "session.idle" || isIdle(event)) {
        publish(state.guard.handle({ kind: "idle" }));
        await scheduleCompletionReview(sessionID);
        return;
      }
    },
  };
};
