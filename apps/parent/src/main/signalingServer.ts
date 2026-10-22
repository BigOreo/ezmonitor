import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  BrowsingVisit,
  ChildInfo,
  ConsentResponse,
  DEFAULT_SIGNALING_PORT,
  IceCandidateMessage,
  ParentAnnouncer,
  SdpAnswer,
  SdpOffer,
  SignalingMessage,
  StopViewing,
  ViewRequest,
  startParentAnnouncer,
} from "@kidemonitor/shared";
import { WebSocket, WebSocketServer } from "ws";

interface ChildConnection {
  id: string;
  name: string;
  ws: WebSocket;
}

interface ViewerConnection {
  id: string;
  ws: WebSocket;
}

/** The five per-viewing-session message types that carry viewerId/childId routing info. */
type RoutableMessage = ViewRequest | ConsentResponse | SdpOffer | SdpAnswer | IceCandidateMessage | StopViewing;

function isRoutable(message: SignalingMessage): message is RoutableMessage {
  return (
    message.type === "view-request" ||
    message.type === "consent-response" ||
    message.type === "offer" ||
    message.type === "answer" ||
    message.type === "ice-candidate" ||
    message.type === "stop-viewing"
  );
}

/** Fixed id for the parent app's own built-in viewer (as opposed to a browser portal session). */
const LOCAL_VIEWER_ID = "local";

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/viewer.js": { file: "viewer.js", contentType: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
};

/**
 * Hosts the WebSocket signaling server that both child devices and
 * viewers connect to, the UDP announcer that lets child devices
 * auto-discover this parent app on the home LAN, and the "browser
 * portal" — a small static page served over plain HTTP on the same port
 * so any browser on the same LAN can view paired children's screens
 * without installing the parent app. A child may be watched by several
 * viewers at once (the parent app's own window, plus any number of
 * browser portal tabs); see packages/shared/src/protocol.ts for how
 * messages are routed between them.
 */
export class SignalingServer extends EventEmitter {
  readonly parentName: string;
  readonly port: number;

  private _familyCode: string;
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly announcer: ParentAnnouncer;
  private readonly children = new Map<string, ChildConnection>();
  private readonly viewers = new Map<string, ViewerConnection>();
  private readonly browserViewerDir: string;
  private readonly onGetBrowsingActivity?: (childId: string, since?: number) => BrowsingVisit[];

  constructor(opts: {
    parentName: string;
    familyCode: string;
    port?: number;
    browserViewerDir: string;
    /** Answers a browser portal viewer's GetBrowsingActivity request (the parent app's own renderer queries the store directly over IPC instead, bypassing this entirely). */
    onGetBrowsingActivity?: (childId: string, since?: number) => BrowsingVisit[];
  }) {
    super();
    this.parentName = opts.parentName;
    this._familyCode = opts.familyCode;
    this.port = opts.port ?? DEFAULT_SIGNALING_PORT;
    this.browserViewerDir = opts.browserViewerDir;
    this.onGetBrowsingActivity = opts.onGetBrowsingActivity;

    this.httpServer = http.createServer();
    this.httpServer.on("request", (req, res) => this.serveStaticFile(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleUpgrade(ws, req));
    this.httpServer.listen(this.port);

    this.announcer = startParentAnnouncer({
      getFamilyCode: () => this._familyCode,
      getParentName: () => this.parentName,
      port: this.port,
    });
  }

  get familyCode(): string {
    return this._familyCode;
  }

  /**
   * Rotates the family code (e.g. because it may have leaked outside the
   * household). Any child device or browser viewer connected right now is
   * told it has been kicked and disconnected immediately; a device that
   * only has the old code stored (paired but offline) will be rejected —
   * with a clear reason — the next time it tries to reconnect. Returns how
   * many currently-connected child devices were disconnected.
   */
  regenerateFamilyCode(newCode: string): number {
    this._familyCode = newCode;
    const reason = "The family code was reset by the parent for security. Please pair this device again.";

    const affectedChildren = Array.from(this.children.values());
    for (const conn of affectedChildren) {
      this.sendTo(conn.ws, { type: "kicked", reason });
      conn.ws.close();
    }

    for (const viewer of this.viewers.values()) {
      this.sendTo(viewer.ws, {
        type: "kicked",
        reason: "The family code was reset. Please enter the new code to keep viewing.",
      });
      viewer.ws.close();
    }

    return affectedChildren.length;
  }

  private handleUpgrade(ws: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname === "/viewer") {
      this.handleViewerConnection(ws, url);
    } else {
      this.handleChildConnection(ws, url);
    }
  }

