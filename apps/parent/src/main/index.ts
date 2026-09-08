import os from "node:os";
import path from "node:path";
import { listLocalIPv4Addresses } from "@ezmonitor/shared";
import { BrowserWindow, app, ipcMain } from "electron";
import { loadOrCreateFamilyCode, regenerateFamilyCode } from "./familyCode";
import { SignalingServer } from "./signalingServer";

let mainWindow: BrowserWindow | null = null;
let server: SignalingServer | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "EzMonitor Parent",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
}

app.whenReady().then(() => {
  const parentName = os.hostname();
  const familyCode = loadOrCreateFamilyCode();
  server = new SignalingServer({ parentName, familyCode });

  server.on("child-joined", (child) => {
    mainWindow?.webContents.send("ezmonitor:child-joined", child);
  });
  server.on("child-left", (id: string) => {
    mainWindow?.webContents.send("ezmonitor:child-left", id);
  });
  server.on("child-message", (id: string, message: unknown) => {
    mainWindow?.webContents.send("ezmonitor:child-message", id, message);
  });

  ipcMain.on("ezmonitor:send-to-child", (_event, childId: string, message) => {
    server?.sendToChild(childId, message);
  });

  ipcMain.handle("ezmonitor:get-session-info", () => ({
    familyCode: server?.familyCode,
    parentName: server?.parentName,
    port: server?.port,
    addresses: listLocalIPv4Addresses(),
  }));

  ipcMain.handle("ezmonitor:regenerate-family-code", () => {
    const newCode = regenerateFamilyCode();
    const kicked = server?.regenerateFamilyCode(newCode) ?? 0;
    return { familyCode: newCode, kicked };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  server?.close();
  if (process.platform !== "darwin") app.quit();
});
