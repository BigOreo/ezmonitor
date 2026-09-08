// Plain-JS renderer (no bundler): loaded directly by Chromium via <script type="module">.
// window.ezmonitor is exposed by ../src/preload/index.ts via contextBridge.

const el = (id) => document.getElementById(id);

const connectPanel = el("connect-panel");
const connectedPanel = el("connected-panel");
const connectedStatus = el("connected-status");
const connectStatus = el("connect-status");
const foundList = el("found-list");
const monitoringBanner = el("monitoring-banner");
const viewerNameEl = el("viewer-name");
const consentDialog = el("consent-dialog");
const consentTeacherName = el("consent-teacher-name");

let currentPc = null;
let currentStream = null;
let teacherName = "";

el("scan-btn").addEventListener("click", scanForTeachers);
el("connect-btn").addEventListener("click", connect);
el("disconnect-btn").addEventListener("click", disconnect);
el("consent-allow-btn").addEventListener("click", () => respondToConsent(true));
el("consent-deny-btn").addEventListener("click", () => respondToConsent(false));
el("stop-share-btn").addEventListener("click", stopSharing);

async function scanForTeachers() {
  foundList.innerHTML = "<li>Scanning…</li>";
  const classCode = el("class-code").value.trim().toUpperCase();
  const teachers = await window.ezmonitor.discoverTeachers(classCode || undefined);
  foundList.innerHTML = "";
  if (teachers.length === 0) {
    foundList.innerHTML = "<li>No teachers found. Enter the IP address manually.</li>";
    return;
  }
  for (const teacher of teachers) {
    const li = document.createElement("li");
    li.textContent = `${teacher.teacherName} — ${teacher.host}:${teacher.port}`;
    li.addEventListener("click", () => {
      el("teacher-host").value = teacher.host;
      el("teacher-port").value = String(teacher.port);
      el("class-code").value = teacher.classCode;
    });
    foundList.appendChild(li);
  }
}

async function connect() {
  const studentName = el("student-name").value.trim() || "Unnamed Student";
  const classCode = el("class-code").value.trim().toUpperCase();
  const host = el("teacher-host").value.trim();
  const port = parseInt(el("teacher-port").value, 10);

  if (!classCode || !host || !port) {
    connectStatus.textContent = "Please fill in class code, teacher IP, and port.";
    return;
  }

  connectStatus.textContent = "Connecting…";
  const result = await window.ezmonitor.connect({ host, port, classCode, studentName });

  if (!result.accepted) {
    connectStatus.textContent = `Could not connect: ${result.reason ?? "unknown error"}`;
    return;
  }

  teacherName = result.teacherName ?? "the teacher";
  connectStatus.textContent = "";
  connectPanel.classList.add("hidden");
  connectedPanel.classList.remove("hidden");
  connectedStatus.textContent = `Connected to ${teacherName}. Waiting for the teacher to start viewing…`;
}

async function disconnect() {
  await stopSharing();
  await window.ezmonitor.disconnect();
  connectedPanel.classList.add("hidden");
  connectPanel.classList.remove("hidden");
  connectStatus.textContent = "Disconnected.";
}

function respondToConsent(granted) {
  consentDialog.classList.add("hidden");
  window.ezmonitor.sendSignal({ type: "consent-response", granted });
  if (granted) {
    startSharing();
  }
}

async function startSharing() {
  try {
    const sourceId = await window.ezmonitor.getScreenSource();
    if (!sourceId) {
      connectedStatus.textContent = "No screen source available to share.";
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
    window.ezmonitor.sendSignal({ type: "offer", sdp: offer.sdp });

    viewerNameEl.textContent = teacherName;
    monitoringBanner.classList.remove("hidden");
    connectedStatus.textContent = `Sharing your screen with ${teacherName}.`;
  } catch (err) {
    console.error("Failed to start sharing", err);
    connectedStatus.textContent = "Could not start screen sharing (permission denied?).";
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
  monitoringBanner.classList.add("hidden");
  if (!connectedPanel.classList.contains("hidden")) {
    connectedStatus.textContent = `Connected to ${teacherName}. Waiting for the teacher to start viewing…`;
  }
}

async function handleSignal(message) {
  switch (message.type) {
    case "view-request": {
      consentTeacherName.textContent = teacherName;
      consentDialog.classList.remove("hidden");
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
    default:
      break;
  }
}

window.ezmonitor.onSignal(handleSignal);
window.ezmonitor.onDisconnected(() => {
  stopSharing();
  connectedPanel.classList.add("hidden");
  connectPanel.classList.remove("hidden");
  connectStatus.textContent = "Disconnected from teacher.";
});
