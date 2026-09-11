"use strict";

const app = document.getElementById("app");
const pet = document.getElementById("pet");
const animation = document.getElementById("animation");
const bubble = document.getElementById("bubble");
const bubbleText = document.getElementById("bubble-text");
const bubbleSub = document.getElementById("bubble-sub");
const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const animationPlayer = window.BorderCollieAnimation.createAnimationPlayer({
  target: animation,
  reducedMotion: motionPreference?.matches,
});
function reportHitRegions() {
  const selectors = [
    ".bubble:not([hidden])",
    ".dev-panel:not([hidden])",
  ];
  const regions = selectors.flatMap((selector) =>
    [...document.querySelectorAll(selector)].map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  const dragRegions = window.BorderCollieHitRegions.imageHitRegions(animation);
  regions.push(...dragRegions);
  window.borderCollie.setHitRegions(regions, dragRegions);
}

let hitRegionFrame = null;
function scheduleHitRegionReport() {
  cancelAnimationFrame(hitRegionFrame);
  hitRegionFrame = requestAnimationFrame(reportHitRegions);
}

new MutationObserver(scheduleHitRegionReport).observe(app, {
  attributes: true,
  childList: true,
  subtree: true,
  attributeFilter: ["class", "hidden", "style"],
});
new ResizeObserver(scheduleHitRegionReport).observe(app);
animation.addEventListener("load", scheduleHitRegionReport);
scheduleHitRegionReport();

const STATES = [
  "calm",
  "thinking",
  "watching",
  "checking",
  "allowed",
  "suspicious",
  "refused",
  "denied",
  "proving",
  "rejecting",
  "celebrating",
  "error",
  "asking",
  "sleeping",
  "offline",
  "hover",
  "drag",
];

const DEV_ANIMATIONS = [
  ["calm", "normal"],
  ["drag", "dragging"],
  ["hover", "hovering"],
  ["thinking", "thinking/working"],
  ["suspicious", "suspicious"],
  ["refused", "refused"],
  ["denied", "denied"],
  ["celebrating", "celebrating/passing"],
];

let baseState = "offline";
let interaction = null;
let hideTimer = null;
let quietTimer = null;
let connected = false;
let agentBusy = false;
let toggleKey = "Control+Option+R";
let dragFacing = "right";

function speech(e) {
  switch (e.type) {
    case "run":
      if (e.status === "start") return { line: "I'm watching." };
      if (e.status === "finish") return { line: "Finished.", sub: e.summary };
      if (e.status === "end") return { line: "This session is over.", sub: summaryOf(e.detail) };
      if (e.status === "error") return { line: "I lost the agent.", sub: e.reason };
      return null;
    case "protocol":
      return { line: "I know what to watch for.", sub: e.summary };
    case "thinking":
    case "action":
      return null;
    case "toolerror":
      return { line: "That didn't work.", sub: e.summary };
    case "suspicious":
      return { line: "Something in that file looks like instructions.", sub: e.detail?.excerpt || e.reason };
    case "excursion":
      return { line: "I stopped that.", sub: `${e.summary}\n${e.reason || ""}`.trim(), denial: true };
    case "claim":
      return { line: "Let me check that.", sub: e.summary };
    case "verdict":
      return e.status === "pass"
        ? { line: "All checks passed.", sub: e.summary }
        : { line: "That isn't finished yet.", sub: e.reason || e.summary, denial: true };
    case "ask":
      return { line: "I need your judgment here.", sub: e.reason || e.summary };
    default:
      return null;
  }
}

function summaryOf(detail) {
  if (!detail) return null;
  const bits = [];
  if (detail.allowed != null) bits.push(`${detail.allowed} allowed`);
  if (detail.blocked) bits.push(`${detail.blocked} refused`);
  if (detail.verified) bits.push(`${detail.verified} verified`);
  if (detail.rejected) bits.push(`${detail.rejected} rejected`);
  return bits.join(" · ") || null;
}

function rendered() {
  return interaction || baseState;
}

function paintAnimation(state) {
  animationPlayer.play(state);
}

function paint() {
  const state = rendered();
  for (const key of STATES) app.classList.toggle(`state-${key}`, key === state);
  paintAnimation(state);
}

function setState(next) {
  baseState = STATES.includes(next) ? next : "calm";
  paint();
}

function setInteraction(next) {
  if (interaction === next) return;
  interaction = next;
  paint();
}

function setDragFacing(deltaX) {
  if (!Number.isFinite(deltaX) || Math.abs(deltaX) < 0.5) return;
  const next = deltaX < 0 ? "left" : "right";
  if (next === dragFacing) return;
  dragFacing = next;
  animation.classList.toggle("facing-left", next === "left");
  scheduleHitRegionReport();
}

function clearQuiet() {
  clearTimeout(quietTimer);
}

function armQuiet() {
  clearQuiet();
  quietTimer = setTimeout(() => {
    if (!connected || agentBusy || interaction) return;
    setState("sleeping");
  }, 90_000);
}

function nudgeAwake() {
  if (baseState === "sleeping") setState("calm");
  armQuiet();
}

function settleTarget() {
  if (!connected) return "offline";
  if (agentBusy) return "thinking";
  return "calm";
}

function settle() {
  setState(settleTarget());
}

function markBusy() {
  agentBusy = true;
  clearQuiet();
  if (baseState === "sleeping") setState("thinking");
}

function markIdle() {
  agentBusy = false;
  armQuiet();
}

function say(line, sub, ms = 5200, denial = false) {
  if (!line) return;
  bubbleText.textContent = line;
  bubble.classList.toggle("bubble-denial", denial);
  if (sub) {
    bubbleSub.textContent = String(sub).slice(0, 220);
    bubbleSub.hidden = false;
  } else {
    bubbleSub.hidden = true;
  }
  bubble.hidden = false;
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    bubble.hidden = true;
  }, ms);
}

