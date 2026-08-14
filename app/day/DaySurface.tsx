"use client";

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAtlasWorkerDayProjection } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import { atlasNormalizeFarmDate } from "@/lib/atlas/farm-day";

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
    </div>
  );
}
