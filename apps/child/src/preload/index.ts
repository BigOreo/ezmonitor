import { contextBridge, ipcRenderer } from "electron";
import type { FoundParent, SignalingMessage } from "@ezmonitor/shared";

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
  getStatus: (): Promise<StatusUpdate> => ipcRenderer.invoke("ezmonitor:get-status"),
  onStatus: (cb: (status: StatusUpdate) => void) => {
    ipcRenderer.on("ezmonitor:status", (_event, status) => cb(status));
  },

  discoverParents: (familyCode?: string): Promise<FoundParent[]> =>
    ipcRenderer.invoke("ezmonitor:discover-parents", familyCode),

  pair: (opts: PairOptions): Promise<PairResult> => ipcRenderer.invoke("ezmonitor:pair", opts),
  unpair: (): Promise<void> => ipcRenderer.invoke("ezmonitor:unpair"),

  getScreenSource: (): Promise<string | null> => ipcRenderer.invoke("ezmonitor:get-screen-source"),

  sendSignal: (message: SignalingMessage) => ipcRenderer.send("ezmonitor:send-signal", message),
  onSignal: (cb: (message: SignalingMessage) => void) => {
    ipcRenderer.on("ezmonitor:signal", (_event, message) => cb(message));
  },

  setSharingState: (sharing: boolean) => ipcRenderer.send("ezmonitor:sharing-state", sharing),

  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke("ezmonitor:get-launch-at-login"),
  setLaunchAtLogin: (enabled: boolean): Promise<void> => ipcRenderer.invoke("ezmonitor:set-launch-at-login", enabled),
};

export type EzMonitorChildApi = typeof api;

contextBridge.exposeInMainWorld("ezmonitor", api);
