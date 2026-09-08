import { contextBridge, ipcRenderer } from "electron";
import type { ChildInfo, SignalingMessage } from "@ezmonitor/shared";

export interface SessionInfo {
  familyCode: string;
  parentName: string;
  port: number;
  addresses: string[];
}

const api = {
  getSessionInfo: (): Promise<SessionInfo> => ipcRenderer.invoke("ezmonitor:get-session-info"),

  onChildJoined: (cb: (child: ChildInfo) => void) => {
    ipcRenderer.on("ezmonitor:child-joined", (_event, child) => cb(child));
  },
  onChildLeft: (cb: (childId: string) => void) => {
    ipcRenderer.on("ezmonitor:child-left", (_event, childId) => cb(childId));
  },
  onChildMessage: (cb: (childId: string, message: SignalingMessage) => void) => {
    ipcRenderer.on("ezmonitor:child-message", (_event, childId, message) => cb(childId, message));
  },

  sendToChild: (childId: string, message: SignalingMessage) => {
    ipcRenderer.send("ezmonitor:send-to-child", childId, message);
  },

  regenerateFamilyCode: (): Promise<{ familyCode: string; kicked: number }> =>
    ipcRenderer.invoke("ezmonitor:regenerate-family-code"),
};

export type EzMonitorParentApi = typeof api;

contextBridge.exposeInMainWorld("ezmonitor", api);
