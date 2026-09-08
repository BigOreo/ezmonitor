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

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function persist(code: string): void {
  fs.writeFileSync(filePath(), JSON.stringify({ familyCode: code }, null, 2), "utf8");
}

export function loadOrCreateFamilyCode(): string {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const data = JSON.parse(raw) as { familyCode?: string };
    if (data.familyCode) return data.familyCode;
  } catch {
    // no existing code yet; generate one below
  }
  const code = generateCode();
  persist(code);
  return code;
}

/**
 * Generates and persists a brand new family code, e.g. because the old one
 * may have leaked outside the household. Callers are responsible for also
 * updating the running SignalingServer (see SignalingServer.regenerateFamilyCode)
 * so already-connected devices are disconnected and told to re-pair.
 */
export function regenerateFamilyCode(): string {
  const code = generateCode();
  persist(code);
  return code;
}
