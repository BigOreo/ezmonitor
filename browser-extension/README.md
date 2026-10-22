# KidEmonitor Browsing Activity extension

Reports which site is in the focused window's active tab, and for how
long, to the KidEmonitor Child app running on the same computer — which
forwards it to the parent for display. See the top-level README's
"Browsing activity" section for the full architecture and the retention
policy.

This extension covers **Chrome, Edge, and Firefox** (one `background.js`,
two manifests — Chrome and Edge share `manifest.chrome.json` since both
are Chromium-based). **Safari is not covered here** — Safari extensions
have to be built as a native macOS app extension in Xcode, which can't be
done in a sandbox without a Mac; see the top-level README for that.
`background.js` was written to minimize Safari-specific rework later
(the WebExtensions `tabs`/`windows`/`storage` APIs it uses are also
supported by Safari Web Extensions), but it hasn't been adapted or tested
there.

## Loading it for testing

This has **not** been loaded into a real browser as part of this work —
no browser is available in the sandbox this was built in. Load it
yourself and watch the browser's own extension console for errors before
trusting it.

**Chrome or Edge:**
1. Copy `manifest.chrome.json` to `manifest.json` in this folder (both
   browsers require the file to be named exactly `manifest.json` — the
   two source files here are named differently so both can live in the
   same folder without one overwriting the other).
2. Go to `chrome://extensions` (or `edge://extensions`), enable
   **Developer mode** (top right), click **Load unpacked**, and select
   this folder.
3. Open the extension's service worker console from that same page
   (click "service worker" under the loaded extension) to see any errors.

**Firefox:**
1. Copy `manifest.firefox.json` to `manifest.json` in this folder.
2. Go to `about:debugging#/runtime/this-firefox`, click **Load Temporary
   Add-on**, and select `manifest.json` in this folder.
3. This load is temporary — it's removed when Firefox restarts. A
   permanent install needs the extension signed via
   [addons.mozilla.org](https://addons.mozilla.org) (see the deployment
   note in the top-level README).

## What to check when testing

- With the KidEmonitor Child app running and paired, browse a few
  different sites, switch tabs, switch to another application and back,
  and leave the computer idle for a minute.
- In the KidEmonitor Parent app or the browser portal, open that child
  device's browsing activity view and confirm the visits, timestamps, and
  durations look right.
- Specifically check: does switching away to another app end the current
  visit's timer? Does switching back resume tracking the tab that's
  actually active now (not whatever was active before)? Does a single
  long-running page (e.g. a video site left open for 20+ minutes) show up
  as more than one entry, rather than nothing until the tab finally
  closes?
