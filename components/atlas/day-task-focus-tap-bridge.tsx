"use client";

import { useEffect } from "react";

export default function DayTaskFocusTapBridge() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const summary = target.closest(".atlas-day-task-card.atlas-journal-task-row > summary");
      if (!summary) return;
      const details = summary.parentElement;
      if (!(details instanceof HTMLDetailsElement)) return;
      const link = details.querySelector<HTMLAnchorElement>(".atlas-journal-task-detail > a");
      if (!link || !link.pathname.startsWith("/task-focus/")) return;
      event.preventDefault();
      window.location.href = link.href;
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
