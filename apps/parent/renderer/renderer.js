// Plain-JS renderer (no bundler): loaded directly by Chromium via <script type="module">.
// window.ezmonitor is exposed by ../src/preload/index.ts via contextBridge.

/** @typedef {{id:string,name:string}} ChildInfo */

const grid = document.getElementById("child-grid");
const emptyState = document.getElementById("empty-state");
const sessionInfoEl = document.getElementById("session-info");
const regenBtn = document.getElementById("regen-btn");
const regenFeedback = document.getElementById("regen-feedback");

/** @type {Map<string, { info: ChildInfo, pc: RTCPeerConnection|null, el: HTMLElement, video: HTMLVideoElement, statusEl: HTMLElement, viewBtn: HTMLButtonElement, stopBtn: HTMLButtonElement }>} */
const children = new Map();

/** @type {{familyCode:string,parentName:string,port:number,addresses:string[]}|null} */
let session = null;

function renderSessionInfo() {
  if (!session) return;
  const addressList = session.addresses.length ? session.addresses.join(", ") : "no LAN address detected";
  sessionInfoEl.innerHTML =
    `Family code: <b>${escapeHtml(session.familyCode)}</b> &middot; ` +
    `This computer: <b>${escapeHtml(session.parentName)}</b> &middot; ` +
    `Address: <b>${escapeHtml(addressList)}:${session.port}</b>`;
}

async function init() {
  session = await window.ezmonitor.getSessionInfo();
  renderSessionInfo();
}

regenBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Reset the family code?\n\n" +
      "Any device currently connected will be disconnected immediately. Any paired device that " +
      "is offline right now will be rejected — and told to pair again — the next time it tries " +
      "to reconnect with the old code."
  );
  if (!confirmed || !session) return;

  regenBtn.disabled = true;
  const result = await window.ezmonitor.regenerateFamilyCode();
  session.familyCode = result.familyCode;
  renderSessionInfo();
  regenFeedback.textContent =
    result.kicked > 0
      ? `New code generated — ${result.kicked} connected device(s) disconnected.`
      : "New code generated.";
  regenBtn.disabled = false;
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateEmptyState() {
  emptyState.style.display = children.size === 0 ? "block" : "none";
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
  };

  entry.viewBtn.addEventListener("click", () => startViewing(info.id));
  entry.stopBtn.addEventListener("click", () => stopViewing(info.id));

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
  window.ezmonitor.sendToChild(childId, { type: "view-request" });
}

function stopViewing(childId) {
  const entry = children.get(childId);
  if (!entry) return;
  window.ezmonitor.sendToChild(childId, { type: "stop-viewing" });
  entry.pc?.close();
  entry.pc = null;
  entry.video.srcObject = null;
  entry.statusEl.textContent = "Connected";
  entry.statusEl.className = "status";
  entry.viewBtn.disabled = false;
  entry.stopBtn.disabled = true;
}

function ensurePeerConnection(childId) {
  const entry = children.get(childId);
  if (!entry) return null;
  if (entry.pc) return entry.pc;

  // LAN-only: host ICE candidates are sufficient, no STUN/TURN needed.
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      window.ezmonitor.sendToChild(childId, {
        type: "ice-candidate",
        candidate: event.candidate.toJSON(),
      });
    }
  };
  pc.ontrack = (event) => {
    entry.video.srcObject = event.streams[0];
    entry.statusEl.textContent = "Viewing";
    entry.statusEl.className = "status viewing";
    entry.stopBtn.disabled = false;
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
      window.ezmonitor.sendToChild(childId, { type: "answer", sdp: answer.sdp });
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

window.ezmonitor.onChildJoined((child) => addChildCard(child));
window.ezmonitor.onChildLeft((childId) => removeChildCard(childId));
window.ezmonitor.onChildMessage((childId, message) => handleChildMessage(childId, message));

init();
