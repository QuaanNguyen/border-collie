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

const { createGuardAdapter } = require(path.join(repoRoot, "guard/lib/adapter.js"));
const { EventBus } = require(path.join(repoRoot, "events/index.js"));
const { startControlServer } = require(path.join(repoRoot, "pet/control.js"));
const { PET_SCALES, readConfig } = require(path.join(repoRoot, "guard/lib/config.js"));
const { createLivePreference } = require(path.join(repoRoot, "guard/lib/preference.js"));
const { createNeedleJudge } = require(path.join(repoRoot, "guard/lib/judge.js"));

function targetOf(tool, args) {
  const a = args || {};
  return a.command || a.cmd || a.url || a.query || a.filePath || a.path || a.pattern || tool;
}

function sessionBlockedMessage(tool, args, reason) {
  return [
    'Guard refused this action.',
    'Requested action: ' + tool,
    'Target: ' + targetOf(tool, args),
    'Governing rule: preference_validity',
    'Decided by: folder Preference',
    'Reason: ' + reason,
    'Permitted alternative: Ask the owner to correct the folder Preference.',
    'Retry: owner action is required; do not retry until the Preference is fixed.',
  ].join('\n');
}

function userText(parts) {
  return (parts || [])
    .filter((part) => part && (part.type === undefined || part.type === 'text') && !part.synthetic && !part.ignored)
    .map((part) => part.text || part.content || '')
    .join('\n')
    .trim();
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
      claims: item.claims || info.claims || [],
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

export const BorderCollie = async ({ client, directory }, options = {}) => {
  const workdir = directory || process.cwd();
  const livePreference = createLivePreference({ workdir });
  const judge = typeof options?.judge === "function" ? options.judge : createNeedleJudge();
  let preferenceState = livePreference.refresh();
  const petProcess = launchPet();
  const bus = new EventBus({
    sink: petProcess?.stdin
      ? (event) => petProcess.stdin.write(JSON.stringify(event) + "\n")
      : null,
  });
  const petControl = petProcess ? startControlServer((control) => {
    if (control.action !== 'size' || !PET_SCALES.includes(control.scale)) return false;
    emitPetSize(control.scale);
    return true;
  }) : null;
  const petConfig = readConfig();
  if (!petConfig.error) {
    const scale = petConfig.config.pet.scale;
    emitPetSize(scale);
  }
  const sessions = new Map();
  const userMessages = new Map();
  const guardFeedback = new Set();
  let ended = false;
  let lastActiveSessionID = null;
  let quarantinedPreferenceFingerprint = null;

  function blockedReason(state) {
    return "Border Collie blocked this session because " + state.reason + ". Fix the Preference at " + state.file + ".";
  }

  function refreshPreference() {
    const next = livePreference.refresh();
    if (quarantinedPreferenceFingerprint === next.fingerprint) {
      preferenceState = {
        ...next,
        valid: false,
        reason: 'the Preference changed during an agent tool execution. A human must save a corrected Preference before work can continue',
      };
      return preferenceState;
    }
    quarantinedPreferenceFingerprint = null;
    preferenceState = next;
    return preferenceState;
  }

  function publish(out) {
    if (!out || !out.events) return;
    for (const e of out.events) bus.emit(e);
  }

  function emitPetSize(scale) {
    bus.emit({
      type: 'control', status: 'ok', petState: 'calm', summary: `Pet size ${Math.round(scale * 100)}%`,
      detail: { action: 'size', scale, percent: Math.round(scale * 100) },
    });
  }

  function syncPreference(state, next) {
    if (!next.valid || state.preferenceRevision === next.revision) return;
    state.guard.replacePreference(next.preference);
    state.preferenceRevision = next.revision;
    state.preferenceFingerprint = next.fingerprint;
    publish({
      events: [{
        type: "protocol",
        status: "ok",
        petState: "calm",
        summary: "Preference reloaded",
        detail: { purpose: next.preference.purpose, source: next.source },
      }],
    });
  }

  function stateFor(sessionID, next = refreshPreference()) {
    const key = sessionID || "plugin";
    let state = sessions.get(key);
    if (state) {
      syncPreference(state, next);
      return state;
    }
    state = {
      guard: createGuardAdapter({ preference: next.valid ? next.preference : null, workdir, judge }),
      reviewed: new Set(),
      completionPending: true,
      review: null,
      preferenceRevision: next.valid ? next.revision : null,
      preferenceFingerprint: next.valid ? next.fingerprint : null,
    };
    sessions.set(key, state);
    publish(state.guard.start());
    return state;
  }

  function releaseSession(sessionID) {
    if (!sessionID) return;
    userMessages.delete(sessionID);
    const state = sessions.get(sessionID);
    if (!state) return;
    try {
      publish(state.guard.end());
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
        publish(state.guard.end());
      } catch {
      }
    }
    bus.close();
    petControl?.close();
    petProcess?.stdin?.end();
    judge.dispose?.();
  }

  process.on("beforeExit", endSession);
  process.on("exit", endSession);

  if (!preferenceState.valid) {
    bus.emit({
      type: "notification",
      status: "error",
      petState: "denied",
      summary: "Folder Preference cannot be applied",
      reason: preferenceState.reason,
      detail: {
        priority: "high",
        preferencePath: preferenceState.file,
        remediation: blockedReason(preferenceState),
      },
    });
  }

  function rememberUserMessage(sessionID, text) {
    if (!sessionID || !text || guardFeedback.has(text)) return;
    userMessages.set(sessionID, text);
  }

  async function latestUserMessage(sessionID) {
    if (!sessionID) return '';
    if (userMessages.has(sessionID)) return userMessages.get(sessionID);
    if (!client?.session?.messages) return '';
    let payload;
    try {
      payload = await client.session.messages({ path: { id: sessionID } });
    } catch {
      return '';
    }
    const list = Array.isArray(payload) ? payload : payload?.data || payload?.messages || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const info = list[i].info || list[i];
      if (info.role !== "user") continue;
      const text = userText(list[i].parts || info.parts);
      if (text && !guardFeedback.has(text)) return text;
    }
    return '';
  }

  async function reviewCompletion(sessionID) {
    if (!sessionID) return;
    const next = refreshPreference();
    const state = stateFor(sessionID, next);
    if (!next.valid) {
      bus.emit({
        type: "notification",
        status: "error",
        petState: "denied",
        summary: "Folder Preference cannot be applied",
        reason: next.reason,
      });
      return;
    }
    const doneCriteria = state.guard.preference.done_criteria;
    if (!client?.session?.messages) {
      if (doneCriteria.length) {
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
      if (doneCriteria.length) {
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
    const out = state.guard.assistantCompletion(completion);
    publish(out);
    const sendFeedback = client?.session?.promptAsync || client?.session?.prompt;
    if (out.inject && sendFeedback) {
      guardFeedback.add(out.inject.trim());
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
    "chat.message": async (input, output) => {
      rememberUserMessage(input?.sessionID, userText(output?.parts));
    },

    "tool.execute.before": async (input, output) => {
      const tool = input.tool || "";
      const args = output?.args || input.args || {};
      const next = refreshPreference();
      if (!next.valid) throw new Error(sessionBlockedMessage(tool, args, blockedReason(next)));
      const state = stateFor(input.sessionID, next);
      const out = await state.guard.proposedAction({
        tool,
        args,
        userMessage: await latestUserMessage(input.sessionID),
      });
      publish(out);
      if (out.decision !== "allow") throw new Error(out.message);
    },

    "tool.execute.after": async (input, output) => {
      const existing = sessions.get(input.sessionID || "plugin");
      const observed = livePreference.refresh();
      if (existing && existing.preferenceFingerprint && existing.preferenceFingerprint !== observed.fingerprint) {
        quarantinedPreferenceFingerprint = observed.fingerprint;
        const quarantined = refreshPreference();
        bus.emit({
          type: "notification",
          status: "error",
          petState: "denied",
          summary: "Folder Preference needs human correction",
          reason: quarantined.reason,
        });
        return;
      }
      const next = refreshPreference();
      if (!next.valid) return;
      const state = stateFor(input.sessionID, next);
      publish(state.guard.toolResult({
        tool: input.tool,
        status: output?.error ? "error" : "completed",
        result: resultText(output),
        error: output?.error,
      }));
    },

    event: async ({ event }) => {
      if (!event) return;
      const next = refreshPreference();
      if (!next.valid) return;
      let sessionID = sessionIDOf(event);
      if (sessionID) lastActiveSessionID = sessionID;
      else if (event.type === "session.idle" || isIdle(event)) sessionID = lastActiveSessionID;
      if (event.type === "session.deleted") {
        releaseSession(sessionID);
        return;
      }
      const state = stateFor(sessionID, next);
      if (event.type === "session.status" && isBusy(event)) {
        state.completionPending = true;
        publish(state.guard.lifecycle("busy"));
      }
      if (event.type === "session.idle" || isIdle(event)) {
        publish(state.guard.lifecycle("idle"));
        await scheduleCompletionReview(sessionID);
        return;
      }
    },
  };
};

function messageText(parts) {
  return (parts || []).map((part) => part?.text || part?.content || "").join("");
}

function v2Messages(messages) {
  return (messages || []).map((message) => {
    if (message?.info || message?.parts) return message;
    const parts = message.text ? [{ type: "text", text: message.text }] : [];
    return {
      info: {
        id: message.id,
        role: message.role,
        finish: message.finish,
        time: message.time,
        error: message.error,
      },
      parts,
      content: message.content || messageText(parts),
    };
  });
}

function v2Client(ctx) {
  return {
    session: {
      async messages({ path }) {
        const sessionID = path?.id;
        if (typeof ctx.session?.context === "function") return v2Messages(await ctx.session.context({ sessionID }));
        if (typeof ctx.session?.messages === "function") return ctx.session.messages({ path });
        return [];
      },
      prompt({ path, body }) {
        const sessionID = path?.id;
        const text = messageText(body?.parts);
        if (typeof ctx.session?.synthetic === "function") return ctx.session.synthetic({ sessionID, text });
        if (typeof ctx.session?.prompt === "function") return ctx.session.prompt({ sessionID, text });
        return Promise.resolve();
      },
      promptAsync(input) {
        return this.prompt(input);
      },
    },
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toolInput(event) {
  if (isRecord(event?.input)) return event.input;
  if (isRecord(event?.args)) return event.args;
  return {};
}

export default {
  id: "border-collie",
  async setup(ctx) {
    const directory = ctx.location?.directory || ctx.location?.project?.directory || process.cwd();
    const hooks = await BorderCollie({ client: v2Client(ctx), directory });
    await ctx.tool.hook("execute.before", async (event) => {
      await hooks["tool.execute.before"](
        { tool: event.tool, sessionID: event.sessionID, callID: event.callID },
        { args: toolInput(event) },
      );
    });
    await ctx.tool.hook("execute.after", async (event) => {
      const failed = event.status === "error" || event.error;
      await hooks["tool.execute.after"](
        { tool: event.tool, sessionID: event.sessionID, callID: event.callID, args: toolInput(event) },
        failed
          ? { error: event.error }
          : { output: typeof event.result === "string" ? event.result : event.result?.output || event.output || "" },
      );
    });
    const controller = new AbortController();
    if (typeof ctx.event?.subscribe === "function") {
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            await hooks.event({ event });
          }
        } catch (error) {
          if (error?.name !== "AbortError") throw error;
        }
      })();
    }
    return () => controller.abort();
  },
};