const scheduler = window.BorderCollieScheduler.createReactionScheduler({
  onShow(e) {
    setState(e.petState);
    const words = speech(e);
    if (words?.line) {
      const long = e.type === "excursion" || e.type === "verdict" || e.type === "ask";
      say(words.line, words.sub, long ? 7000 : 5200, words.denial);
    }
  },
  onSettle() {
    settle();
  },
});

function handle(e) {
  if (e.type === "control" && e.detail?.action === "size") {
    window.borderCollie.setScale(e.detail.scale);
    return;
  }
  nudgeAwake();

  const isIdleEdge = e.type === "thinking" && e.status === "idle";
  const isBusyEdge = e.type === "thinking" && e.status === "ok" && e.petState === "thinking";

  if (isBusyEdge) markBusy();
  if (isIdleEdge) markIdle();
  else if (!isIdleEdge) {
    if (agentBusy) clearQuiet();
    else armQuiet();
  }

  if (e.type === "run" && e.status === "end") {
    connected = false;
    agentBusy = false;
    clearQuiet();
  }

  scheduler.enqueue(e);
}

pet.addEventListener("mouseenter", () => {
  if (interaction !== "drag") setInteraction("hover");
});

pet.addEventListener("mouseleave", () => {
  if (interaction === "hover") setInteraction(null);
});

let pointerDrag = null;
if (window.borderCollie.startDrag && window.borderCollie.dragTo && window.borderCollie.endDrag) {
  const endPointerDrag = (event) => {
    if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
    pointerDrag = null;
    window.borderCollie.endDrag();
    if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
  };
  pet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerDrag = { id: event.pointerId };
    window.borderCollie.startDrag(event.screenX, event.screenY);
    pet.setPointerCapture(event.pointerId);
  });
  pet.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
    if (!(event.buttons & 1)) return endPointerDrag(event);
    window.borderCollie.dragTo(event.screenX, event.screenY);
  });
  pet.addEventListener("pointerup", endPointerDrag);
  pet.addEventListener("pointercancel", endPointerDrag);
}

if (window.borderCollie.onDrag) {
  window.borderCollie.onDrag((drag) => {
    if (!drag || typeof drag !== "object") return;
    if (drag.phase === "end") {
      if (interaction === "drag") setInteraction(null);
      return;
    }
    if (drag.phase === "start" || drag.phase === "move") {
      if (drag.phase === "move") setDragFacing(drag.deltaX);
      setInteraction("drag");
    }
  });
}

function runDev() {
  connected = true;
  setState("calm");
  const panel = document.getElementById("dev-panel");
  if (panel) panel.hidden = false;
  const baseSel = document.getElementById("dev-base");
  const overlaySel = document.getElementById("dev-overlay");
  if (baseSel) {
    baseSel.innerHTML = "";
    for (const [state, label] of DEV_ANIMATIONS) {
      const opt = document.createElement("option");
      opt.value = state;
      opt.textContent = label;
      if (state === "calm") opt.selected = true;
      baseSel.append(opt);
    }
    baseSel.addEventListener("change", () => setState(baseSel.value));
  }
  if (overlaySel) {
    overlaySel.addEventListener("change", () => {
      const value = overlaySel.value;
      setInteraction(value === "none" ? null : value);
    });
  }
}

if (window.borderCollie.onScaled) {
  window.borderCollie.onScaled((pct) => {
    say(`${pct}%`, `${toggleKey} to hide`, 1600);
  });
}

window.__borderCollie = {
  setState,
  setInteraction,
  say,
  handle,
  paint,
  settle,
  states: STATES,
  rendered,
  get agentBusy() {
    return agentBusy;
  },
  get connected() {
    return connected;
  },
  scheduler,
};

setState("offline");

window.borderCollie.config().then((cfg) => {
  animationPlayer.replaceTracks(cfg.animations).then(paint).catch((error) => {
    console.error(`[border-collie] ${error.message}`);
  });
  if (cfg.toggleKey) toggleKey = cfg.toggleKey;
  if (cfg.dev) {
    return runDev();
  }
  if (cfg.live) {
    connected = true;
    window.borderCollie.onEvent((e) => handle(e));
    return;
  }
  connected = false;
  setState("offline");
});

motionPreference?.addEventListener("change", (event) => {
  animationPlayer.setReducedMotion(event.matches);
});

window.addEventListener("beforeunload", () => animationPlayer.stop());
