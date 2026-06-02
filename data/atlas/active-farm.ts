import { DEFAULT_FARM_ID, type FarmId } from "./farms";

const ACTIVE_FARM_KEY = "atlas-active-farm-v1";

export function getActiveFarmId(): FarmId {
  if (typeof window === "undefined") return DEFAULT_FARM_ID;

  const stored = window.localStorage.getItem(ACTIVE_FARM_KEY);

  if (stored === "elm" || stored === "sd-micro") {
    return stored;
  }

  return DEFAULT_FARM_ID;
}

export function setActiveFarmId(farmId: FarmId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_FARM_KEY, farmId);
}

export function farmScopedKey(baseKey: string, farmId: FarmId) {
  return `${baseKey}:${farmId}`;
}