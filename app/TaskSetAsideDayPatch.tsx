"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import { fetchAtlasTaskDayDispositions } from "@/lib/atlas/task-set-aside-client";
import type { AtlasTaskDayDisposition } from "@/lib/atlas/task-set-aside-contract";

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function consequenceLabel(row: AtlasTaskDayDisposition) {
  const returnLabel = `returns ${prettyDate(row.returnsOn)}`;
  if (row.consequence === "at_risk") return `still at risk · ${returnLabel}`;
  if (row.consequence === "overdue") return `still overdue${row.overdueDays ? ` ${row.overdueDays}d` : ""} · ${returnLabel}`;
  if (row.consequence === "due") return `still due · ${returnLabel}`;
  return returnLabel;
}

function hideSetAsideRows(taskIds: Set<string>) {
  taskIds.forEach((taskId) => {
    const encoded = encodeURIComponent(taskId);
    document.querySelectorAll<HTMLAnchorElement>(`a[href*="/task-focus/${encoded}"], a[href*="taskId=${encoded}"]`).forEach((link) => {
      const row = link.closest<HTMLElement>(
        ".atlas-day-task-entry, .atlas-journal-task-row, .atlas-day-task-card",
      );
      if (row) row.hidden = true;
    });
  });

  document.querySelectorAll<HTMLElement>(".atlas-day-overdue-group").forEach((group) => {
    const visibleRows = Array.from(group.querySelectorAll<HTMLElement>(".atlas-day-task-card, .atlas-day-task-entry"))
      .some((row) => !row.hidden);
    if (!visibleRows) group.hidden = true;
  });
}

export default function TaskSetAsideDayPatch() {
  const [rows, setRows] = useState<AtlasTaskDayDisposition[]>([]);
  const [day, setDay] = useState(atlasFarmDateIso());
  const [target, setTarget] = useState<Element | null>(null);
  const taskIds = useMemo(() => new Set(rows.map((row) => row.taskId)), [rows]);

  useEffect(() => {
    if (window.location.pathname !== "/day") return;
    const params = new URLSearchParams(window.location.search);
    const selectedDay = params.get("date") || atlasFarmDateIso();
    setDay(selectedDay);
    let cancelled = false;

    void fetchAtlasTaskDayDispositions(selectedDay)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });

    function findTarget() {
      const nextTarget = document.querySelector(".atlas-day-task-groups");
      if (nextTarget) setTarget(nextTarget);
    }

    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!taskIds.size) return;
    hideSetAsideRows(taskIds);
    const observer = new MutationObserver(() => hideSetAsideRows(taskIds));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [taskIds]);

  if (!target || !rows.length) return null;

  const returnTo = `/day?date=${encodeURIComponent(day)}&view=work_order`;
  return createPortal(
    <details className="atlas-day-set-aside-drawer">
      <summary>
        <span className="atlas-day-set-aside-mark" aria-hidden="true">→</span>
        <strong>Set aside</strong>
        <small>{rows.length}</small>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="atlas-day-set-aside-list">
        {rows.map((row) => (
          <Link
            href={`/task-focus/${encodeURIComponent(row.taskId)}?returnTo=${encodeURIComponent(returnTo)}`}
            key={row.id}
          >
            <span aria-hidden="true">○</span>
            <strong>{row.taskTitle}</strong>
            <small>{consequenceLabel(row)}{row.deferralCount > 1 ? ` · set aside ${row.deferralCount}×` : ""}</small>
          </Link>
        ))}
      </div>
    </details>,
    target,
  );
}
