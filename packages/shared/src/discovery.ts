import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

/** UDP port used for LAN auto-discovery broadcasts (not the signaling port). */
export const DISCOVERY_PORT = 41234;
/** Default TCP port for the parent app's WebSocket signaling server. */
export const DEFAULT_SIGNALING_PORT = 41235;

interface DiscoverWireMessage {
  type: "ezmonitor-discover";
  familyCode?: string;
}

interface AnnounceWireMessage {
  type: "ezmonitor-announce";
  familyCode: string;
  parentName: string;
  port: number;
}

export interface FoundParent {
  parentName: string;
  familyCode: string;
  host: string;
  port: number;
}

export interface ParentAnnouncer {
  stop(): void;
}

/**
 * Runs on the parent app. Listens for discovery broadcasts from child
 * devices on the LAN and replies directly (unicast) with connection
 * details.
 */
export function startParentAnnouncer(opts: {
  familyCode: string;
  parentName: string;
  port: number;
}): ParentAnnouncer {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    let parsed: DiscoverWireMessage;
    try {
      parsed = JSON.parse(msg.toString());
    } catch {
      return;
    }
    if (parsed.type !== "ezmonitor-discover") return;
    if (parsed.familyCode && parsed.familyCode !== opts.familyCode) return;

    const announce: AnnounceWireMessage = {
      type: "ezmonitor-announce",
      familyCode: opts.familyCode,
      parentName: opts.parentName,
      port: opts.port,
    };
    socket.send(JSON.stringify(announce), rinfo.port, rinfo.address);
  });

  socket.on("error", () => {
    // Discovery is a convenience feature; a bind/socket error here should
    // not crash the app. Child devices can still connect via manual IP
    // entry, or a previously stored pairing.
  });

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
  });

  return {
    stop: () => socket.close(),
  };
}

/**
 * Runs on the child app. Broadcasts a discovery request on the LAN and
 * collects announcements from any parent apps that respond within the
 * timeout window. Used both for first-time setup and to re-locate the
 * parent app if its IP address changes after a previously paired
 * connection stops working.
 */
export function discoverParents(
  opts: { familyCode?: string; timeoutMs?: number },
  onFound: (parent: FoundParent) => void
): Promise<void> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("message", (msg, rinfo) => {
      let parsed: AnnounceWireMessage;
      try {
        parsed = JSON.parse(msg.toString());
      } catch {
        return;
      }
      if (parsed.type !== "ezmonitor-announce") return;
      onFound({
        parentName: parsed.parentName,
        familyCode: parsed.familyCode,
        host: rinfo.address,
        port: parsed.port,
      });
    });

    socket.on("error", () => {
      finish();
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve();
    };

    socket.bind(0, () => {
      socket.setBroadcast(true);
      const request: DiscoverWireMessage = {
        type: "ezmonitor-discover",
        familyCode: opts.familyCode,
      };
      const payload = Buffer.from(JSON.stringify(request));
      socket.send(payload, DISCOVERY_PORT, "255.255.255.255");
    });

    setTimeout(finish, opts.timeoutMs ?? 3000);
  });
}

/** Non-internal IPv4 addresses of this machine, for display to the parent. */
export function listLocalIPv4Addresses(): string[] {
  const nets = networkInterfaces();
  const results: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}
