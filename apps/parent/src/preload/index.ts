import { contextBridge, ipcRenderer } from "electron";
import type { BrowsingVisit, ChildInfo, SignalingMessage } from "@kidemonitor/shared";

export interface SessionInfo {
  familyCode: string;
  parentName: string;
  port: number;
  addresses: string[];
  browserPortalUrls: string[];
}

const api = {
  getSessionInfo: (): Promise<SessionInfo> => ipcRenderer.invoke("kidemonitor:get-session-info"),

  onChildJoined: (cb: (child: ChildInfo) => void) => {
    ipcRenderer.on("kidemonitor:child-joined", (_event, child) => cb(child));
  },
  onChildLeft: (cb: (childId: string) => void) => {
    ipcRenderer.on("kidemonitor:child-left", (_event, childId) => cb(childId));
  },
  onChildMessage: (cb: (childId: string, message: SignalingMessage) => void) => {
    ipcRenderer.on("kidemonitor:child-message", (_event, childId, message) => cb(childId, message));
  },

  sendToChild: (childId: string, message: SignalingMessage) => {
    ipcRenderer.send("kidemonitor:send-to-child", childId, message);
  },

  regenerateFamilyCode: (): Promise<{ familyCode: string; kicked: number }> =>
    ipcRenderer.invoke("kidemonitor:regenerate-family-code"),

  getBrowsingActivity: (childId: string, since?: number): Promise<BrowsingVisit[]> =>
    ipcRenderer.invoke("kidemonitor:get-browsing-activity", childId, since),
};

export type KidEmonitorParentApi = typeof api;

contextBridge.exposeInMainWorld("kidemonitor", api);
