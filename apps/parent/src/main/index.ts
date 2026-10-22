import os from "node:os";
import path from "node:path";
import { listLocalIPv4Addresses } from "@kidemonitor/shared";
import { BrowserWindow, app, ipcMain } from "electron";
import * as browsingStore from "./browsingStore";
import { loadOrCreateFamilyCode, regenerateFamilyCode } from "./familyCode";
import { SignalingServer } from "./signalingServer";

let mainWindow: BrowserWindow | null = null;
let server: SignalingServer | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "KidEmonitor Parent",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
}

// Only one instance should ever run at once — a second copy would try to
// bind the same signaling TCP port and UDP discovery port as the first.
// If another instance already holds the lock, hand off to it (focus its
// window) and quit immediately rather than fighting over those ports.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    const parentName = os.hostname();
    const familyCode = loadOrCreateFamilyCode();
    const browserViewerDir = path.join(__dirname, "../../browser-viewer");
    server = new SignalingServer({
      parentName,
      familyCode,
      browserViewerDir,
      onGetBrowsingActivity: (childId, since) => browsingStore.getVisits(childId, since),
    });

    server.on("child-joined", (child) => {
      mainWindow?.webContents.send("kidemonitor:child-joined", child);
    });
    server.on("child-left", (id: string) => {
      mainWindow?.webContents.send("kidemonitor:child-left", id);
    });
    server.on("child-message", (id: string, message: unknown) => {
      mainWindow?.webContents.send("kidemonitor:child-message", id, message);
    });
    server.on("browsing-activity", (childId: string, visits) => {
      browsingStore.addVisits(childId, visits);
    });

    ipcMain.on("kidemonitor:send-to-child", (_event, childId: string, message) => {
      // The parent app's own window is always viewer "local" — see
      // packages/shared/src/protocol.ts for why messages need this tag.
      server?.sendToChild(childId, { ...message, viewerId: "local" });
    });

    ipcMain.handle("kidemonitor:get-session-info", () => {
      const addresses = listLocalIPv4Addresses();
      const port = server?.port;
      return {
        familyCode: server?.familyCode,
        parentName: server?.parentName,
        port,
        addresses,
        browserPortalUrls: addresses.map((address) => `http://${address}:${port}`),
      };
    });

    ipcMain.handle("kidemonitor:regenerate-family-code", () => {
      const newCode = regenerateFamilyCode();
      const kicked = server?.regenerateFamilyCode(newCode) ?? 0;
      return { familyCode: newCode, kicked };
    });

    ipcMain.handle("kidemonitor:get-browsing-activity", (_event, childId: string, since?: number) =>
      browsingStore.getVisits(childId, since)
    );

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    server?.close();
    if (process.platform !== "darwin") app.quit();
  });
}
