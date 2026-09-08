import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { listLocalIPv4Addresses } from "@ezmonitor/shared";
import { BrowserWindow, app, ipcMain } from "electron";
import { SignalingServer } from "./signalingServer";

let mainWindow: BrowserWindow | null = null;
let server: SignalingServer | null = null;

function generateClassCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "EzMonitor Teacher",
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
  const teacherName = os.hostname();
  const classCode = generateClassCode();
  server = new SignalingServer({ teacherName, classCode });

  server.on("student-joined", (student) => {
    mainWindow?.webContents.send("ezmonitor:student-joined", student);
  });
  server.on("student-left", (id: string) => {
    mainWindow?.webContents.send("ezmonitor:student-left", id);
  });
  server.on("student-message", (id: string, message: unknown) => {
    mainWindow?.webContents.send("ezmonitor:student-message", id, message);
  });

  ipcMain.on("ezmonitor:send-to-student", (_event, studentId: string, message) => {
    server?.sendToStudent(studentId, message);
  });

  ipcMain.handle("ezmonitor:get-session-info", () => ({
    classCode: server?.classCode,
    teacherName: server?.teacherName,
    port: server?.port,
    addresses: listLocalIPv4Addresses(),
  }));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  server?.close();
  if (process.platform !== "darwin") app.quit();
});
