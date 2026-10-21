import { contextBridge, ipcRenderer } from "electron";
import type { FoundParent, SignalingMessage } from "@kidemonitor/shared";

export interface PairOptions {
  host: string;
  port: number;
  familyCode: string;
  childName: string;
}

export interface PairResult {
  accepted: boolean;
  parentName?: string;
  reason?: string;
}

export interface StatusUpdate {
  state: "unpaired" | "connecting" | "connected" | "reconnecting";
  parentName: string;
  isSharing: boolean;
  paired: boolean;
  /** One-shot explanation for a state change, e.g. why this device was unpaired. */
  message?: string;
}

const api = {
  getStatus: (): Promise<StatusUpdate> => ipcRenderer.invoke("kidemonitor:get-status"),
  onStatus: (cb: (status: StatusUpdate) => void) => {
    ipcRenderer.on("kidemonitor:status", (_event, status) => cb(status));
  },

  discoverParents: (familyCode?: string): Promise<FoundParent[]> =>
    ipcRenderer.invoke("kidemonitor:discover-parents", familyCode),

  pair: (opts: PairOptions): Promise<PairResult> => ipcRenderer.invoke("kidemonitor:pair", opts),
  unpair: (): Promise<void> => ipcRenderer.invoke("kidemonitor:unpair"),

  getScreenSource: (): Promise<string | null> => ipcRenderer.invoke("kidemonitor:get-screen-source"),

  sendSignal: (message: SignalingMessage) => ipcRenderer.send("kidemonitor:send-signal", message),
  onSignal: (cb: (message: SignalingMessage) => void) => {
    ipcRenderer.on("kidemonitor:signal", (_event, message) => cb(message));
  },

  setSharingState: (sharing: boolean) => ipcRenderer.send("kidemonitor:sharing-state", sharing),

  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke("kidemonitor:get-launch-at-login"),
  setLaunchAtLogin: (enabled: boolean): Promise<void> => ipcRenderer.invoke("kidemonitor:set-launch-at-login", enabled),
};

export type KidEmonitorChildApi = typeof api;

contextBridge.exposeInMainWorld("kidemonitor", api);
