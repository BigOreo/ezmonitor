import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

interface Settings {
  autostartConfigured?: boolean;
}

function filePath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function load(): Settings {
  try {
    return JSON.parse(fs.readFileSync(filePath(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

function save(settings: Settings): void {
  fs.writeFileSync(filePath(), JSON.stringify(settings, null, 2), "utf8");
}

/**
 * True once this app has ever configured "launch at login" on its own.
 * Used so that happens automatically only on the very first run — if the
 * user later turns it off via the tray menu, every subsequent launch
 * respects that choice instead of silently re-enabling it.
 */
export function hasConfiguredAutostartOnce(): boolean {
  return load().autostartConfigured === true;
}

export function markAutostartConfigured(): void {
  save({ ...load(), autostartConfigured: true });
}
