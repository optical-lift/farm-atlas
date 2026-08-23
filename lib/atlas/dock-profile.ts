import type { AtlasFarmRole } from "@/lib/atlas/session";

export type AtlasDockProfile = "full" | "field_worker";
export type AtlasDockKey = "home" | "work" | "clock" | "manager" | "harvest" | "more";

const FULL_DOCK_KEYS: readonly AtlasDockKey[] = [
  "home",
  "work",
  "clock",
  "manager",
  "harvest",
  "more",
];

const FIELD_WORKER_DOCK_KEYS: readonly AtlasDockKey[] = [
  "home",
  "work",
  "clock",
  "harvest",
  "more",
];

export function atlasDockProfileForRole(role: AtlasFarmRole | null | undefined): AtlasDockProfile {
  return role === "farm_hand" ? "field_worker" : "full";
}

export function atlasDockKeys(profile: AtlasDockProfile): readonly AtlasDockKey[] {
  return profile === "field_worker" ? FIELD_WORKER_DOCK_KEYS : FULL_DOCK_KEYS;
}

export function atlasDockHas(profile: AtlasDockProfile, key: AtlasDockKey) {
  return atlasDockKeys(profile).includes(key);
}
