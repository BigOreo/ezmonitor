// Plain-JS renderer (no bundler): loaded directly by Chromium via <script type="module">.
// window.ezmonitor is exposed by ../src/preload/index.ts via contextBridge.

const el = (id) => document.getElementById(id);

const setupPanel = el("setup-panel");
const statusPanel = el("status-panel");
const pairStatus = el("pair-status");
const foundList = el("found-list");
const stateDot = el("state-dot");
const stateText = el("state-text");
const parentNameText = el("parent-name-text");
const launchAtLoginCheckbox = el("launch-at-login");

let currentPc = null;
let currentStream = null;

el("scan-btn").addEventListener("click", scanForParents);
el("pair-btn").addEventListener("click", pair);
el("unpair-btn").addEventListener("click", unpair);
launchAtLoginCheckbox.addEventListener("change", () => {
  window.ezmonitor.setLaunchAtLogin(launchAtLoginCheckbox.checked);
});

async function scanForParents() {
  foundList.innerHTML = "<li>Scanning…</li>";
  const familyCode = el("family-code").value.trim().toUpperCase();
  const parents = await window.ezmonitor.discoverParents(familyCode || undefined);
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
  const result = await window.ezmonitor.pair({ host, port, familyCode, childName });

  if (!result.accepted) {
    pairStatus.textContent = `Could not pair: ${result.reason ?? "unknown error"}`;
    return;
  }

  pairStatus.textContent = "";
}

async function unpair() {
  await stopSharing();
  await window.ezmonitor.unpair();
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

async function startSharing() {
  try {
    const sourceId = await window.ezmonitor.getScreenSource();
    if (!sourceId) {
      window.ezmonitor.sendSignal({ type: "consent-response", granted: false, reason: "No screen source available" });
      return;
    }

    currentStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      },
    });

    // LAN-only: host ICE candidates are sufficient, no STUN/TURN needed.
    const pc = new RTCPeerConnection({ iceServers: [] });
    currentPc = pc;

    for (const track of currentStream.getTracks()) {
      pc.addTrack(track, currentStream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.ezmonitor.sendSignal({ type: "ice-candidate", candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        stopSharing();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    window.ezmonitor.sendSignal({ type: "consent-response", granted: true });
    window.ezmonitor.sendSignal({ type: "offer", sdp: offer.sdp });
    window.ezmonitor.setSharingState(true);
  } catch (err) {
    console.error("Failed to start sharing", err);
    window.ezmonitor.sendSignal({
      type: "consent-response",
      granted: false,
      reason: "Screen capture failed (check screen-recording permission)",
    });
  }
}

async function stopSharing() {
  if (currentStream) {
    for (const track of currentStream.getTracks()) track.stop();
    currentStream = null;
  }
  if (currentPc) {
    currentPc.close();
    currentPc = null;
  }
  window.ezmonitor.setSharingState(false);
}

async function handleSignal(message) {
  switch (message.type) {
    case "view-request": {
      await startSharing();
      break;
    }
    case "answer": {
      if (currentPc) {
        await currentPc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      }
      break;
    }
    case "ice-candidate": {
      if (currentPc) {
        try {
          await currentPc.addIceCandidate(message.candidate);
        } catch (err) {
          console.error("Failed to add ICE candidate", err);
        }
      }
      break;
    }
    case "stop-viewing": {
      await stopSharing();
      break;
    }
    case "kicked": {
      // Handled in the main process (clears the stored pairing and pushes
      // a status update); nothing to do here beyond stopping any active
      // stream so the last frame doesn't linger.
      await stopSharing();
      break;
    }
    default:
      break;
  }
}

async function init() {
  const [status, launchAtLogin] = await Promise.all([
    window.ezmonitor.getStatus(),
    window.ezmonitor.getLaunchAtLogin(),
  ]);
  renderStatus(status);
  launchAtLoginCheckbox.checked = launchAtLogin;
}

window.ezmonitor.onStatus(renderStatus);
window.ezmonitor.onSignal(handleSignal);

init();
