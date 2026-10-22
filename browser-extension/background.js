// background.js — shared between Chrome, Edge, and Firefox (loaded via
// manifest.chrome.json or manifest.firefox.json — see README.md in this
// folder). Tracks which domain is in the focused window's active tab, for
// how long, and reports each completed visit to the KidEmonitor Child app
// running on this same computer over its local-only ingestion endpoint.
//
// Not a general-purpose dwell-time library: it tracks exactly one thing at
// a time (the single focused-window/active-tab domain), which is the
// right granularity for "what site is this computer looking at right
// now" — it does not attempt to track every open background tab.

const api = typeof browser !== "undefined" ? browser : chrome;

const REPORT_URL = "http://127.0.0.1:41237/report-visit";
const MIN_REPORTABLE_MS = 1000; // ignore sub-second flicker (e.g. a rapid tab switch)
const LONG_VISIT_FLUSH_MINUTES = 5; // report a long-running visit incrementally, not only once it finally ends
const STORAGE_KEY = "kidemonitor_current_visit";

function detectBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "edge";
  if (typeof browser !== "undefined") return "firefox";
  return "chrome";
}
const BROWSER_NAME = detectBrowserName();

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isTrackableUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

async function getCurrent() {
  const stored = await api.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? null;
}

async function setCurrent(visit) {
  if (visit) {
    await api.storage.local.set({ [STORAGE_KEY]: visit });
  } else {
    await api.storage.local.remove(STORAGE_KEY);
  }
}

function reportVisit(visit) {
  const durationMs = visit.endedAt - visit.startedAt;
  if (durationMs < MIN_REPORTABLE_MS) return;
  fetch(REPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: visit.url,
      domain: visit.domain,
      title: visit.title || "",
      browser: BROWSER_NAME,
      startedAt: visit.startedAt,
      endedAt: visit.endedAt,
      durationMs,
    }),
  }).catch(() => {
    // The KidEmonitor Child app isn't reachable right now (not running,
    // mid-restart, or mid-reconnect). There is no retry queue here in the
    // extension — a gap just means that stretch of activity isn't
    // logged, the same as if the computer had been off.
  });
}

async function endCurrentVisit() {
  const current = await getCurrent();
  if (!current) return;
  reportVisit({ ...current, endedAt: Date.now() });
  await setCurrent(null);
}

async function startVisit(url, title) {
  if (!isTrackableUrl(url)) {
    await endCurrentVisit();
    return;
  }
  const domain = getDomain(url);
  if (!domain) {
    await endCurrentVisit();
    return;
  }
  const current = await getCurrent();
  if (current && current.url === url) return; // unchanged — keep the existing visit running
  await endCurrentVisit();
  await setCurrent({ url, domain, title: title || "", startedAt: Date.now() });
}

async function refreshActiveTab() {
  try {
    const win = await api.windows.getLastFocused({ populate: false });
    if (!win || win.focused === false) {
      await endCurrentVisit();
      return;
    }
    const tabs = await api.tabs.query({ active: true, windowId: win.id });
    const tab = tabs[0];
    if (!tab) {
      await endCurrentVisit();
      return;
    }
    await startVisit(tab.url, tab.title);
  } catch {
    await endCurrentVisit();
  }
}

api.tabs.onActivated.addListener(() => void refreshActiveTab());
api.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) void refreshActiveTab();
});
api.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) {
    void endCurrentVisit(); // focus left the browser entirely (switched to another app)
  } else {
    void refreshActiveTab();
  }
});

// Idle/lock detection: stop counting time once the user has stepped away.
if (api.idle) {
  api.idle.setDetectionInterval(60);
  api.idle.onStateChanged.addListener((state) => {
    if (state === "active") void refreshActiveTab();
    else void endCurrentVisit();
  });
}

// MV3 service workers (Chrome/Edge) get killed after ~30s idle and only
// woken for events — a plain setInterval would silently stop firing once
// that happens, so a long single visit (hours of video) needs the alarms
// API instead, which the browser guarantees will wake the worker even
// after it's been terminated. This also means a long visit shows up
// incrementally rather than as one giant entry reported only once it
// finally ends.
api.alarms.create("flush-long-visit", { periodInMinutes: LONG_VISIT_FLUSH_MINUTES });
api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "flush-long-visit") return;
  const current = await getCurrent();
  if (!current) return;
  if (Date.now() - current.startedAt >= LONG_VISIT_FLUSH_MINUTES * 60 * 1000) {
    const { url, title } = current;
    await endCurrentVisit();
    await startVisit(url, title);
  }
});

// On every fresh startup (browser launch, or the background script being
// reloaded after an update/crash), discard whatever was left in storage
// rather than trusting it — there's no reliable "last seen" timestamp to
// end it at, and reporting a guessed duration spanning a closed browser
// or a sleeping computer would be actively misleading.
(async () => {
  const current = await getCurrent();
  if (current) await setCurrent(null);
  await refreshActiveTab();
})();
