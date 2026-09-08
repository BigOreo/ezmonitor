import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * The family code must stay stable across restarts of the parent app —
 * otherwise every child device that auto-reconnects using a previously
 * stored pairing would be rejected the moment the parent's computer
 * restarts and picked a new random code.
 */
function filePath(): string {
  return path.join(app.getPath("userData"), "family-code.json");
}

export function loadOrCreateFamilyCode(): string {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const data = JSON.parse(raw) as { familyCode?: string };
    if (data.familyCode) return data.familyCode;
  } catch {
    // no existing code yet; generate one below
  }
  const code = randomBytes(3).toString("hex").toUpperCase();
  fs.writeFileSync(filePath(), JSON.stringify({ familyCode: code }, null, 2), "utf8");
  return code;
}
