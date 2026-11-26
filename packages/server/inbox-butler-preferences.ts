/**
 * 管家的偏好文件（~/plannotator-butler/preferences.json）：one file for both kinds of
 * authorization —
 *   - `l3`: the actions whose one-time conversational grant is remembered (launch/stop,
 *     the M2 behaviour kept until the approval tab takes them over);
 *   - `auto`: the "直接允许" switches (Phase 1: create-requirement; the approval tab owns
 *     the switch, the action path reads it).
 *
 * The file is small and written synchronously: a daemon serves one person, so a
 * read-modify-write in the same tick is enough. Always read before writing, so the two
 * writers (the action channel and the approval tab) never clobber each other.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ButlerPreferences {
  v: 1;
  l3: Record<string, { granted_at: string }>;
  /** The actions allowed without approval. Absent/false: every call needs approval. */
  auto: Record<string, boolean>;
  updated_at: string | null;
}

/** The preferences of a butler folder, normalized (a missing/unreadable file is empty). */
export function readButlerPreferences(dir: string): ButlerPreferences {
  let parsed: Partial<ButlerPreferences> | null = null;
  try {
    parsed = JSON.parse(readFileSync(join(dir, "preferences.json"), "utf8")) as Partial<ButlerPreferences>;
  } catch {
    parsed = null;
  }
  const l3 = parsed && typeof parsed.l3 === "object" && parsed.l3 !== null && !Array.isArray(parsed.l3) ? (parsed.l3 as ButlerPreferences["l3"]) : {};
  const auto = parsed && typeof parsed.auto === "object" && parsed.auto !== null && !Array.isArray(parsed.auto) ? (parsed.auto as Record<string, boolean>) : {};
  return {
    v: 1,
    l3,
    auto,
    updated_at: typeof parsed?.updated_at === "string" ? parsed.updated_at : null,
  };
}

/** Atomic write, 0600. False when the folder/file could not be written. */
export function writeButlerPreferences(dir: string, preferences: ButlerPreferences): boolean {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "preferences.json");
    const staged = `${path}.tmp`;
    writeFileSync(staged, `${JSON.stringify({ ...preferences, updated_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    renameSync(staged, path);
    return true;
  } catch {
    return false;
  }
}

/** "直接允许" for one action. */
export function butlerAuto(dir: string, action: string): boolean {
  const preferences = readButlerPreferences(dir);
  // An M2 one-time L3 grant reads as "直接允许" in the Phase 2 switch, so an owner who
  // already said yes is not asked again.
  return preferences.auto[action] === true || Object.hasOwn(preferences.l3, action);
}

/** Set one action's switch; returns the updated preferences (also when the write failed — callers can read again). */
export function setButlerAuto(dir: string, action: string, on: boolean): ButlerPreferences {
  const preferences = readButlerPreferences(dir);
  preferences.auto[action] = on;
  // Turning the switch off also drops an old M2 one-time grant, or butlerAuto would keep saying yes.
  if (!on) delete preferences.l3[action];
  writeButlerPreferences(dir, preferences);
  return preferences;
}

/** Whether the one-time L3 grant for an action is recorded. */
export function butlerL3Granted(dir: string, action: string): boolean {
  return Object.hasOwn(readButlerPreferences(dir).l3, action);
}

/** Remember the owner's one-time L3 grant for an action. */
export function grantButlerL3(dir: string, action: string): ButlerPreferences {
  const preferences = readButlerPreferences(dir);
  preferences.l3[action] = { granted_at: new Date().toISOString() };
  writeButlerPreferences(dir, preferences);
  return preferences;
}
