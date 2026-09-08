// Plain-JS renderer (no bundler): loaded directly by Chromium via <script type="module">.
// window.ezmonitor is exposed by ../src/preload/index.ts via contextBridge.

/** @typedef {{id:string,name:string}} StudentInfo */

const grid = document.getElementById("student-grid");
const emptyState = document.getElementById("empty-state");
const sessionInfoEl = document.getElementById("session-info");

/** @type {Map<string, { info: StudentInfo, pc: RTCPeerConnection|null, el: HTMLElement, video: HTMLVideoElement, statusEl: HTMLElement, viewBtn: HTMLButtonElement, stopBtn: HTMLButtonElement }>} */
const students = new Map();

async function init() {
  const session = await window.ezmonitor.getSessionInfo();
  const addressList = session.addresses.length ? session.addresses.join(", ") : "no LAN address detected";
  sessionInfoEl.innerHTML =
    `Class code: <b>${escapeHtml(session.classCode)}</b> &middot; ` +
    `Teacher: <b>${escapeHtml(session.teacherName)}</b> &middot; ` +
    `Address: <b>${escapeHtml(addressList)}:${session.port}</b>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateEmptyState() {
  emptyState.style.display = students.size === 0 ? "block" : "none";
}

function addStudentCard(info) {
  const card = document.createElement("div");
  card.className = "student-card";
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

  students.set(info.id, entry);
  updateEmptyState();
}

function removeStudentCard(studentId) {
  const entry = students.get(studentId);
  if (!entry) return;
  entry.pc?.close();
  entry.el.remove();
  students.delete(studentId);
  updateEmptyState();
}

function startViewing(studentId) {
  const entry = students.get(studentId);
  if (!entry) return;
  entry.statusEl.textContent = "Requesting consent…";
  entry.statusEl.className = "status";
  entry.viewBtn.disabled = true;
  window.ezmonitor.sendToStudent(studentId, { type: "view-request" });
}

function stopViewing(studentId) {
  const entry = students.get(studentId);
  if (!entry) return;
  window.ezmonitor.sendToStudent(studentId, { type: "stop-viewing" });
  entry.pc?.close();
  entry.pc = null;
  entry.video.srcObject = null;
  entry.statusEl.textContent = "Connected";
  entry.statusEl.className = "status";
  entry.viewBtn.disabled = false;
  entry.stopBtn.disabled = true;
}

function ensurePeerConnection(studentId) {
  const entry = students.get(studentId);
  if (!entry) return null;
  if (entry.pc) return entry.pc;

  // LAN-only: host ICE candidates are sufficient, no STUN/TURN needed.
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      window.ezmonitor.sendToStudent(studentId, {
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

async function handleStudentMessage(studentId, message) {
  const entry = students.get(studentId);
  if (!entry) return;

  switch (message.type) {
    case "consent-response": {
      if (!message.granted) {
        entry.statusEl.textContent = "Student declined";
        entry.statusEl.className = "status denied";
        entry.viewBtn.disabled = false;
      }
      break;
    }
    case "offer": {
      const pc = ensurePeerConnection(studentId);
      if (!pc) return;
      await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      window.ezmonitor.sendToStudent(studentId, { type: "answer", sdp: answer.sdp });
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

window.ezmonitor.onStudentJoined((student) => addStudentCard(student));
window.ezmonitor.onStudentLeft((studentId) => removeStudentCard(studentId));
window.ezmonitor.onStudentMessage((studentId, message) => handleStudentMessage(studentId, message));

init();
