"use client";

import { type ReactNode, useEffect } from "react";

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default function TaskTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button");
      if (!button || button.textContent?.trim() !== "More") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const params = new URLSearchParams(window.location.search);
      const taskId = params.get("taskId");
      if (!taskId) return;

      fetch("/api/atlas/task-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId,
          outcome: "partial",
          note: `Unfinished — moved to ${tomorrowIso()}`,
          reason: "Unfinished",
          laneKey: "maintain",
          workKey: "unfinished",
        }),
      }).then(() => window.location.assign("/task"));
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return <>{children}</>;
}
