"use client";

import { type ReactNode, useEffect } from "react";

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
      const activeTitle = document.querySelector(".atlas-task-page-active h1")?.textContent?.trim();
      const payload = taskId ? { taskId } : { taskTitle: activeTitle ? `%${activeTitle}%` : "" };

      fetch("/api/atlas/task-unfinished", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...payload,
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
