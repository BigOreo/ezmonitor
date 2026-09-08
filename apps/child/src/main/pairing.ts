import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * A device pairing is stored once, on disk, so the child app can
 * automatically reconnect to the same parent on every future launch
 * without asking again — this mirrors how ordinary parental-control apps
 * (Bark, Qustodio, Family Link, ...) work once a household device is set
 * up, rather than re-prompting for a code every session.
 */
export interface PairingInfo {
  host: string;
  port: number;
  familyCode: string;
  childName: string;
  childId: string;
  parentName?: string;
}

function pairingFilePath(): string {
  return path.join(app.getPath("userData"), "pairing.json");
}

export function loadPairing(): PairingInfo | null {
  try {
    const raw = fs.readFileSync(pairingFilePath(), "utf8");
    const data = JSON.parse(raw) as PairingInfo;
    if (data && typeof data.host === "string" && typeof data.familyCode === "string") {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePairing(info: PairingInfo): void {
  fs.writeFileSync(pairingFilePath(), JSON.stringify(info, null, 2), "utf8");
}

export function clearPairing(): void {
  try {
    fs.unlinkSync(pairingFilePath());
  } catch {
    // nothing to remove
  }
}
