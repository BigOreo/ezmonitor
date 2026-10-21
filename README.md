# KidEmonitor

Part of the **KidEsafe** family of products, alongside KidEsafe and
KidECamper. KidEmonitor is a home-network parent/child screen monitoring
tool for Windows and macOS, built with
[Electron](https://www.electronjs.org/). A parent can view what's
happening on their child's computer in real time, from their own computer,
as long as both are on the same home network (Wi-Fi/LAN).

This is intended for parents monitoring devices **they own**, used by their
own **minor children**, on their own home network — not for monitoring other
adults, employees, or devices you don't own. Monitoring laws vary by
jurisdiction; if you're not sure the intended use is covered by your local
parental-rights rules, check before deploying this.

## Design principle: visible, not hidden

Regardless of who's using it, this app is built to **never hide its own
existence** from the person whose screen it can see:

- The child app is a normal, visibly installed application — it shows up in
  the Start Menu / Applications folder, Task Manager / Activity Monitor,
  and the list of installed programs, under its real name and icon.
- It does not disguise its process name, block its own uninstallation, or
  evade antivirus/security tooling.
- While it runs in the background (see below), it always shows a tray /
  menu-bar icon that a user can click to open it and see exactly what it's
  paired to and doing.

What it *doesn't* do is interrupt the child with a pop-up every time the
parent looks — see "Why no per-view consent prompt?" below for the
reasoning. This is the same tradeoff made by mainstream parental-control
products (Bark, Qustodio, Net Nanny, Microsoft Family Safety); it is not the
same thing as spyware/stalkerware, which is built specifically to conceal
its own presence from the device's user. If you want the child to always
know when they're actively being viewed, pair that with a household
conversation about it — the technical design here supports transparency
about the software either way, but doesn't force a live "watching now"
banner on every check-in.

## How it works

There are two installable desktop apps, plus a browser-based alternative
to the parent app that needs no install at all:

- **`apps/parent`** — run by the parent. It hosts a small local WebSocket
  "signaling" server, a UDP broadcast responder so a child device on the
  same home network can find and pair with it, and the **browser portal**
  — a small web page it serves on the same port, so any browser on the
  same Wi-Fi (a phone, a tablet, another computer) can view paired
  children's screens without installing anything.
- **`apps/child`** — run on the child's computer. It's paired with a parent
  device **once**; after that it reconnects automatically in the background
  every time both computers are on the network, without needing the code
  re-entered.

The screen video is never relayed through any server: once two sides
exchange connection details, video flows directly peer-to-peer over
[WebRTC](https://webrtc.org/). Because everything stays on the same LAN,
no STUN/TURN server is needed — connections use direct host ICE
candidates only, so this works fully offline (no internet required, no
cloud account, no video ever leaves the home network). A child device can
be watched by more than one viewer at once — the parent app's own window
and any number of browser portal tabs — each gets its own independent
peer-to-peer connection from a single shared screen capture.

```
 ┌─────────────┐   UDP broadcast (discovery)   ┌─────────────┐    serves      ┌──────────────┐
 │             │ ─────────────────────────────▶ │             │ ─────────────▶ │  Any browser │
 │  Child      │   WebSocket (pairing, SDP      │  Parent     │   portal page  │  on the LAN  │
 │  app        │◀──offer/answer, ICE candidates)▶│  app        │◀───WebSocket──▶│  (no install)│
 │             │                                 │             │   (same port)  │              │
 └─────────────┘                                 └─────────────┘                └──────────────┘
        │                                               ▲                              ▲
        │                 WebRTC video (screen)         │                              │
        └───────────────────────────────────────────────┴── direct peer-to-peer, LAN ──┘
```

### Pairing & session flow

1. Parent launches the app. It generates a **family code** (e.g. `3F2A9C`)
   the first time it's ever run, and reuses that same code on every future
   launch — it's saved to disk. It listens on a TCP port (default `41235`)
   and UDP port `41234`.
2. On the child's computer, the family code and either a LAN scan result or
   the parent's IP address are entered **once**, into the child app's setup
   screen, to pair it.
3. Once paired, the child app remembers the pairing (in a local config
   file) and connects automatically — on every future launch, and any time
   the connection drops — with no further action needed on the child's
   computer. If the parent computer's IP address changes (e.g. a new DHCP
   lease), the child app re-runs LAN discovery using the stored family code
   to relocate it.
4. The child app runs in the background (tray/menu-bar icon) so it's
   reachable at any time, and can optionally launch automatically at login
   (toggle in its window, on by default once paired).
5. From the parent app's grid of paired devices, clicking **Start Viewing**
   sends a request to that device, which immediately starts streaming its
   screen (via Electron's `desktopCapturer` + WebRTC) — no interactive
   prompt on the child's side. **Stop Viewing** ends the stream.

### Why no per-view consent prompt?

The original version of this project (built for a teacher/classroom
use case) required the student to click "Allow" every time a teacher wanted
to view their screen — appropriate for a peer/institutional relationship
without ownership authority over the device. A parent monitoring their own
child on a device they own doesn't need the child's moment-to-moment
permission to do so, and requiring a click-through would just let the child
block monitoring, defeating the point. The `apps/child` renderer
(`renderer.js`) still contains a `consent-response` message purely to tell
the parent app whether streaming actually started (e.g. it fails if screen
recording permission wasn't granted) — it is not a permission gate.

### Viewing from a browser (the browser portal)

The parent app's signaling server also answers plain HTTP requests on the
same port, serving a small static page (`apps/parent/browser-viewer/`).
Open `http://<this computer's LAN address>:41235` (shown in the parent
app's header, with a **Copy link** button) from any browser on the same
Wi-Fi/LAN — a phone, a tablet, another computer — enter the family code
once, and it shows the same live grid of paired children with the same
Start/Stop Viewing controls, no install required. The browser tab gets its
own independent WebRTC connection to the child device (same LAN-only, no
STUN/TURN model as everything else here); it doesn't share or depend on
the parent app's own view, so you can have the desktop app and several
browser tabs all watching (or not watching) independently.

Under the hood this needed the signaling protocol to support more than
one simultaneous viewer per child (see the comment at the top of
`packages/shared/src/protocol.ts`): every per-session message carries
either a `viewerId` (heading to a child, which may be serving several
viewers) or a `childId` (heading to a viewer, which may be watching
several children) so the server can route correctly; the parent app's own
window is just a fixed viewer id (`"local"`) under the same mechanism. The
child device still only captures its screen once no matter how many
viewers are watching — each gets its own `RTCPeerConnection` fed from that
one capture, and the capture stops automatically once the last viewer
disconnects.

Browser viewer sessions are authenticated by the family code exactly like
child devices, including being kicked immediately if the parent resets
the code (see below) — the only difference is a browser session doesn't
persist across a page reload (it's a live view, not a managed pairing), so
reopening the portal just asks for the code again (remembered in that
browser's local storage for convenience, not synced anywhere).

### Resetting the family code

If the family code is ever shared or leaked beyond the household, the
parent app has a **Reset family code** button (top of its window) that
generates and persists a brand new one:

- Any child device connected at that moment is told it's been disconnected
  and immediately kicked — the parent doesn't have to guess who's currently
  online.
- Any paired device that's offline right now (old code stored locally) is
  rejected with a clear "please pair again" message the next time it tries
  to reconnect — it won't spin forever silently retrying with an
  invalidated code, and won't be able to find the parent via LAN discovery
  either, since the parent only answers discovery requests carrying its
  *current* code.
- Re-pairing after a reset is the same one-time setup flow as the first
  pairing.

## Repository layout

```
packages/shared/           Protocol types + LAN discovery (UDP) helpers, used by both apps
apps/parent/                Parent Electron app (main process, preload, renderer)
apps/parent/browser-viewer/ The browser portal's static page, served by the parent app's own HTTP server
apps/child/                 Child Electron app (main process, preload, renderer, tray icon asset)
```

Each app's `src/main` and `src/preload` are TypeScript, compiled with `tsc`
to `dist/`. The `renderer/` and `browser-viewer/` folders are plain
HTML/CSS/JS (no bundler) — Chromium's renderer process (and, for
`browser-viewer/`, any browser) loads them directly via
`<script type="module">`, which keeps the build simple.

## Getting started (development)

Requires Node.js 18+.

```bash
npm install        # installs all workspaces
npm run build       # builds packages/shared, apps/parent, apps/child
npm run typecheck   # type-checks everything with no emit
```

Run each app in dev mode (opens an Electron window):

```bash
npm run start:parent
npm run start:child
```

Run one instance of the parent app and one instance of the child app on
machines on the same Wi-Fi/LAN segment to test the full flow. (You can also
run both on the same machine — pair the child app to `127.0.0.1`.)

## Packaging installers

Each app uses [`electron-builder`](https://www.electron.build/) to produce
a native installer:

```bash
# from apps/parent or apps/child
npm run dist:win   # produces an NSIS .exe installer under release/
npm run dist:mac   # produces a .dmg under release/
```

Cross-building a real `.dmg` requires running on a Mac — DMG creation
depends on macOS's own `hdiutil`, which doesn't exist elsewhere, and this
is a hard limitation of electron-builder itself, not a config issue. The
Windows NSIS installer, on the other hand, *can* be cross-built from Linux
(what this repo's CI/dev sandbox actually does), provided Wine is
installed for both architectures:

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update
sudo apt-get install -y wine wine64 wine32:i386
```

For a quick way to test on macOS without a Mac available to build on, an
unsigned `.app` can still be produced on Linux as a zip (skips DMG
packaging and code signing entirely):

```bash
npx electron-builder --mac zip --x64     # Intel Macs
npx electron-builder --mac zip --arm64   # Apple Silicon Macs
```

Unzip it and right-click → Open the first time (macOS Gatekeeper blocks an
unsigned/unnotarized app by default on a plain double-click) — this is
expected for any unsigned build, not specific to this project.

Two package.json `build` settings matter a lot in this npm-workspaces
monorepo and are easy to regress:

- `npmRebuild: false` — without it, electron-builder's packaging step runs
  an install/prune pass scoped to the single app being built, which (in
  this workspace layout) prunes the **shared root `node_modules`** down to
  almost nothing, breaking every other workspace. If a build ever seems to
  "eat" `node_modules`, this is why — run `npm install` at the repo root
  to recover, and don't remove this setting.
- `win.signAndEditExecutable: false` — without it, electron-builder tries
  to inject the `.exe`'s icon/version resources via a Windows tool run
  through Wine, which needs a full 32-bit Wine prefix and otherwise fails
  the whole build with "wine is required".

## Platform notes & permissions

- **macOS**: the child app must be granted **Screen Recording** permission
  (System Settings → Privacy & Security → Screen Recording) the first time
  it tries to capture the screen. macOS prompts automatically, but the app
  needs to be re-launched after permission is granted. This system prompt
  cannot be bypassed or hidden — it's macOS's own security dialog, not
  something this app controls.
- **Windows**: the OS may show a firewall prompt the first time the parent
  app opens its listening port — allow access on "Private networks" for
  discovery/pairing to work.
- **Firewalls/VLANs**: UDP broadcast discovery only works within the same
  subnet. If a router segments devices into different networks (e.g. a
  guest Wi-Fi band), discovery will fail — the child app can still be
  paired using the parent's IP address entered manually.

## Known limitations / suggested next steps

- This development sandbox is a headless Linux container with no display,
  so the Electron GUIs and the browser portal's actual in-browser WebRTC
  flow could not be interactively tested here — only `tsc` type-checking,
  `npm run build`, Node syntax validation of the compiled output, and (for
  the signaling server's new multi-viewer routing specifically) a
  standalone Node script exercising the real WebSocket/HTTP server
  end-to-end were run. **Please test the actual pairing, background
  reconnect, browser portal, and live video flow on real Windows/Mac
  machines** before relying on this.
- No reconnect notification/history — the parent app doesn't currently log
  when a child device went offline/came back, just its live state.
- No support yet for viewing many child devices at once in a low-bandwidth
  "thumbnail wall" mode — each viewed stream is currently full quality,
  and that's multiplied per viewer (desktop app + each open browser tab)
  since every viewer gets its own independent peer connection.
- Auto-update and code signing/notarization for the installers are not
  yet set up (CI build pipelines for Windows/macOS installers are, under
  `.github/workflows/`).
