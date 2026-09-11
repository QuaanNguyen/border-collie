"use strict";
/**
 * Border Collie  -  the window.
 *
 * A frameless, transparent, always-on-top companion that floats over whatever
 * you are working in. It has no idea what Guard is beyond one URL: it reads the
 * event stream and reacts. It cannot block, allow, or change anything.
 *
 *   npm start                 -- normal
 *   npm run start:solid       -- opaque background, if transparency misbehaves
 *   npm run start:dev         -- animation picker; hot-reloads pet/src on change
 *
 * Shortcuts (global  -  they work whatever window has focus):
 *   Mac:     Control+Option+R  show/hide
 *   Windows: Ctrl+Alt+R        show/hide
 *
 * Size and position are remembered between runs.
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
} = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { watchInbox, defaultInboxPath } = require("../events");
const { parseOwnerPid, createOwnerRegistry } = require("./lib/owners");
const { createWindowInteraction } = require("./lib/window-interaction");
const { loadAnimationTracks } = require("./lib/animation-manifest");
const G = require("./geometry");
const PET_CONFIG = require("../events/pet-config.json");
const { BASE_W, BASE_H, DEFAULT_SCALE, clampScale } = G;

if (!app || typeof app.requestSingleInstanceLock !== "function") {
  console.error(
    "[border-collie] Electron app API missing. Unset ELECTRON_RUN_AS_NODE and relaunch via the Electron binary.",
  );
  process.exit(1);
}

const argv = process.argv.slice(1);
const SOLID = argv.includes("--solid");
const DEV = argv.includes("--dev");
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const EVENTS_FILE = arg(
  "events",
  process.env.BORDER_COLLIE_EVENTS || defaultInboxPath(),
);
const MOD = "Control+Alt";
const TOGGLE_KEY = arg("shortcut", `${MOD}+R`);
const DEV_H = 460;
const WINDOW_H = DEV ? DEV_H : BASE_H;
const EVENT_OFFSET = Number.parseInt(process.env.BORDER_COLLIE_EVENT_OFFSET || "", 10);

function prettyShortcut(accel, platform = process.platform) {
  return platform === "darwin"
    ? accel.replace(/Alt/g, "Option")
    : accel.replace(/Control/g, "Ctrl");
}

let win = null;
let ownerRegistry = null;
let windowInteraction = null;
let dragRegions = [];
let pointerDrag = null;
let settings = { scale: DEFAULT_SCALE, x: null, y: null };
let animations = null;

if (DEV) {
  app.setName("pet-border-collie-dev");
  app.setPath(
    "userData",
    process.env.BORDER_COLLIE_USER_DATA_DIR || path.join(os.homedir(), ".border-collie", "dev-userdata"),
  );
}

const settingsPath = () =>
  path.join(app.getPath("userData"), "border-collie-settings.json");

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (typeof raw.scale === "number") settings.scale = clampScale(raw.scale);
    if (Number.isInteger(raw.x)) settings.x = raw.x;
    if (Number.isInteger(raw.y)) settings.y = raw.y;
  } catch {
    /* first run, or unreadable  -  defaults are fine */
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch {
      /* not worth crashing over */
    }
  }, 400);
}

function applyLayout() {
  if (!win || win.isDestroyed()) return;
  const prev = win.getBounds();
  const width = Math.round(BASE_W * settings.scale);
  const height = Math.round(WINDOW_H * settings.scale);
  const next = {
    width,
    height,
    x: Math.round(prev.x + prev.width - width),
    y: Math.round(prev.y + prev.height - height),
  };
  const area = screen.getDisplayMatching(next).workArea;
  const clamped = G.keepVisibleOnScreen(next, area, dragRegions, settings.scale);

  win.setBounds(clamped);
  win.webContents.setZoomFactor(settings.scale);

  settings.x = clamped.x;
  settings.y = clamped.y;
  saveSettings();
}

function setScale(next) {
  const s = clampScale(next);
  if (s === settings.scale) return;
  settings.scale = s;
  applyLayout();
  if (win && !win.isDestroyed()) {
    win.webContents.send("borderCollie:scaled", Math.round(s * 100));
  }
}

const initialOwner = parseOwnerPid(process.env.BORDER_COLLIE_OWNER_PID);
const gotLock = app.requestSingleInstanceLock({
  ownerPid: initialOwner,
  dev: DEV,
});

