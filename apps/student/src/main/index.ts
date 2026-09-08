import { randomUUID } from "node:crypto";
import path from "node:path";
import { FoundTeacher, SignalingMessage, discoverTeachers } from "@ezmonitor/shared";
import { BrowserWindow, app, desktopCapturer, ipcMain } from "electron";
import WebSocket from "ws";

let mainWindow: BrowserWindow | null = null;
let ws: WebSocket | null = null;
const studentId = randomUUID();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 420,
    title: "EzMonitor Student",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
}

interface ConnectOptions {
  host: string;
  port: number;
  classCode: string;
  studentName: string;
}

interface ConnectResult {
  accepted: boolean;
  teacherName?: string;
  reason?: string;
}

function connectToTeacher(opts: ConnectOptions): Promise<ConnectResult> {
  return new Promise((resolve) => {
    ws?.close();

    const params = new URLSearchParams({
      code: opts.classCode,
      id: studentId,
      name: opts.studentName,
    });
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
        resolve({
          accepted: message.accepted,
          teacherName: message.teacherName,
          reason: message.reason,
        });
      }

      mainWindow?.webContents.send("ezmonitor:signal", message);
    });

    socket.on("close", () => {
      mainWindow?.webContents.send("ezmonitor:disconnected");
      if (!settled) {
        settled = true;
        resolve({ accepted: false, reason: "Connection closed" });
      }
    });

    socket.on("error", () => {
      if (!settled) {
        settled = true;
        resolve({ accepted: false, reason: "Could not reach teacher at that address" });
      }
    });
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("ezmonitor:discover-teachers", async (_event, classCode?: string) => {
    const found: FoundTeacher[] = [];
    await discoverTeachers({ classCode, timeoutMs: 2500 }, (teacher) => found.push(teacher));
    return found;
  });

  ipcMain.handle("ezmonitor:connect", async (_event, opts: ConnectOptions) => connectToTeacher(opts));

  ipcMain.handle("ezmonitor:disconnect", async () => {
    ws?.close();
    ws = null;
  });

  ipcMain.handle("ezmonitor:get-screen-source", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    return sources[0]?.id ?? null;
  });

  ipcMain.on("ezmonitor:send-signal", (_event, message: SignalingMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  ws?.close();
  if (process.platform !== "darwin") app.quit();
});
