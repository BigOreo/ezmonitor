import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { BrowsingVisit } from "@kidemonitor/shared";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface StoreShape {
  [childId: string]: BrowsingVisit[];
}

function filePath(): string {
  return path.join(app.getPath("userData"), "browsing-activity.json");
}

function load(): StoreShape {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(store: StoreShape): void {
  fs.writeFileSync(filePath(), JSON.stringify(store), "utf8");
}

function prune(visits: BrowsingVisit[]): BrowsingVisit[] {
  const cutoff = Date.now() - RETENTION_MS;
  return visits.filter((v) => v.startedAt >= cutoff);
}

/**
 * Appends a batch of visits for one child device and prunes anything
 * older than the retention window — on every write, so there's no
 * separate cleanup job to forget to run. A flat JSON file is deliberately
 * used instead of a database: this is modest-volume, single-household
 * data, and avoids pulling in a native module (electron-builder's
 * npmRebuild is disabled repo-wide specifically because native deps are
 * painful in this workspace — see the README).
 */
export function addVisits(childId: string, visits: BrowsingVisit[]): void {
  if (visits.length === 0) return;
  const store = load();
  const existing = store[childId] ?? [];
  store[childId] = prune([...existing, ...visits]).sort((a, b) => a.startedAt - b.startedAt);
  save(store);
}

/** Visits for one child, optionally limited to those starting at or after `sinceMs`. */
export function getVisits(childId: string, sinceMs?: number): BrowsingVisit[] {
  const store = load();
  const visits = prune(store[childId] ?? []);
  if (sinceMs === undefined) return visits;
  return visits.filter((v) => v.startedAt >= sinceMs);
}
