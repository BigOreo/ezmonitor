import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

/** UDP port used for LAN auto-discovery broadcasts (not the signaling port). */
export const DISCOVERY_PORT = 41234;
/** Default TCP port for the teacher's WebSocket signaling server. */
export const DEFAULT_SIGNALING_PORT = 41235;

interface DiscoverWireMessage {
  type: "ezmonitor-discover";
  classCode?: string;
}

interface AnnounceWireMessage {
  type: "ezmonitor-announce";
  classCode: string;
  teacherName: string;
  port: number;
}

export interface FoundTeacher {
  teacherName: string;
  classCode: string;
  host: string;
  port: number;
}

export interface TeacherAnnouncer {
  stop(): void;
}

/**
 * Runs on the teacher app. Listens for discovery broadcasts from students
 * on the LAN and replies directly (unicast) with connection details.
 */
export function startTeacherAnnouncer(opts: {
  classCode: string;
  teacherName: string;
  port: number;
}): TeacherAnnouncer {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    let parsed: DiscoverWireMessage;
    try {
      parsed = JSON.parse(msg.toString());
    } catch {
      return;
    }
    if (parsed.type !== "ezmonitor-discover") return;
    if (parsed.classCode && parsed.classCode !== opts.classCode) return;

    const announce: AnnounceWireMessage = {
      type: "ezmonitor-announce",
      classCode: opts.classCode,
      teacherName: opts.teacherName,
      port: opts.port,
    };
    socket.send(JSON.stringify(announce), rinfo.port, rinfo.address);
  });

  socket.on("error", () => {
    // Discovery is a convenience feature; a bind/socket error here should
    // not crash the app. Students can still connect via manual IP entry.
  });

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
  });

  return {
    stop: () => socket.close(),
  };
}

/**
 * Runs on the student app. Broadcasts a discovery request on the LAN and
 * collects announcements from any teacher apps that respond within the
 * timeout window.
 */
export function discoverTeachers(
  opts: { classCode?: string; timeoutMs?: number },
  onFound: (teacher: FoundTeacher) => void
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
        teacherName: parsed.teacherName,
        classCode: parsed.classCode,
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
        classCode: opts.classCode,
      };
      const payload = Buffer.from(JSON.stringify(request));
      socket.send(payload, DISCOVERY_PORT, "255.255.255.255");
    });

    setTimeout(finish, opts.timeoutMs ?? 3000);
  });
}

/** Non-internal IPv4 addresses of this machine, for display to the teacher. */
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
