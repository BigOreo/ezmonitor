// Plain-JS renderer (no bundler): loaded directly by Chromium via <script type="module">.
// window.kidemonitor is exposed by ../src/preload/index.ts via contextBridge.

const el = (id) => document.getElementById(id);

const setupPanel = el("setup-panel");
const statusPanel = el("status-panel");
const pairStatus = el("pair-status");
const foundList = el("found-list");
const stateDot = el("state-dot");
const stateText = el("state-text");
const parentNameText = el("parent-name-text");
const launchAtLoginCheckbox = el("launch-at-login");

// A single capture is shared across every concurrent viewer (the parent
// app's own window, plus any number of browser portal tabs) — each gets
// its own RTCPeerConnection, but there's only ever one getDisplayMedia call.
let sharedStream = null;
/** @type {Map<string, { pc: RTCPeerConnection }>} */
const sessions = new Map();

el("scan-btn").addEventListener("click", scanForParents);
el("pair-btn").addEventListener("click", pair);
el("unpair-btn").addEventListener("click", unpair);
launchAtLoginCheckbox.addEventListener("change", () => {
  window.kidemonitor.setLaunchAtLogin(launchAtLoginCheckbox.checked);
});

async function scanForParents() {
  foundList.innerHTML = "<li>Scanning…</li>";
  const familyCode = el("family-code").value.trim().toUpperCase();
  const parents = await window.kidemonitor.discoverParents(familyCode || undefined);
  foundList.innerHTML = "";
  if (parents.length === 0) {
    foundList.innerHTML = "<li>No parent devices found. Enter the IP address manually.</li>";
    return;
  }
  for (const parent of parents) {
    const li = document.createElement("li");
    li.textContent = `${parent.parentName} — ${parent.host}:${parent.port}`;
    li.addEventListener("click", () => {
      el("parent-host").value = parent.host;
      el("parent-port").value = String(parent.port);
      el("family-code").value = parent.familyCode;
    });
    foundList.appendChild(li);
  }
}

async function pair() {
  const childName = el("child-name").value.trim() || "Unnamed Device";
  const familyCode = el("family-code").value.trim().toUpperCase();
  const host = el("parent-host").value.trim();
  const port = parseInt(el("parent-port").value, 10);

  if (!familyCode || !host || !port) {
    pairStatus.textContent = "Please fill in the family code, parent device IP, and port.";
    return;
  }

  pairStatus.textContent = "Pairing…";
  const result = await window.kidemonitor.pair({ host, port, familyCode, childName });

  if (!result.accepted) {
    pairStatus.textContent = `Could not pair: ${result.reason ?? "unknown error"}`;
    return;
  }

  pairStatus.textContent = "";
}

async function unpair() {
  stopAllSessions();
  await window.kidemonitor.unpair();
}

function renderStatus(status) {
  const paired = status.paired;
  setupPanel.classList.toggle("hidden", paired);
  statusPanel.classList.toggle("hidden", !paired);

  if (!paired && status.message) {
    pairStatus.textContent = status.message;
  }

  stateDot.className = "state-dot " + status.state;
  parentNameText.textContent = status.parentName || "your parent's device";

  switch (status.state) {
    case "connected":
      stateText.textContent = status.isSharing ? "Connected — screen currently shared" : "Connected";
      break;
    case "connecting":
      stateText.textContent = "Connecting…";
      break;
    case "reconnecting":
      stateText.textContent = "Reconnecting…";
      break;
    default:
      stateText.textContent = "Not connected";
      break;
  }
}

function sendSignal(viewerId, payload) {
  window.kidemonitor.sendSignal({ ...payload, viewerId });
}

async function ensureSharedStream() {
  if (sharedStream) return sharedStream;
  // Handled on the main-process side by session.defaultSession's
  // setDisplayMediaRequestHandler (see apps/child/src/main/index.ts),
  // which auto-picks the first screen with no UI of its own — same
  // silent-grant behavior as before, now via the non-deprecated API.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  if (!stream || stream.getVideoTracks().length === 0) return null;
  sharedStream = stream;
  return sharedStream;
}

async function startSharingFor(viewerId) {
  try {
    const stream = await ensureSharedStream();
    if (!stream) {
      sendSignal(viewerId, { type: "consent-response", granted: false, reason: "No screen source available" });
      return;
    }

    // LAN-only: host ICE candidates are sufficient, no STUN/TURN needed.
    const pc = new RTCPeerConnection({ iceServers: [] });
    sessions.set(viewerId, { pc });

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(viewerId, { type: "ice-candidate", candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        stopSessionFor(viewerId);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendSignal(viewerId, { type: "consent-response", granted: true });
    sendSignal(viewerId, { type: "offer", sdp: offer.sdp });
    window.kidemonitor.setSharingState(true);
  } catch (err) {
    console.error("Failed to start sharing", err);
    sendSignal(viewerId, {
      type: "consent-response",
      granted: false,
      reason: "Screen capture failed (check screen-recording permission)",
    });
  }
}

function stopSessionFor(viewerId) {
  const session = sessions.get(viewerId);
  if (session) {
    session.pc.close();
    sessions.delete(viewerId);
  }
  window.kidemonitor.setSharingState(sessions.size > 0);

  // Once nobody is watching, release the capture entirely rather than
  // leaving it running in the background.
  if (sessions.size === 0 && sharedStream) {
    for (const track of sharedStream.getTracks()) track.stop();
    sharedStream = null;
  }
}

function stopAllSessions() {
  for (const viewerId of [...sessions.keys()]) stopSessionFor(viewerId);
}

async function handleSignal(message) {
  const viewerId = message.viewerId;
  switch (message.type) {
    case "view-request": {
      await startSharingFor(viewerId);
      break;
    }
    case "answer": {
      const session = sessions.get(viewerId);
      if (session) {
        await session.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      }
      break;
    }
    case "ice-candidate": {
      const session = sessions.get(viewerId);
      if (session) {
        try {
          await session.pc.addIceCandidate(message.candidate);
        } catch (err) {
          console.error("Failed to add ICE candidate", err);
        }
      }
      break;
    }
    case "stop-viewing": {
      stopSessionFor(viewerId);
      break;
    }
    case "kicked": {
      // Pairing itself is handled in the main process (clears the stored
      // pairing and pushes a status update); stop every active viewing
      // session here so no stale stream keeps running.
      stopAllSessions();
      break;
    }
    default:
      break;
  }
}

async function init() {
  const [status, launchAtLogin] = await Promise.all([
    window.kidemonitor.getStatus(),
    window.kidemonitor.getLaunchAtLogin(),
  ]);
  renderStatus(status);
  launchAtLoginCheckbox.checked = launchAtLogin;
}

window.kidemonitor.onStatus(renderStatus);
window.kidemonitor.onSignal(handleSignal);

init();
