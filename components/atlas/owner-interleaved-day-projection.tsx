"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type DayWindow = "morning" | "afternoon" | "evening";
type PlanRow = {
  id: string;
  sourceKind: string;
  sourceId: string;
  taskId?: string | null;
  title: string;
  location?: string | null;
  environment?: string | null;
  expectedActiveMinutes: number;
  dayWindow: DayWindow;
  workOrderNumber: number;
  reason?: string | null;
};
type PlanResponse = {
  ok?: boolean;
  active?: boolean;
  plan?: { realWork?: PlanRow[]; suggestions?: PlanRow[] } | null;
};
type Mount = { row: PlanRow; host: HTMLElement };

const windowRank: Record<DayWindow, number> = { morning: 0, afternoon: 1, evening: 2 };

function isPotential(row: PlanRow) {
  return row.sourceKind === "project_pull" || row.sourceKind === "floating_task";
}

function minutesLabel(value: number) {
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function clearHosts() {
  document.querySelectorAll<HTMLElement>('[data-owner-potential-day-host="true"]').forEach((host) => host.remove());
}

function findTask(timeline: HTMLElement, taskId?: string | null) {
  if (!taskId) return null;
  const target = document.getElementById(`day-task-${taskId}`);
  return target && timeline.contains(target) ? target : null;
}

function nextWindow(timeline: HTMLElement, window: DayWindow) {
  return Array.from(timeline.querySelectorAll<HTMLElement>(".atlas-day-window-marker[data-day-window]"))
    .find((marker) => {
      const key = marker.dataset.dayWindow as DayWindow | undefined;
      return key ? windowRank[key] > windowRank[window] : false;
    }) ?? null;
}

function placePotential(timeline: HTMLElement, realWork: PlanRow[], suggestions: PlanRow[]) {
  clearHosts();
  const mounts: Mount[] = [];
  const ordered = suggestions.filter(isPotential).sort((a, b) =>
    windowRank[a.dayWindow] - windowRank[b.dayWindow]
    || a.workOrderNumber - b.workOrderNumber
    || a.title.localeCompare(b.title));

  for (const row of ordered) {
    const nextReal = realWork
      .filter((task) => task.dayWindow === row.dayWindow && task.workOrderNumber > row.workOrderNumber)
      .sort((a, b) => a.workOrderNumber - b.workOrderNumber)
      .find((task) => findTask(timeline, task.taskId));
    const reference = nextReal ? findTask(timeline, nextReal.taskId) : nextWindow(timeline, row.dayWindow);
    const host = document.createElement("div");
    host.dataset.ownerPotentialDayHost = "true";
    host.dataset.ownerPotentialWindow = row.dayWindow;
    host.className = "atlas-owner-potential-day-host";
    if (reference) timeline.insertBefore(host, reference);
    else timeline.appendChild(host);
    mounts.push({ row, host });
  }
  return mounts;
}

function PotentialCard({ row }: { row: PlanRow }) {
  const detail = [
    row.expectedActiveMinutes ? minutesLabel(row.expectedActiveMinutes) : null,
    row.location,
    row.environment && row.environment !== "either" ? row.environment : null,
  ].filter(Boolean).join(" · ");
  return (
    <article className="atlas-owner-potential-day-card" data-owner-potential-day-card="true">
      <span className="atlas-owner-potential-day-node" aria-hidden="true" />
      <small>Potential · {row.sourceKind === "project_pull" ? "Finish Elm" : "Atlas work"}</small>
      <strong>{row.title}</strong>
      {detail ? <span>{detail}</span> : null}
      {row.reason ? <em>{row.reason}</em> : null}
    </article>
  );
}

export default function OwnerInterleavedDayProjection({ active }: { active: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
  const [response, setResponse] = useState<PlanResponse | null>(null);
  const [mounts, setMounts] = useState<Mount[]>([]);

  useEffect(() => {
    setResponse(null);
    if (!active || !dateIso) return;
    const controller = new AbortController();
    void fetch(`/api/atlas/worker-day-plan?date=${encodeURIComponent(dateIso)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (request) => {
      const body = await request.json() as PlanResponse;
      if (!controller.signal.aborted) setResponse(request.ok && body.ok ? body : null);
    }).catch(() => {
      if (!controller.signal.aborted) setResponse(null);
    });
    return () => controller.abort();
  }, [active, dateIso]);

  const realWork = useMemo(() => response?.plan?.realWork ?? [], [response]);
  const suggestions = useMemo(() => response?.plan?.suggestions ?? [], [response]);

  useEffect(() => {
    clearHosts();
    setMounts([]);
    if (!active || !response?.active || !suggestions.some(isPotential)) return;
    const timeline = document.querySelector<HTMLElement>(".atlas-day-work-order-group.atlas-day-timeline-group .atlas-day-mixed-timeline");
    if (!timeline) return;
    const frame = window.requestAnimationFrame(() => setMounts(placePotential(timeline, realWork, suggestions)));
    return () => {
      window.cancelAnimationFrame(frame);
      clearHosts();
    };
  }, [active, realWork, response?.active, suggestions]);

  if (!active || !response?.active) return null;
  return (
    <>
      <style>{`
        .atlas-owner-potential-day-host{position:relative;min-width:0}
        .atlas-owner-potential-day-card{position:relative;margin:2px 0 7px;padding:9px 8px 15px 10px;border:1px dashed rgba(120,124,180,.28);border-radius:13px;background:linear-gradient(90deg,rgba(174,179,212,.20),rgba(246,244,252,.44) 72%,transparent);display:grid;gap:3px;color:#444761}
        .atlas-owner-potential-day-node{position:absolute;top:15px;left:-22px;z-index:3;width:9px;height:9px;border:1.5px dashed rgba(117,121,180,.76);border-radius:999px;background:#f7f4e9;box-shadow:0 0 0 3px #f7f4e9}
        .atlas-owner-potential-day-card small{color:#777dac;font-size:8px;line-height:1;font-weight:950;letter-spacing:.12em;text-transform:uppercase}
        .atlas-owner-potential-day-card strong{font-size:14px;line-height:1.06;font-weight:950;letter-spacing:-.025em}
        .atlas-owner-potential-day-card>span:not(.atlas-owner-potential-day-node){color:#74768d;font-size:10px;line-height:1.15;font-weight:800}
        .atlas-owner-potential-day-card em{color:#76798d;font-size:9px;line-height:1.25;font-style:normal}
      `}</style>
      {mounts.map(({ row, host }) => createPortal(<PotentialCard row={row} />, host, `owner-potential:${row.id}`))}
    </>
  );
}
