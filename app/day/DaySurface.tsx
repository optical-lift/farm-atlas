"use client";

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";

import DayFixedTimes from "@/components/atlas/reservations/DayFixedTimes";
import { useAtlasWorkerDayProjection } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import { atlasNormalizeFarmDate } from "@/lib/atlas/farm-day";
import WorkerActivityDayLayer from "./WorkerActivityDayLayer";

function taskIdFromSummary(summary: HTMLElement) {
  const entry = summary.closest<HTMLElement>(".atlas-day-task-entry[id^='day-task-']");
  const raw = entry?.id.slice("day-task-".length) ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function taskHref(summary: HTMLElement) {
  const taskId = taskIdFromSummary(summary);
  if (!taskId) return null;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function taskSummary(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  if (target.closest(".atlas-journal-row-caret")) return null;
  return target.closest<HTMLElement>(".atlas-journal-task-row > summary");
}

export default function DaySurface({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateIso = atlasNormalizeFarmDate(searchParams.get("date"));
  const { projection, runtimeScopeKey } = useAtlasWorkerDayProjection(dateIso);
  const [activityHost, setActivityHost] = useState<HTMLElement | null>(null);
  const [fixedTimesHost, setFixedTimesHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".atlas-day-command-header");
    if (!header?.parentElement) {
      setActivityHost(null);
      setFixedTimesHost(null);
      return;
    }

    const activity = document.createElement("div");
    activity.dataset.atlasWorkerActivityHost = "true";
    header.insertAdjacentElement("afterend", activity);

    const fixed = document.createElement("div");
    fixed.dataset.atlasDayFixedTimesHost = "true";
    activity.insertAdjacentElement("afterend", fixed);

    setActivityHost(activity);
    setFixedTimesHost(fixed);
    return () => {
      setActivityHost(null);
      setFixedTimesHost(null);
      activity.remove();
      fixed.remove();
    };
  }, [dateIso]);

  function openSummary(summary: HTMLElement) {
    const href = taskHref(summary);
    if (!href) return false;
    router.push(href);
    return true;
  }

  function onClick(event: ReactMouseEvent<HTMLDivElement>) {
    const summary = taskSummary(event.target);
    if (!summary || !openSummary(summary)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const summary = taskSummary(event.target);
    if (!summary || event.target !== summary || !openSummary(summary)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      data-atlas-day-surface="true"
      data-atlas-runtime-scope={runtimeScopeKey}
      data-atlas-worker-day-revision={projection?.revision}
      onClickCapture={onClick}
      onKeyDownCapture={onKeyDown}
      style={{ display: "contents" }}
    >
      {children}
      {activityHost ? createPortal(
        <WorkerActivityDayLayer
          dateIso={dateIso}
          farmId={projection?.identity.farmId ?? null}
          membershipId={projection?.identity.membershipId ?? null}
          selfView={projection?.identity.lens === "worker_self"}
        />,
        activityHost,
      ) : null}
      {fixedTimesHost ? createPortal(<DayFixedTimes dateIso={dateIso} />, fixedTimesHost) : null}
    </div>
  );
}
