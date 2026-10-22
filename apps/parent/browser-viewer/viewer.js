// Plain-JS page served directly by the parent app's HTTP server (see
// apps/parent/src/main/signalingServer.ts) — no build step, loaded by any
// browser on the same home network via <script type="module">. Mirrors
// apps/parent/renderer/renderer.js, but talks to the signaling server
// over a raw WebSocket (at /viewer) instead of through Electron's IPC
// bridge, since there's no contextBridge available in a plain browser tab.

const el = (id) => document.getElementById(id);

const codePanel = el("code-panel");
const codeStatus = el("code-status");
const connectBtn = el("connect-btn");
const familyCodeInput = el("family-code");
const connectionStatusEl = el("connection-status");
const grid = el("child-grid");
const emptyState = el("empty-state");

const STORAGE_KEY = "kidemonitor-family-code";
const RECONNECT_START_MS = 5000;
const RECONNECT_MAX_MS = 60000;

/** @type {Map<string, { info: {id:string,name:string}, pc: RTCPeerConnection|null, el: HTMLElement, video: HTMLVideoElement, statusEl: HTMLElement, viewBtn: HTMLButtonElement, stopBtn: HTMLButtonElement, fullscreenBtn: HTMLButtonElement }>} */
const children = new Map();

let ws = null;
let currentCode = null;
let reconnectDelayMs = RECONNECT_START_MS;
let reconnectTimer = null;
let pendingActivityChildId = null;

