"use client";

import { type ReactNode, useEffect } from "react";

const ROUTE_KEYS: Record<string, string> = {
  plant: "plant",
  weed: "weed",
  mow: "mow",
  seed: "seed",
  harvest: "harvest",
  water: "water",
  venue: "venue",
};

function routeFromCard(card: Element) {
  const label = card.querySelector("strong")?.textContent?.trim().toLowerCase() ?? "";
  const small = card.querySelector("small")?.textContent?.trim().toLowerCase() ?? "";
  const text = `${label} ${small}`;
  if (text.includes("build")) return "build";
  for (const [word, route] of Object.entries(ROUTE_KEYS)) {
    if (text.includes(word)) return route;
  }
  return null;
}

function syncTaskMode() {
  const isTaskPage = window.location.pathname === "/task";
  const params = new URLSearchParams(window.location.search);
  const hasRoute = Boolean(params.get("route"));
  const hasTaskId = Boolean(params.get("taskId"));
  document.body.classList.toggle("atlas-route-mode", isTaskPage && hasRoute && !hasTaskId);
  document.body.classList.toggle("atlas-task-detail-mode", isTaskPage && hasTaskId);
}

export default function RootTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const card = target.closest(".atlas-route-sheet-box");
      if (!card) return;
      const route = routeFromCard(card);
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/task?route=${encodeURIComponent(route)}`);
    }

    syncTaskMode();
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", syncTaskMode);
    return () => {
      document.body.classList.remove("atlas-route-mode", "atlas-task-detail-mode");
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", syncTaskMode);
    };
  }, []);

  return <>{children}</>;
}
