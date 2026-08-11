"use client";

import { useEffect } from "react";

function taskIdFromSummary(summary: HTMLElement) {
  const entry = summary.closest<HTMLElement>(".atlas-day-task-entry[id^='day-task-']");
  const raw = entry?.id.slice("day-task-".length) ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function openTask(summary: HTMLElement) {
  const taskId = taskIdFromSummary(summary);
  if (!taskId) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

export default function DayTaskOpenBridge() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".atlas-journal-row-caret")) return;
      const summary = target.closest<HTMLElement>(".atlas-journal-task-row > summary");
      if (!summary) return;
      if (!openTask(summary)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".atlas-journal-row-caret")) return;
      const summary = target.closest<HTMLElement>(".atlas-journal-task-row > summary");
      if (!summary || target !== summary) return;
      if (!openTask(summary)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
