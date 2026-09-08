import { contextBridge, ipcRenderer } from "electron";
import type { SignalingMessage, StudentInfo } from "@ezmonitor/shared";

export interface SessionInfo {
  classCode: string;
  teacherName: string;
  port: number;
  addresses: string[];
}

const api = {
  getSessionInfo: (): Promise<SessionInfo> => ipcRenderer.invoke("ezmonitor:get-session-info"),

  onStudentJoined: (cb: (student: StudentInfo) => void) => {
    ipcRenderer.on("ezmonitor:student-joined", (_event, student) => cb(student));
  },
  onStudentLeft: (cb: (studentId: string) => void) => {
    ipcRenderer.on("ezmonitor:student-left", (_event, studentId) => cb(studentId));
  },
  onStudentMessage: (cb: (studentId: string, message: SignalingMessage) => void) => {
    ipcRenderer.on("ezmonitor:student-message", (_event, studentId, message) => cb(studentId, message));
  },

  sendToStudent: (studentId: string, message: SignalingMessage) => {
    ipcRenderer.send("ezmonitor:send-to-student", studentId, message);
  },
};

export type EzMonitorTeacherApi = typeof api;

contextBridge.exposeInMainWorld("ezmonitor", api);