  private handleChildConnection(ws: WebSocket, url: URL) {
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
    this.broadcastToViewers({ type: "child-joined", child: info });

    ws.on("message", (raw) => {
      let message: SignalingMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Browsing-activity reports are data for the parent to store, never
      // relayed to any viewer (unlike everything else a child sends).
      if (message.type === "browsing-activity") {
        this.emit("browsing-activity", childId, message.visits);
        return;
      }

      // A message tagged for a specific (non-local) viewer is relayed
      // straight to that browser portal session; everything else (the
      // untagged/local case, plus one-off events with no per-session
      // routing) goes out via the existing IPC path to the parent app's
      // own renderer, exactly as before this feature existed.
      if (isRoutable(message) && message.viewerId && message.viewerId !== LOCAL_VIEWER_ID) {
        const { viewerId, ...rest } = message;
        this.sendToViewer(viewerId, { ...rest, childId } as SignalingMessage);
      } else {
        this.emit("child-message", childId, message);
      }
    });

    ws.on("close", () => {
      this.children.delete(childId);
      this.emit("child-left", childId);
      this.broadcastToViewers({ type: "child-left", childId });
    });

    ws.on("error", () => {
      this.children.delete(childId);
      this.emit("child-left", childId);
      this.broadcastToViewers({ type: "child-left", childId });
    });
  }

  private handleViewerConnection(ws: WebSocket, url: URL) {
    const code = url.searchParams.get("code");
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

    const viewerId = cryptoRandomId();
    this.viewers.set(viewerId, { id: viewerId, ws });

    this.sendTo(ws, { type: "join-ack", accepted: true, parentName: this.parentName });
    this.sendTo(ws, {
      type: "children-list",
      children: Array.from(this.children.values()).map((c) => ({ id: c.id, name: c.name })),
    });

    ws.on("message", (raw) => {
      let message: SignalingMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.type === "get-browsing-activity") {
        const visits = this.onGetBrowsingActivity?.(message.childId, message.since) ?? [];
        this.sendTo(ws, { type: "browsing-activity-history", childId: message.childId, visits });
        return;
      }

      if (!isRoutable(message) || !message.childId) return;
      const { childId, ...rest } = message;
      this.sendToChild(childId, { ...rest, viewerId } as SignalingMessage);
    });

    const cleanup = () => this.viewers.delete(viewerId);
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  }

  sendToChild(childId: string, message: SignalingMessage) {
    const conn = this.children.get(childId);
    if (conn) this.sendTo(conn.ws, message);
  }

  private sendToViewer(viewerId: string, message: SignalingMessage) {
    const viewer = this.viewers.get(viewerId);
    if (viewer) this.sendTo(viewer.ws, message);
  }

  private broadcastToViewers(message: SignalingMessage) {
    for (const viewer of this.viewers.values()) this.sendTo(viewer.ws, message);
  }

  private sendTo(ws: WebSocket, message: SignalingMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse) {
    const pathname = (req.url ?? "/").split("?")[0];
    const route = STATIC_FILES[pathname];
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    fs.readFile(path.join(this.browserViewerDir, route.file), (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error");
        return;
      }
      res.writeHead(200, { "Content-Type": route.contentType });
      res.end(data);
    });
  }

  close() {
    this.announcer.stop();
    for (const conn of this.children.values()) conn.ws.close();
    for (const viewer of this.viewers.values()) viewer.ws.close();
    this.wss.close();
    this.httpServer.close();
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
