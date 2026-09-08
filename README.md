# EzMonitor

A home-network parent/child screen monitoring tool for Windows and macOS,
built with [Electron](https://www.electronjs.org/). A parent can view what's
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

There are two separate installable desktop apps:

- **`apps/parent`** — run by the parent. It hosts a small local WebSocket
  "signaling" server and a UDP broadcast responder so a child device on the
  same home network can find and pair with it.
- **`apps/child`** — run on the child's computer. It's paired with a parent
  device **once**; after that it reconnects automatically in the background
  every time both computers are on the network, without needing the code
  re-entered.

The screen video is never relayed through any server: once the two apps
exchange connection details, video flows directly peer-to-peer over
[WebRTC](https://webrtc.org/). Because both apps are on the same LAN, no
STUN/TURN server is needed — the apps use direct host ICE candidates only,
so this works fully offline (no internet required, no cloud account, no
video ever leaves the home network).

```
 ┌─────────────┐   UDP broadcast (discovery)   ┌─────────────┐
 │             │ ─────────────────────────────▶ │             │
 │  Child      │   WebSocket (pairing, SDP      │  Parent     │
 │  app        │◀──offer/answer, ICE candidates)▶│  app        │
 │             │                                 │             │
 └─────────────┘                                 └─────────────┘
        │                                               ▲
        └──────────────  WebRTC video (screen)  ─────────┘
                     (direct peer-to-peer, LAN only)
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

## Repository layout

```
packages/shared/     Protocol types + LAN discovery (UDP) helpers, used by both apps
apps/parent/         Parent Electron app (main process, preload, renderer)
apps/child/          Child Electron app (main process, preload, renderer, tray icon asset)
```

Each app's `src/main` and `src/preload` are TypeScript, compiled with `tsc`
to `dist/`. The `renderer/` folders are plain HTML/CSS/JS (no bundler) —
Chromium's renderer process loads them directly via
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

Cross-building for macOS requires running on a Mac (Apple's tooling isn't
available on Linux/Windows). Building the Windows installer works from any
platform electron-builder supports.

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
  so the Electron GUIs could not be interactively tested here — only
  `tsc` type-checking, `npm run build`, and Node syntax validation of the
  compiled output were run. **Please test the actual pairing, background
  reconnect, and live video flow on real Windows/Mac machines** before
  relying on this.
- No way yet to reset/rotate the family code from the UI if it's ever
  shared beyond the household — currently only fixable by deleting the
  parent app's `family-code.json` from its user-data folder.
- No reconnect notification/history — the parent app doesn't currently log
  when a child device went offline/came back, just its live state.
- No support yet for viewing many child devices at once in a low-bandwidth
  "thumbnail wall" mode — each viewed stream is currently full quality.
- Auto-update, code signing/notarization, and CI build pipelines for the
  installers are not yet set up.
