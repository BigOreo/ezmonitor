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

## Publishing (unlisted — one-time manual install, no enterprise policy)

This covers getting the extension onto a parent's own Chrome, Edge, and
Firefox so they can install it manually, once, on their child's computer.
It does **not** cover forced/enterprise rollout via `ExtensionInstallForcelist`
or MDM — that's a separate, later step if it's ever needed, and needs the
extension to already be store-published first regardless.

All three stores need a **packaged ZIP** of this folder. Build one per
browser (the manifest file differs):

```sh
cd browser-extension
cp manifest.chrome.json manifest.json
zip -r ../kidemonitor-browsing-activity-chrome.zip . -x "manifest.firefox.json" "*.md"
cp manifest.firefox.json manifest.json
zip -r ../kidemonitor-browsing-activity-firefox.zip . -x "manifest.chrome.json" "*.md"
```

Zip the **contents** of the folder (so `manifest.json` sits at the zip's
root), not the folder itself. Edge reuses the Chrome zip.

You'll need a **public URL for `browser-extension/PRIVACY.md`** on all
three forms below — this repo is private, so a raw GitHub link won't be
reachable by reviewers. Published copy: https://claude.ai/artifact/HVpzU7gV4bDAWh46kyP8yk
— **open its Share menu and set it to "Anyone with the link" first**, or
reviewers will hit a sign-in wall. (Once KidEsafe has a real website,
move the policy there instead and update the three store listings.)

### Chrome Web Store — Unlisted

1. Register a developer account at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   — Google Account + a one-time **$5 registration fee**.
2. **New item** → upload `kidemonitor-browsing-activity-chrome.zip`.
3. **Store listing**: name, short description, the three icons (already
   in `icons/`), at least one screenshot (take one of the extension's
   popup/options if it has one, or of the browsing-activity view in the
   parent app/portal showing logged visits).
4. **Privacy practices** tab — required because the extension requests
   `tabs` and a host permission: justify each permission in plain English
   (e.g. "`tabs`: needed to read the active tab's URL and title so a
   parent can review their child's browsing activity"), paste the privacy
   policy URL from above, and declare the data use (single purpose:
   parental monitoring; data not sold; data not used for unrelated
   purposes).
5. **Distribution** tab → **Visibility: Unlisted** (not Public). Unlisted
   means the item has no Chrome Web Store page you can discover by
   searching — only reachable by direct link, which you share with
   yourself or anyone you want able to install it.
6. Submit for review. Chrome review for a new, permission-light extension
   is usually fast, but can still take a few days.
7. ⚠️ Chrome's Web Store has been tightening its data-disclosure review
   (reporting pointed to policy changes taking effect around August 2026,
   which would already be live by the time you submit). Re-check the
   current **Privacy practices** requirements in the dashboard at
   submission time rather than relying on this note.

### Microsoft Edge Add-ons — Hidden

1. Register at the
   [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
   — free, Microsoft account, no fee.
2. **Create new extension** → upload `kidemonitor-browsing-activity-chrome.zip`
   (same package as Chrome; Edge is Chromium-based and reads the same
   manifest).
3. Fill in the listing (name, description, icons, screenshot) and the
   privacy policy URL field.
4. **Visibility: Hidden** (Edge's equivalent of Chrome's Unlisted) — not
   discoverable in the Add-ons store, installable only via direct link.
5. Submit. Edge review has historically been quicker than Chrome's.

### Firefox Add-ons (AMO) — self-distribution / Unlisted

1. Create a free account at
   [addons.mozilla.org Developer Hub](https://addons.mozilla.org/developers/).
2. **Submit a New Add-on** → upload `kidemonitor-browsing-activity-firefox.zip`.
3. When asked how to distribute it, choose **"On your own"**
   (self-distribution), *not* "On this site" — the latter is AMO's
   public/Listed catalog, and you don't want this extension showing up in
   Firefox add-on search.
4. ⚠️ **Gotcha**: this choice is easy to get wrong. The upload flow (and
   the `web-ext` CLI, if used instead) can default to or remember a
   previous "Listed" setting from an earlier submission. Explicitly check
   the distribution/channel setting on *every* submission before
   finalizing — don't assume it carried over correctly.
5. Firefox still **signs** the add-on even for self-distribution (required
   on the Release channel) — AMO does this automatically as part of the
   submission and hands back a signed `.xpi` you download and distribute
   yourself (e.g. send the parent the `.xpi` file directly, or host it at
   a URL you control). It is not installed via the Firefox Add-ons site
   the way a Listed extension is.
6. Add the privacy policy URL in the listing metadata even for
   self-distribution — it's still asked for and still worth having on
   record.
7. Give the parent the resulting `.xpi` and have them open it in Firefox
   (or go to `about:addons` → gear icon → **Install Add-on From File**) to
   install permanently — this replaces the temporary
   `about:debugging` load used for dev testing above.

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
