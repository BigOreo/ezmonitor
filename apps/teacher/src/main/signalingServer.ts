import { EventEmitter } from "node:events";
import http from "node:http";
import {
  DEFAULT_SIGNALING_PORT,
  SignalingMessage,
  StudentInfo,
  TeacherAnnouncer,
  startTeacherAnnouncer,
} from "@ezmonitor/shared";
import { WebSocket, WebSocketServer } from "ws";

interface StudentConnection {
  id: string;
  name: string;
  ws: WebSocket;
}

/**
 * Hosts the WebSocket signaling server students connect to, and the UDP
 * announcer that lets students auto-discover this teacher on the LAN.
 * Emits high-level events for the renderer (via the main process) to react
 * to, and relays SignalingMessages to/from individual students.
 */
export class SignalingServer extends EventEmitter {
  readonly classCode: string;
  readonly teacherName: string;
  readonly port: number;

  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly announcer: TeacherAnnouncer;
  private readonly students = new Map<string, StudentConnection>();

  constructor(opts: { teacherName: string; classCode: string; port?: number }) {
    super();
    this.teacherName = opts.teacherName;
    this.classCode = opts.classCode;
    this.port = opts.port ?? DEFAULT_SIGNALING_PORT;

    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    this.httpServer.listen(this.port);

    this.announcer = startTeacherAnnouncer({
      classCode: this.classCode,
      teacherName: this.teacherName,
      port: this.port,
    });
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url ?? "", "http://localhost");
    const code = url.searchParams.get("code");
    const studentId = url.searchParams.get("id") ?? cryptoRandomId();
    const studentName = url.searchParams.get("name") ?? "Unknown Student";

    if (code !== this.classCode) {
      this.sendTo(ws, {
        type: "join-ack",
        accepted: false,
        teacherName: this.teacherName,
        reason: "Invalid class code",
      });
      ws.close();
      return;
    }

    const conn: StudentConnection = { id: studentId, name: studentName, ws };
    this.students.set(studentId, conn);

    this.sendTo(ws, {
      type: "join-ack",
      accepted: true,
      teacherName: this.teacherName,
    });

    const info: StudentInfo = { id: studentId, name: studentName };
    this.emit("student-joined", info);

    ws.on("message", (raw) => {
      let message: SignalingMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.emit("student-message", studentId, message);
    });

    ws.on("close", () => {
      this.students.delete(studentId);
      this.emit("student-left", studentId);
    });

    ws.on("error", () => {
      this.students.delete(studentId);
      this.emit("student-left", studentId);
    });
  }

  sendToStudent(studentId: string, message: SignalingMessage) {
    const conn = this.students.get(studentId);
    if (conn) this.sendTo(conn.ws, message);
  }

  private sendTo(ws: WebSocket, message: SignalingMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  close() {
    this.announcer.stop();
    for (const conn of this.students.values()) conn.ws.close();
    this.wss.close();
    this.httpServer.close();
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
