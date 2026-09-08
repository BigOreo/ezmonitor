import { contextBridge, ipcRenderer } from "electron";
import type { FoundTeacher, SignalingMessage } from "@ezmonitor/shared";

export interface ConnectOptions {
  host: string;
  port: number;
  classCode: string;
  studentName: string;
}

export interface ConnectResult {
  accepted: boolean;
  teacherName?: string;
  reason?: string;
}

const api = {
  discoverTeachers: (classCode?: string): Promise<FoundTeacher[]> =>
    ipcRenderer.invoke("ezmonitor:discover-teachers", classCode),

  connect: (opts: ConnectOptions): Promise<ConnectResult> => ipcRenderer.invoke("ezmonitor:connect", opts),

  disconnect: (): Promise<void> => ipcRenderer.invoke("ezmonitor:disconnect"),

  getScreenSource: (): Promise<string | null> => ipcRenderer.invoke("ezmonitor:get-screen-source"),

  sendSignal: (message: SignalingMessage) => ipcRenderer.send("ezmonitor:send-signal", message),

  onSignal: (cb: (message: SignalingMessage) => void) => {
    ipcRenderer.on("ezmonitor:signal", (_event, message) => cb(message));
  },
  onDisconnected: (cb: () => void) => {
    ipcRenderer.on("ezmonitor:disconnected", () => cb());
  },
};

export type EzMonitorStudentApi = typeof api;

contextBridge.exposeInMainWorld("ezmonitor", api);
