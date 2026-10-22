import { EventEmitter } from "node:events";
import http from "node:http";
import { BROWSING_INGEST_PORT, BrowsingVisit } from "@kidemonitor/shared";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const KNOWN_BROWSERS = new Set(["chrome", "edge", "firefox", "safari"]);

/**
 * Localhost-only HTTP server the browser extension (browser-extension/)
 * POSTs individual visit reports to. Bound to 127.0.0.1 specifically —
 * never 0.0.0.0 — so nothing on the LAN can reach it, only processes on
 * this same machine. That still means any other local process could POST
 * here too (binding to loopback restricts the network, not which local
 * process can connect) — accepted for now, consistent with this project's
 * existing LAN trust model (the family code is explicitly "not intended
 * as strong security" either); exploiting this would require code
 * already running on the child's own machine, which is a much bigger
 * problem than this endpoint on its own.
 *
 * Deliberately dumb: no queue/flush logic lives here. Each validated
 * visit is just emitted; the caller (apps/child/src/main/index.ts) owns
 * batching and forwarding to the parent, since it's the one that already
 * tracks the connection state needed to decide when that's possible.
 */
export class BrowsingIngestServer extends EventEmitter {
  readonly port: number;
  private readonly httpServer: http.Server;

  constructor(opts: { port?: number } = {}) {
    super();
    this.port = opts.port ?? BROWSING_INGEST_PORT;
    this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
    this.httpServer.listen(this.port, "127.0.0.1");
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method !== "POST" || req.url !== "/report-visit") {
      res.writeHead(404).end();
      return;
    }

    let body = "";
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413).end();
        req.destroy();
      }
    });
    req.on("error", () => {
      // client disconnected mid-upload; nothing to do
    });
    req.on("end", () => {
      if (tooLarge) return;
      const visit = parseVisit(body);
      if (!visit) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid visit" }));
        return;
      }
      this.emit("visit", visit);
      res.writeHead(204).end();
    });
  }

  close() {
    this.httpServer.close();
  }
}

function parseVisit(raw: string): BrowsingVisit | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (
    typeof d.url !== "string" ||
    d.url.length === 0 ||
    d.url.length > 2048 ||
    typeof d.domain !== "string" ||
    d.domain.length === 0 ||
    d.domain.length > 255 ||
    typeof d.title !== "string" ||
    d.title.length > 512 ||
    typeof d.browser !== "string" ||
    !KNOWN_BROWSERS.has(d.browser) ||
    typeof d.startedAt !== "number" ||
    !Number.isFinite(d.startedAt) ||
    typeof d.endedAt !== "number" ||
    !Number.isFinite(d.endedAt) ||
    typeof d.durationMs !== "number" ||
    !Number.isFinite(d.durationMs) ||
    d.durationMs < 0 ||
    d.durationMs > MAX_DURATION_MS ||
    d.endedAt < d.startedAt
  ) {
    return null;
  }

  return {
    url: d.url,
    domain: d.domain,
    title: d.title,
    browser: d.browser as BrowsingVisit["browser"],
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    durationMs: d.durationMs,
  };
}
