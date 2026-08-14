export const ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT = "atlas:worker-day-runtime-invalidate";

export function dispatchAtlasWorkerDayRuntimeInvalidation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT));
}
