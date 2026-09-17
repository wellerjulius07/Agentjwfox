"use strict";
// Electron main. Owns everything privileged: the store, the connectors, the
// API key, Jarvis. Both windows are renderers with no node access - they reach
// in only through the IPC channels registered here.

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, shell } = require("electron");

const { Store } = require("./store");
const { makeRegistry } = require("./connectors");
const { sampleJson, abort } = require("./sample");
const { makeJarvis } = require("./jarvis");

const TZ = process.env.JARVIS_TZ || "Europe/Berlin";
loadEnv(path.join(__dirname, "..", "..", ".env"));

let store, registry, jarvis, tray;
const windows = { chat: null, brain: null };

// A three-line .env reader beats a dependency for five keys.
function loadEnv(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["'](.*)["']$/, "$1");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function makeWindow(kind, { width, height, title }) {
  const win = new BrowserWindow({
    width, height, title,
    backgroundColor: "#05060A",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", `${kind}.js`),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,           // the preload needs require("electron")
    },
  });
  win.once("ready-to-show", () => win.show());
  // Anything the page links out to belongs in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  return win;
}

function openBrain() {
  if (windows.brain && !windows.brain.isDestroyed()) return windows.brain.focus();
  windows.brain = makeWindow("brain", { width: 1280, height: 900, title: "Semester-Cortex" });
  windows.brain.loadFile(path.join(__dirname, "..", "renderer", "brain", "cortex.html"));
  windows.brain.on("closed", () => { windows.brain = null; });
}

function openChat() {
  if (windows.chat && !windows.chat.isDestroyed()) return windows.chat.focus();
  windows.chat = makeWindow("chat", { width: 560, height: 760, title: "Jarvis" });
  windows.chat.loadFile(path.join(__dirname, "..", "renderer", "chat", "index.html"));
  windows.chat.on("closed", () => { windows.chat = null; });
}

const broadcast = (channel, payload) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
};

const asIpcError = (e) => ({ code: e?.code || "tool_error", message: e?.message || String(e) });

function registerIpc() {
  // ---- mcp
  ipcMain.handle("mcp:call", async (_e, { server, tool, input }) => {
    try {
      return { ok: true, payload: await registry.call(server, tool, input) };
    } catch (e) {
      return { ok: false, error: asIpcError(e) };
    }
  });

  // ---- db
  ipcMain.handle("db:get", async (_e, { path: p }) => {
    try { const { exists, data } = store.get(p); return { ok: true, exists, data }; }
    catch (e) { return { ok: false, error: asIpcError(e) }; }
  });

  ipcMain.handle("db:list", async (_e, { collection }) => {
    try { return { ok: true, docs: store.list(collection) }; }
    catch (e) { return { ok: false, error: asIpcError(e) }; }
  });

  ipcMain.handle("db:write", async (_e, { path: p, value, merge }) => {
    try { store.write(p, value, merge); return { ok: true }; }
    catch (e) { return { ok: false, error: asIpcError(e) }; }
  });

  ipcMain.handle("db:delete", async (_e, { path: p }) => {
    try { store.remove(p); return { ok: true }; }
    catch (e) { return { ok: false, error: asIpcError(e) }; }
  });

  // ---- sample
  ipcMain.handle("sample:json", (_e, payload) => sampleJson(payload));
  ipcMain.on("sample:abort", (_e, { id }) => abort(id));

  // ---- jarvis
  ipcMain.handle("jarvis:ask", async (e, { id, prompt }) => {
    const send = (msg) => { if (!e.sender.isDestroyed()) e.sender.send("jarvis:stream", { id, ...msg }); };
    try {
      for await (const msg of jarvis.ask(prompt)) send(msg);
    } catch (err) {
      send({ kind: "error", message: err?.message || String(err) });
    }
    send({ kind: "end" });
    return { ok: true };
  });

  ipcMain.on("jarvis:interrupt", () => jarvis.interrupt());
  ipcMain.on("jarvis:reset", () => jarvis.reset());
  ipcMain.on("brain:open", () => openBrain());
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath("userData"), "cortex"));
  registry = makeRegistry(process.env, TZ);
  jarvis = makeJarvis({ store, registry, cwd: app.getPath("home") });

  // One store, two windows: a write from Jarvis redraws the brain.
  store.on("changed", ({ path: p, collection }) => broadcast("db:changed", { path: p, collection }));

  registerIpc();
  openChat();

  // The whole point of a desktop app: it is one keystroke away, always.
  globalShortcut.register("CommandOrControl+Shift+J", () => {
    if (windows.chat && windows.chat.isVisible() && windows.chat.isFocused()) windows.chat.hide();
    else openChat();
  });

  tray = new Tray(path.join(__dirname, "..", "renderer", "tray.png"));
  tray.setToolTip("Jarvis");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Jarvis", click: openChat },
    { label: "Cortex", click: openBrain },
    { type: "separator" },
    { label: "Beenden", click: () => app.quit() },
  ]));
  tray.on("click", openChat);

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) openChat(); });
});

// A cockpit lives in the tray; closing a window must not kill it.
app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
