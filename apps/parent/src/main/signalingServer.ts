import { EventEmitter } from "node:events";
import http from "node:http";
import {
  ChildInfo,
  DEFAULT_SIGNALING_PORT,
  ParentAnnouncer,
  SignalingMessage,
  startParentAnnouncer,
} from "@ezmonitor/shared";
import { WebSocket, WebSocketServer } from "ws";

interface ChildConnection {
  id: string;
  name: string;
  ws: WebSocket;
}

/**
 * Hosts the WebSocket signaling server child devices connect to, and the
 * UDP announcer that lets child devices auto-discover this parent app on
 * the home LAN. Emits high-level events for the renderer (via the main
 * process) to react to, and relays SignalingMessages to/from individual
 * child devices.
 */
export class SignalingServer extends EventEmitter {
  readonly familyCode: string;
  readonly parentName: string;
  readonly port: number;

  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly announcer: ParentAnnouncer;
  private readonly children = new Map<string, ChildConnection>();

  constructor(opts: { parentName: string; familyCode: string; port?: number }) {
    super();
    this.parentName = opts.parentName;
    this.familyCode = opts.familyCode;
    this.port = opts.port ?? DEFAULT_SIGNALING_PORT;

    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    this.httpServer.listen(this.port);

    this.announcer = startParentAnnouncer({
      familyCode: this.familyCode,
      parentName: this.parentName,
      port: this.port,
    });
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url ?? "", "http://localhost");
    const code = url.searchParams.get("code");
    const childId = url.searchParams.get("id") ?? cryptoRandomId();
    const childName = url.searchParams.get("name") ?? "Unknown Device";

    if (code !== this.familyCode) {
      this.sendTo(ws, {
        type: "join-ack",
        accepted: false,
        parentName: this.parentName,
        reason: "Invalid family code",
      });
      ws.close();
      return;
    }

    const conn: ChildConnection = { id: childId, name: childName, ws };
    this.children.set(childId, conn);

    this.sendTo(ws, {
      type: "join-ack",
      accepted: true,
      parentName: this.parentName,
    });

    const info: ChildInfo = { id: childId, name: childName };
    this.emit("child-joined", info);

    ws.on("message", (raw) => {
      let message: SignalingMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.emit("child-message", childId, message);
    });

    ws.on("close", () => {
      this.children.delete(childId);
      this.emit("child-left", childId);
    });

    ws.on("error", () => {
      this.children.delete(childId);
      this.emit("child-left", childId);
    });
  }

  sendToChild(childId: string, message: SignalingMessage) {
    const conn = this.children.get(childId);
    if (conn) this.sendTo(conn.ws, message);
  }

  private sendTo(ws: WebSocket, message: SignalingMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  close() {
    this.announcer.stop();
    for (const conn of this.children.values()) conn.ws.close();
    this.wss.close();
    this.httpServer.close();
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
