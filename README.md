# EzMonitor

A teacher/student classroom LAN toolkit for Windows and macOS. This first
milestone implements **live screen monitoring**: a teacher can view the
screens of students who are connected to the same local network, in real
time, with the student's explicit consent for each viewing session.

More instructional features (remote assistance, messaging, lock screen,
etc.) can be layered on top of the same connection later.

## How it works

There are two separate installable desktop apps, both built with
[Electron](https://www.electronjs.org/) so they run on Windows and macOS
from the same codebase:

- **`apps/teacher`** — the app a teacher runs. It hosts a small local
  WebSocket "signaling" server and a UDP broadcast responder so students on
  the same LAN can find and join the session.
- **`apps/student`** — the app each student runs. It discovers (or is
  manually pointed at) the teacher, joins the session, and — only after the
  student approves an on-screen consent prompt — shares its screen.

The actual video is **not** relayed through any server: once the two apps
have exchanged connection details, the screen stream flows directly
peer-to-peer over [WebRTC](https://webrtc.org/), which keeps latency low and
means no video ever leaves the local network. Because both apps are on the
same LAN, no STUN/TURN server is needed — the apps use direct host ICE
candidates only, so the feature works fully offline (no internet required).

```
 ┌─────────────┐   UDP broadcast (discovery)   ┌─────────────┐
 │             │ ─────────────────────────────▶ │             │
 │  Student    │   WebSocket (signaling: join,  │  Teacher    │
 │  app        │◀───consent, SDP offer/answer,──▶│  app        │
 │             │        ICE candidates)          │             │
 └─────────────┘                                 └─────────────┘
        │                                               ▲
        └──────────────  WebRTC video (screen)  ─────────┘
                     (direct peer-to-peer, LAN only)
```

### Session flow

1. Teacher launches the app. It generates a random **class code** (e.g.
   `3F2A9C`) and starts listening on a TCP port (default `41235`) and UDP
   port `41234`.
2. Student launches the app, enters their name and the class code, and
   either clicks **Scan LAN for teachers** (UDP broadcast discovery) or
   types the teacher's IP address directly.
3. The student's app connects to the teacher over WebSocket. The teacher
   sees a new card appear in the grid.
4. The teacher clicks **Start Viewing** on a student's card. This sends a
   `view-request` to that student.
5. The student sees a consent dialog ("*\<Teacher\> wants to view your
   screen*") and must click **Allow**. Only then does screen capture start.
6. Once allowed, the student's app captures the screen (via Electron's
   `desktopCapturer`), creates a `RTCPeerConnection`, and sends a WebRTC
   offer to the teacher through the signaling channel. The teacher answers,
   ICE candidates are exchanged, and the video stream appears in the
   student's card.
7. The student always sees a persistent red banner while being viewed,
   with a **Stop sharing** button they can use at any time. The teacher can
   also click **Stop Viewing** to end the stream.

## Repository layout

```
packages/shared/     Protocol types + LAN discovery (UDP) helpers, used by both apps
apps/teacher/        Teacher Electron app (main process, preload, renderer)
apps/student/        Student Electron app (main process, preload, renderer)
```

Each app's `src/main` and `src/preload` are TypeScript, compiled with `tsc`
to `dist/`. The `renderer/` folders are plain HTML/CSS/JS (no bundler) —
Chromium's renderer process loads them directly via
`<script type="module">`, which keeps the build simple.

## Getting started (development)

Requires Node.js 18+.

```bash
npm install        # installs all workspaces
npm run build       # builds packages/shared, apps/teacher, apps/student
npm run typecheck   # type-checks everything with no emit
```

Run each app in dev mode (opens an Electron window):

```bash
npm run start:teacher
npm run start:student
```

Run one instance of the teacher app and one or more instances of the
student app on machines on the same Wi-Fi/LAN segment to test the full
flow. (You can also run both on the same machine — connect the student app
to `127.0.0.1`.)

## Packaging installers

Each app uses [`electron-builder`](https://www.electron.build/) to produce
a native installer:

```bash
# from apps/teacher or apps/student
npm run dist:win   # produces an NSIS .exe installer under release/
npm run dist:mac   # produces a .dmg under release/
```

Cross-building for macOS requires running on a Mac (Apple's tooling isn't
available on Linux/Windows). Building the Windows installer works from
any platform electron-builder supports.

## Platform notes & permissions

- **macOS**: the student app must be granted **Screen Recording** permission
  (System Settings → Privacy & Security → Screen Recording) the first time
  it tries to capture the screen. macOS will prompt automatically, but the
  app will need to be re-launched after the user grants access.
- **Windows**: the OS may show a firewall prompt the first time the teacher
  app opens its listening port — the user must allow access on
  "Private networks" for discovery/signaling to work.
- **Firewalls/VLANs**: UDP broadcast discovery only works within the same
  broadcast domain (subnet). If a school network segments students and
  teachers into different VLANs, discovery will fail — students can still
  connect using the teacher's IP address entered manually.

## Design choices & rationale

- **WebRTC over raw frame polling**: video is efficient, hardware-accelerated
  where available, and adapts to the network — far better than shipping raw
  screenshots over a socket.
- **No cloud/relay server**: everything, including signaling, runs on the
  LAN. There's no external dependency, no account system, and no data ever
  leaves the school network for this feature.
- **Consent is required and visible**: the student always sees an explicit
  approval prompt before their screen is shared, and a persistent indicator
  (with a one-click stop) for as long as it's shared. This is both an
  ethical requirement and, in many jurisdictions, a legal one for monitoring
  software used with students' devices.
- **Class code**: a lightweight shared secret so a stray device on the same
  Wi-Fi can't blindly join a classroom session; it is not intended as strong
  security. Treat this as a same-trusted-network tool, not something to
  expose across the open internet.

## Known limitations / suggested next steps

- This development sandbox is a headless Linux container with no display,
  so the Electron GUIs could not be interactively tested here — only
  `tsc` type-checking, `npm run build`, and Node syntax validation of the
  compiled output were run. **Please test the actual click-through flow
  (discovery, consent dialog, live video) on real Windows/Mac machines**
  before relying on this.
- No authentication beyond the class code — reasonable for a single
  classroom on a trusted LAN, but should be hardened (e.g. per-student
  device pairing/allowlisting) before wider rollout.
- No reconnect/backoff logic yet if a student's Wi-Fi drops mid-session.
- No support yet for a teacher viewing many students' screens at once in a
  low-bandwidth "thumbnail wall" mode — currently each viewed stream is
  full quality; watching many students simultaneously will use meaningful
  bandwidth and CPU.
- Auto-update, code signing/notarization, and CI build pipelines for the
  installers are not yet set up.
