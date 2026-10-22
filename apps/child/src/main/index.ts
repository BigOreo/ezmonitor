import { randomUUID } from "node:crypto";
import path from "node:path";
import { FoundParent, SignalingMessage, discoverParents } from "@kidemonitor/shared";
import { BrowserWindow, Menu, Tray, app, desktopCapturer, ipcMain, nativeImage, session } from "electron";
import WebSocket from "ws";
import { PairingInfo, clearPairing, loadPairing, savePairing } from "./pairing";
import { hasConfiguredAutostartOnce, markAutostartConfigured } from "./settings";

type ConnectionState = "unpaired" | "connecting" | "connected" | "reconnecting";

interface ConnectOpts {
  host: string;
  port: number;
  familyCode: string;
  childName: string;
  idToUse: string;
}

interface ConnectResult {
  accepted: boolean;
  parentName?: string;
  reason?: string;
}

interface PairOptions {
  host: string;
  port: number;
  familyCode: string;
  childName: string;
}

const RECONNECT_START_MS = 5000;
const RECONNECT_MAX_MS = 60000;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ws: WebSocket | null = null;
let isQuitting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = RECONNECT_START_MS;

let currentPairing: PairingInfo | null = null;
let connectionState: ConnectionState = "unpaired";
let lastParentName = "";
let lastMessage = "";
let isSharing = false;

function createWindow(startHidden: boolean) {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 480,
    height: 480,
    show: !startHidden,
    title: "KidEmonitor Child",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  mainWindow.webContents.once("did-finish-load", () => pushStatus());

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      // Keep running in the background (reachable via the tray icon) so the
      // parent can still connect even if the child window was closed —
      // the same "runs in the background" model as Dropbox/Slack/etc. The
      // process, tray icon, and app remain fully visible the whole time.
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../../assets/tray-icon.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.on("click", () => createWindow(false));
  updateTray();
}

function statusLabel(): string {
  switch (connectionState) {
    case "connected":
      return `Connected to ${lastParentName}${isSharing ? " — screen shared" : ""}`;
    case "reconnecting":
      return "Reconnecting…";
    case "connecting":
      return "Connecting…";
    default:
      return "Not paired";
  }
}