const activityModal = el("activity-modal");
const activityChildName = el("activity-child-name");
const activityBody = el("activity-body");
el("activity-close-btn").addEventListener("click", () => activityModal.classList.add("hidden"));
activityModal.addEventListener("click", (event) => {
  if (event.target === activityModal) activityModal.classList.add("hidden");
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateEmptyState() {
  emptyState.style.display = children.size === 0 ? "block" : "none";
}

function showCodePanel(message, isError) {
  codePanel.classList.remove("hidden");
  grid.classList.add("hidden");
  codeStatus.textContent = message ?? "";
  codeStatus.className = "status-text" + (isError ? " denied" : "");
  connectionStatusEl.textContent = "";
}

function showGrid() {
  codePanel.classList.add("hidden");
  grid.classList.remove("hidden");
}

function connect(code) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  currentCode = code;
  connectBtn.disabled = true;
  codeStatus.textContent = "Connecting…";
  codeStatus.className = "status-text";

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/viewer?code=${encodeURIComponent(code)}`);
  ws = socket;

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(message);
  });

  socket.addEventListener("close", () => {
    connectBtn.disabled = false;
    if (ws !== socket) return;
    for (const childId of [...children.keys()]) removeChildCard(childId);
    if (!codePanel.classList.contains("hidden")) return; // never got in; let the user retry manually
    connectionStatusEl.textContent = "Disconnected — reconnecting…";
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    connectBtn.disabled = false;
  });
}

function scheduleReconnect() {
  if (reconnectTimer || !currentCode) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(currentCode);
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
}

function handleMessage(message) {
  switch (message.type) {
    case "join-ack": {
      if (message.accepted) {
        localStorage.setItem(STORAGE_KEY, currentCode);
        reconnectDelayMs = RECONNECT_START_MS;
        connectionStatusEl.textContent = `Connected to ${message.parentName}`;
        showGrid();
      } else {
        localStorage.removeItem(STORAGE_KEY);
        showCodePanel(message.reason ?? "Could not connect", true);
      }
      break;
    }
    case "children-list": {
      for (const childId of [...children.keys()]) removeChildCard(childId);
      for (const child of message.children) addChildCard(child);
      break;
    }
    case "child-joined": {
      addChildCard(message.child);
      break;
    }
    case "child-left": {
      removeChildCard(message.childId);
      break;
    }
    case "consent-response":
    case "offer":
    case "ice-candidate": {
      handleChildMessage(message.childId, message);
      break;
    }
    case "browsing-activity-history": {
      if (message.childId === pendingActivityChildId) {
        renderActivityTable(message.visits);
      }
      break;
    }
    case "kicked": {
      localStorage.removeItem(STORAGE_KEY);
      ws?.close();
      ws = null;
      showCodePanel(message.reason ?? "Disconnected by the parent app.", true);
      break;
    }
    default:
      break;
  }
}

function sendToChild(childId, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...payload, childId }));
  }
}

function addChildCard(info) {
  const card = document.createElement("div");
  card.className = "child-card";
  card.innerHTML = `
    <video autoplay playsinline></video>
    <div class="card-header">
      <span class="name"></span>
      <span class="status">Connected</span>
    </div>
    <div class="actions">
      <button class="view-btn">Start Viewing</button>
      <button class="stop-btn secondary" disabled>Stop Viewing</button>
      <button class="fullscreen-btn secondary" disabled>Fullscreen</button>
      <button class="activity-btn secondary">Browsing Activity</button>
    </div>
  `;
  card.querySelector(".name").textContent = info.name;
  grid.appendChild(card);

  const entry = {
    info,
    pc: null,
    el: card,
    video: card.querySelector("video"),
    statusEl: card.querySelector(".status"),
    viewBtn: card.querySelector(".view-btn"),
    stopBtn: card.querySelector(".stop-btn"),
    fullscreenBtn: card.querySelector(".fullscreen-btn"),
    activityBtn: card.querySelector(".activity-btn"),
  };

  entry.viewBtn.addEventListener("click", () => startViewing(info.id));
  entry.stopBtn.addEventListener("click", () => stopViewing(info.id));
  entry.fullscreenBtn.addEventListener("click", () => toggleFullscreen(info.id));
  entry.activityBtn.addEventListener("click", () => openActivityModal(info.id, info.name));
  entry.video.addEventListener("dblclick", () => toggleFullscreen(info.id));
  entry.video.addEventListener("fullscreenchange", () => {
    entry.fullscreenBtn.textContent = document.fullscreenElement === entry.video ? "Exit Fullscreen" : "Fullscreen";
  });

  children.set(info.id, entry);
  updateEmptyState();
}

function removeChildCard(childId) {
  const entry = children.get(childId);
  if (!entry) return;
  entry.pc?.close();
  entry.el.remove();
  children.delete(childId);
  updateEmptyState();
}

function startViewing(childId) {
  const entry = children.get(childId);
  if (!entry) return;
  entry.statusEl.textContent = "Connecting…";
  entry.statusEl.className = "status";
  entry.viewBtn.disabled = true;
  sendToChild(childId, { type: "view-request" });
}

function stopViewing(childId) {
  const entry = children.get(childId);
  if (!entry) return;
  sendToChild(childId, { type: "stop-viewing" });
  entry.pc?.close();
  entry.pc = null;
  entry.video.srcObject = null;
  entry.statusEl.textContent = "Connected";
  entry.statusEl.className = "status";
  entry.viewBtn.disabled = false;
  entry.stopBtn.disabled = true;
  entry.fullscreenBtn.disabled = true;
  if (document.fullscreenElement === entry.video) {
    document.exitFullscreen();
  }
}

function toggleFullscreen(childId) {
  const entry = children.get(childId);
  if (!entry) return;
  if (document.fullscreenElement === entry.video) {
    document.exitFullscreen();
  } else {
    entry.video.requestFullscreen().catch((err) => console.error("Failed to enter fullscreen", err));
  }
}

function ensurePeerConnection(childId) {
  const entry = children.get(childId);
  if (!entry) return null;
  if (entry.pc) return entry.pc;

  // LAN-only: host ICE candidates are sufficient, no STUN/TURN needed.
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendToChild(childId, { type: "ice-candidate", candidate: event.candidate.toJSON() });
    }
  };
  pc.ontrack = (event) => {
    entry.video.srcObject = event.streams[0];
    entry.statusEl.textContent = "Viewing";
    entry.statusEl.className = "status viewing";
    entry.stopBtn.disabled = false;
    entry.fullscreenBtn.disabled = false;
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      entry.statusEl.textContent = "Connection lost";
      entry.statusEl.className = "status denied";
    }
  };

  entry.pc = pc;
  return pc;
}

async function handleChildMessage(childId, message) {
  const entry = children.get(childId);
  if (!entry) return;

  switch (message.type) {
    case "consent-response": {
      if (!message.granted) {
        entry.statusEl.textContent = message.reason ?? "Couldn't start streaming";
        entry.statusEl.className = "status denied";
        entry.viewBtn.disabled = false;
      }
      break;
    }
    case "offer": {
      const pc = ensurePeerConnection(childId);
      if (!pc) return;
      await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendToChild(childId, { type: "answer", sdp: answer.sdp });
      break;
    }
    case "ice-candidate": {
      const pc = entry.pc;
      if (pc) {
        try {
          await pc.addIceCandidate(message.candidate);
        } catch (err) {
          console.error("Failed to add ICE candidate", err);
        }
      }
      break;
    }
    default:
      break;
  }
}

connectBtn.addEventListener("click", () => {
  const code = familyCodeInput.value.trim().toUpperCase();
  if (!code) {
    codeStatus.textContent = "Please enter the family code.";
    codeStatus.className = "status-text denied";
    return;
  }
  connect(code);
});

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderActivityTable(visits) {
  if (visits.length === 0) {
    activityBody.innerHTML = '<p class="hint">No browsing activity recorded yet for this device.</p>';
    return;
  }
  const rows = [...visits]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(
      (v) => `
      <tr>
        <td>${escapeHtml(new Date(v.startedAt).toLocaleString())}</td>
        <td><span class="domain">${escapeHtml(v.domain)}</span><br><span class="title">${escapeHtml(v.title || v.url)}</span></td>
        <td>${formatDuration(v.durationMs)}</td>
        <td>${escapeHtml(v.browser)}</td>
      </tr>`
    )
    .join("");
  activityBody.innerHTML = `
    <table class="activity-table">
      <thead>
        <tr><th>When</th><th>Site</th><th>Duration</th><th>Browser</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function openActivityModal(childId, childName) {
  pendingActivityChildId = childId;
  activityChildName.textContent = childName;
  activityBody.innerHTML = '<p class="hint">Loading…</p>';
  activityModal.classList.remove("hidden");
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "get-browsing-activity", childId }));
  } else {
    activityBody.innerHTML = '<p class="hint">Not connected.</p>';
  }
}

const savedCode = localStorage.getItem(STORAGE_KEY);
if (savedCode) {
  familyCodeInput.value = savedCode;
  connect(savedCode);
} else {
  showCodePanel();
}
