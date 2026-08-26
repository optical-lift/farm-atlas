import { atlasTaskCloseDecision } from "@/lib/atlas/task-detail-navigation-core";

export function closeAtlasTaskDetail(fallbackPath: string) {
  if (typeof window === "undefined") return;

  const decision = atlasTaskCloseDecision({
    search: window.location.search,
    referrer: document.referrer,
    origin: window.location.origin,
    fallbackPath,
  });

  if (decision.kind === "history") {
    window.history.back();
    return;
  }

  if (typeof decision.destination !== "string") {
    window.location.replace("/");
    return;
  }

  window.location.replace(decision.destination);
}