function updateTray() {
  if (!tray) return;
  const label = statusLabel();
  const menu = Menu.buildFromTemplate([
    { label: "KidEmonitor Child", enabled: false },
    { label, enabled: false },
    { type: "separator" },
    { label: "Open", click: () => createWindow(false) },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quit KidEmonitor Child", click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`KidEmonitor Child — ${label}`);
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function pushStatus() {
  updateTray();
  mainWindow?.webContents.send("kidemonitor:status", {
    state: connectionState,
    parentName: lastParentName,
    isSharing,
    paired: !!currentPairing,
    message: lastMessage,
  });
  lastMessage = "";
}

function setConnectionState(state: ConnectionState, parentName?: string, message?: string) {
  connectionState = state;
  if (parentName) lastParentName = parentName;
  lastMessage = message ?? "";
  pushStatus();
}

function setSharing(sharing: boolean) {
  isSharing = sharing;
  pushStatus();
}

/**
 * Clears any stored pairing and returns to the setup screen. Used both for
 * a user-initiated "Remove pairing" and for a parent-initiated revocation
 * (the family code was reset, or the stored code was rejected on
 * reconnect) — in the latter cases `message` explains why, so the user
 * isn't left staring at a silent "Reconnecting…" that will never succeed.
 */
function performUnpair(message?: string) {
  reconnectDelayMs = RECONNECT_START_MS;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
  currentPairing = null;
  clearPairing();
  setConnectionState("unpaired", undefined, message);
}

function connectSocket(opts: ConnectOpts): Promise<ConnectResult> {
  return new Promise((resolve) => {
    ws?.close();

    const params = new URLSearchParams({ code: opts.familyCode, id: opts.idToUse, name: opts.childName });
    const socket = new WebSocket(`ws://${opts.host}:${opts.port}/?${params.toString()}`);
    ws = socket;
    let settled = false;

    socket.on("message", (raw) => {
      let message: SignalingMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "join-ack" && !settled) {
        settled = true;
        resolve({ accepted: message.accepted, parentName: message.parentName, reason: message.reason });
      }
      if (message.type === "kicked") {
        performUnpair(
          message.reason ?? "This device was unpaired by the parent. Set it up again to resume monitoring."
        );
      }
      mainWindow?.webContents.send("kidemonitor:signal", message);
    });

    socket.on("close", () => {
      if (!settled) {
        settled = true;
        resolve({ accepted: false, reason: "Connection closed" });
      }
      if (ws === socket) handleDisconnect();
    });

    socket.on("error", () => {
      if (!settled) {
        settled = true;
        resolve({ accepted: false, reason: "Could not reach the parent device at that address" });
      }
    });
  });
}

function handleDisconnect() {
  setSharing(false);
  if (currentPairing) {
    setConnectionState("reconnecting");
    scheduleReconnect();
  } else {
    setConnectionState("unpaired");
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void attemptReconnect();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
}

async function attemptReconnect(): Promise<void> {
  const pairing = currentPairing;
  if (!pairing) return;
  setConnectionState("reconnecting");

  let result = await connectSocket({
    host: pairing.host,
    port: pairing.port,
    familyCode: pairing.familyCode,
    childName: pairing.childName,
    idToUse: pairing.childId,
  });

  if (!result.accepted && result.reason === "Invalid family code") {
    // The parent explicitly rejected this device's stored code (most
    // likely it was reset for security while this device was offline).
    // Retrying forever would never succeed, and a LAN re-discovery using
    // the same now-invalid code won't find the parent either (it only
    // answers discovery requests carrying its current code) — so stop and
    // tell the user plainly instead of spinning silently.
    performUnpair("This device's family code is no longer valid — it may have been reset. Please pair again.");
    return;
  }

  if (!result.accepted) {
    // The parent computer's LAN IP may have changed (e.g. DHCP lease
    // renewal) — try to relocate it via a fresh discovery broadcast
    // before giving up on this attempt.
    const found: FoundParent[] = [];
    await discoverParents({ familyCode: pairing.familyCode, timeoutMs: 3000 }, (p) => found.push(p));
    if (found.length > 0) {
      const parent = found[0];
      result = await connectSocket({
        host: parent.host,
        port: parent.port,
        familyCode: pairing.familyCode,
        childName: pairing.childName,
        idToUse: pairing.childId,
      });
      if (result.accepted && currentPairing) {
        currentPairing = { ...currentPairing, host: parent.host, port: parent.port };
        savePairing(currentPairing);
      }
    }
  }

  if (result.accepted) {
    reconnectDelayMs = RECONNECT_START_MS;
    setConnectionState("connected", result.parentName ?? pairing.parentName);
  } else {
    scheduleReconnect();
  }
}

async function pairWithParent(opts: PairOptions): Promise<ConnectResult> {
  const idToUse = currentPairing?.childId ?? randomUUID();
  setConnectionState("connecting");

  const result = await connectSocket({ ...opts, idToUse });

  if (result.accepted) {
    currentPairing = {
      host: opts.host,
      port: opts.port,
      familyCode: opts.familyCode,
      childName: opts.childName,
      childId: idToUse,
      parentName: result.parentName,
    };
    savePairing(currentPairing);
    reconnectDelayMs = RECONNECT_START_MS;
    setConnectionState("connected", result.parentName);
  } else {
    setConnectionState(currentPairing ? "reconnecting" : "unpaired");
  }

  return result;
}

// Only one instance of this app should ever be running at a time — the
// OS may try to (re-)launch it on every boot/login regardless of whether
// a copy is already running in the tray, and a double-launch would try to
// pair/reconnect twice and fight over the same screen capture. If another
// instance already holds the lock, hand off to it (surface its window)
// and quit immediately rather than starting a second one.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => createWindow(false));

  app.whenReady().then(() => {
    currentPairing = loadPairing();

    // "Launch at login" is enabled automatically exactly once, on this
    // app's very first run ever, regardless of whether pairing has
    // happened yet — that's what actually makes it "run on system
    // restart" (there is no OS-level "service" mode compatible with
    // screen capture; see the README for why). If the user later
    // disables it via the tray menu, that choice is respected on every
    // later launch rather than being silently re-enabled.
    if (!hasConfiguredAutostartOnce()) {
      app.setLoginItemSettings({ openAtLogin: true });
      markAutostartConfigured();
    }

    // Modern replacement for the legacy desktopCapturer + getUserMedia
    // mandatory-constraints pattern (still works, but Electron's own docs
    // mark it outdated). The renderer calls the standard
    // navigator.mediaDevices.getDisplayMedia() and this handler answers it
    // in the main process — auto-picking the first screen with no UI of
    // our own, same silent-grant behavior as before on platforms where
    // that's achievable. useSystemPicker is deliberately left unset
    // (defaults to false, and is macOS-only and experimental besides) —
    // it would show an OS picker on supported systems, which is exactly
    // the interactive prompt we don't want. On Wayland, this does NOT
    // bypass a portal permission dialog if one appears: that's enforced
    // by the compositor/xdg-desktop-portal as a security boundary below
    // this API, not something any application-level code can opt out of.
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => callback(sources.length > 0 ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    });

    createTray();
    createWindow(!!currentPairing && app.getLoginItemSettings().wasOpenedAtLogin);

    if (currentPairing) {
      void attemptReconnect();
    }

    ipcMain.handle("kidemonitor:get-status", () => ({
      state: connectionState,
      parentName: lastParentName,
      isSharing,
      paired: !!currentPairing,
    }));

    ipcMain.handle("kidemonitor:discover-parents", async (_event, familyCode?: string) => {
      const found: FoundParent[] = [];
      await discoverParents({ familyCode, timeoutMs: 2500 }, (p) => found.push(p));
      return found;
    });

    ipcMain.handle("kidemonitor:pair", async (_event, opts: PairOptions) => pairWithParent(opts));

    ipcMain.handle("kidemonitor:unpair", async () => {
      performUnpair();
    });

    ipcMain.on("kidemonitor:send-signal", (_event, message: SignalingMessage) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });

    ipcMain.on("kidemonitor:sharing-state", (_event, sharing: boolean) => {
      setSharing(sharing);
    });

    ipcMain.handle("kidemonitor:get-launch-at-login", () => app.getLoginItemSettings().openAtLogin);
    ipcMain.handle("kidemonitor:set-launch-at-login", (_event, enabled: boolean) => {
      app.setLoginItemSettings({ openAtLogin: enabled });
    });

    app.on("activate", () => createWindow(false));
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    // Unlike a typical app, closing the window should not exit — the tray
    // icon is the visible, always-present indicator that this device is
    // paired for monitoring. Only an explicit Quit (tray menu) exits.
    if (isQuitting) app.quit();
  });
}