if (!gotLock) {
  app.exit(0);
} else {
  ownerRegistry = createOwnerRegistry({
    onBecameEmpty() {
      app.quit();
    },
  });
  if (initialOwner != null) ownerRegistry.add(initialOwner);

  app.on(
    "second-instance",
    (_event, _commandLine, _workingDirectory, additionalData) => {
      const data =
        additionalData && typeof additionalData === "object"
          ? additionalData
          : {};
      if (DEV || data.dev) {
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        return;
      }
      if (ownerRegistry) ownerRegistry.add(data.ownerPid);
    },
  );

  function create() {
    const display = screen.getPrimaryDisplay();
    const area = display.workAreaSize;
    const w = Math.round(BASE_W * settings.scale);
    const h = Math.round(WINDOW_H * settings.scale);
    const start = G.keepOnScreen(
      {
        width: w,
        height: h,
        x: settings.x ?? Math.max(0, area.width - w - 28),
        y: settings.y ?? Math.max(0, area.height - h - 28),
      },
      display.workArea,
    );

    win = new BrowserWindow({
      ...start,
      ...(process.platform === "darwin" && !DEV ? { type: "panel" } : {}),
      frame: false,
      transparent: !SOLID,
      backgroundColor: SOLID ? "#12161a" : "#00000000",
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: DEV,
      acceptFirstMouse: !DEV,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        zoomFactor: settings.scale,
      },
    });
    if (process.platform === "darwin" && !DEV) {
      app.setActivationPolicy("prohibited");
    }
    if (!SOLID && !DEV) {
      windowInteraction = createWindowInteraction({
        win,
        screen,
        getScale: () => settings.scale,
      });
    }

    win.loadFile(path.join(__dirname, "src", "index.html"));
    win.once("ready-to-show", () => {
      win.webContents.setZoomFactor(settings.scale);
      revealWindow();
    });
    if (!DEV) {
      win.webContents.once("did-finish-load", () => {
        const watcher = watchInbox(EVENTS_FILE, (e) => {
          if (win && !win.isDestroyed()) win.webContents.send("borderCollie:event", e);
        }, { offset: Number.isSafeInteger(EVENT_OFFSET) ? EVENT_OFFSET : undefined });
        win.on("closed", () => watcher.close());
      });
    }

    win.on("closed", () => {
      if (windowInteraction) windowInteraction.stop();
      windowInteraction = null;
      pointerDrag = null;
    });

    win.on("move", () => {
      const b = win.getBounds();
      settings.x = b.x;
      settings.y = b.y;
      saveSettings();
    });

  }

  function revealWindow() {
    if (!win || win.isDestroyed()) return;
    if (DEV) {
      win.show();
      win.focus();
    } else {
      win.showInactive();
    }
    if (windowInteraction) windowInteraction.tick();
  }

  function watchDevSources() {
    if (!DEV) return;
    const srcDir = path.join(__dirname, "src");
    let timer = null;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
      }, 100);
    };
    try {
      fs.watch(srcDir, { recursive: true }, reload);
      console.log(
        "  hot reload: editing files under pet/src will refresh the window.",
      );
    } catch {
      for (const name of fs.readdirSync(srcDir)) {
        fs.watch(path.join(srcDir, name), reload);
      }
      console.log(
        "  hot reload: editing files under pet/src will refresh the window.",
      );
    }
  }

  function toggleVisible() {
    if (!win || win.isDestroyed()) return create();
    if (win.isVisible()) {
      win.hide();
    } else {
      revealWindow();
    }
  }

  function registerShortcuts() {
    const wanted = [[TOGGLE_KEY, toggleVisible]];

    const failed = [];
    for (const [accel, fn] of wanted) {
      try {
        if (!globalShortcut.register(accel, fn)) failed.push(accel);
      } catch {
        failed.push(accel);
      }
    }

    console.log("");
    console.log("  Border Collie is watching.");
    console.log(
      `    Mac:     ${prettyShortcut(TOGGLE_KEY, "darwin")}    show / hide`,
    );
    console.log(
      `    Windows: ${prettyShortcut(TOGGLE_KEY, "win32")}        show / hide`,
    );
    if (failed.length) {
      console.log("");
      console.log(
        `  Note: ${failed.map((a) => prettyShortcut(a)).join(", ")} could not be registered  -  another app owns`,
      );
      console.log(
        `  it. Pass --shortcut="${prettyShortcut(`${MOD}+K`)}" (or similar) to pick a different one.`,
      );
    }
    console.log("");
  }

  ipcMain.handle("borderCollie:config", () => ({
    eventsFile: EVENTS_FILE,
    solid: SOLID,
    dev: DEV,
    scale: settings.scale,
    toggleKey: prettyShortcut(TOGGLE_KEY),
    animations,
  }));
  ipcMain.on("borderCollie:hit-regions", (event, regions, nextDragRegions) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (windowInteraction) windowInteraction.updateRegions(regions);
    dragRegions = Array.isArray(nextDragRegions) ? nextDragRegions : [];
  });
  ipcMain.on("borderCollie:drag-start", (event, x, y) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const bounds = win.getBounds();
    pointerDrag = {
      sender: event.sender,
      grabOffset: { x: x - bounds.x, y: y - bounds.y },
      lastX: x,
    };
    if (windowInteraction) windowInteraction.setDragging(true);
    win.webContents.send("borderCollie:dragging", { phase: "start", deltaX: 0 });
  });
  ipcMain.on("borderCollie:drag-to", (event, x, y) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!pointerDrag || pointerDrag.sender !== event.sender) return;
    const origin = G.dragOrigin({ x, y }, pointerDrag.grabOffset);
    if (!origin) return;
    const deltaX = x - pointerDrag.lastX;
    const bounds = win.getBounds();
    win.setBounds({ ...bounds, ...origin });
    pointerDrag.lastX = x;
    win.webContents.send("borderCollie:dragging", { phase: "move", deltaX });
  });
  ipcMain.on("borderCollie:drag-end", (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!pointerDrag || pointerDrag.sender !== event.sender) return;
    pointerDrag = null;
    if (windowInteraction) windowInteraction.setDragging(false);
    win.webContents.send("borderCollie:dragging", { phase: "end", deltaX: 0 });
  });
  ipcMain.on("borderCollie:scale-set", (_e, s) => setScale(s));

  app.whenReady().then(() => {
    if (process.platform === "darwin" && !DEV) app.setActivationPolicy("accessory");
    loadSettings();
    animations = loadAnimationTracks(__dirname, PET_CONFIG);
    create();
    watchDevSources();
    registerShortcuts();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) create();
    });
  }).catch((error) => {
    console.error(`[border-collie] ${error.message}`);
    app.exit(1);
  });

  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (ownerRegistry) ownerRegistry.stopPolling();
    if (windowInteraction) windowInteraction.stop();
  });
}
