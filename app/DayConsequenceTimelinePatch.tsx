"use client";

import { useEffect } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type ConsequenceKind = "continued" | "returned" | "overdue" | "at_risk";

type Consequence = {
  kind: ConsequenceKind;
  kicker: string;
  detail: string;
};

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateIsoFromTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : centralDateIso(date);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "no date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T12:00:00Z`);
  const end = new Date(`${endIso}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataText(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isDone(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function explicitAtRisk(task: AtlasTaskCard) {
  const values = [
    task.metadata?.clock_consequence,
    task.metadata?.clock_state,
    task.metadata?.risk_state,
    task.metadata?.day_consequence,
  ];
  return values.some((value) => typeof value === "string" && value.toLowerCase() === "at_risk");
}

function taskConsequence(task: AtlasTaskCard, selectedDay: string): Consequence | null {
  if (isDone(task)) return null;

  const dueDate = task.due_date;
  const overdueDays = dueDate && dueDate < selectedDay ? daysBetween(dueDate, selectedDay) : 0;
  const latestOutcome = task.task_outcomes?.[0] ?? null;
  const latestTransition = task.task_transitions?.[0] ?? null;
  const partialCount = (task.task_outcomes ?? []).filter((event) => event.outcome === "partial").length;

  if (latestOutcome?.outcome === "partial" || latestTransition?.transition === "partial") {
    const occurredOn = dateIsoFromTimestamp(latestOutcome?.created_at ?? latestTransition?.created_at) ?? dueDate;
    const carry = overdueDays
      ? `overdue ${overdueDays}d · due ${shortDate(dueDate)}`
      : dueDate ? `original due ${shortDate(dueDate)}` : "still open";
    return {
      kind: "continued",
      kicker: `Continuing from ${shortDate(occurredOn)}`,
      detail: `Partly done${partialCount > 1 ? ` ${partialCount}×` : ""} · ${carry}`,
    };
  }

  const handoff = metadataRecord(task.metadata?.last_owner_problem_handoff);
  const returnedFromOwner = Boolean(handoff) && (
    latestOutcome?.outcome === "reopened"
    || latestTransition?.transition === "checklist_open"
    || latestTransition?.work_class === "owner_resolution"
  );
  if (returnedFromOwner) {
    const response = metadataText(handoff, "owner_response");
    const carry = overdueDays
      ? `overdue ${overdueDays}d · due ${shortDate(dueDate)}`
      : dueDate ? `original due ${shortDate(dueDate)}` : "returned open";
    return {
      kind: "returned",
      kicker: "Returned from Owner",
      detail: `${response ? "Owner response recorded" : "Problem resolved"} · ${carry}`,
    };
  }

  if (explicitAtRisk(task)) {
    return {
      kind: "at_risk",
      kicker: "At risk",
      detail: overdueDays ? `Overdue ${overdueDays}d · due ${shortDate(dueDate)}` : `Due ${shortDate(dueDate)}`,
    };
  }

  if (overdueDays) {
    return {
      kind: "overdue",
      kicker: "Carry forward",
      detail: `Overdue ${overdueDays}d · due ${shortDate(dueDate)}`,
    };
  }

  return null;
}

function taskIdFromCard(card: HTMLElement) {
  const link = card instanceof HTMLAnchorElement
    ? card
    : card.querySelector<HTMLAnchorElement>('a[href*="/task-focus/"]');
  const match = link?.getAttribute("href")?.match(/\/task-focus\/([^?/#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function contentRoot(card: HTMLElement) {
  return card instanceof HTMLDetailsElement
    ? card.querySelector<HTMLElement>(":scope > summary")
    : card;
}

function removeDecoration(card: HTMLElement) {
  delete card.dataset.atlasDayConsequence;
  card.closest<HTMLElement>(".atlas-day-task-entry")?.removeAttribute("data-atlas-day-consequence");
  const root = contentRoot(card);
  root?.querySelector(".atlas-day-consequence-kicker")?.remove();
  root?.querySelector(".atlas-day-consequence-detail")?.remove();
}

function decorateCard(card: HTMLElement, consequence: Consequence | null) {
  if (!consequence) {
    removeDecoration(card);
    return;
  }

  card.dataset.atlasDayConsequence = consequence.kind;
  card.closest<HTMLElement>(".atlas-day-task-entry")?.setAttribute("data-atlas-day-consequence", consequence.kind);
  const root = contentRoot(card);
  if (!root) return;

  let kicker = root.querySelector<HTMLElement>(".atlas-day-consequence-kicker");
  if (!kicker) {
    kicker = document.createElement("small");
    kicker.className = "atlas-day-consequence-kicker";
    const title = root.querySelector(":scope > strong");
    root.insertBefore(kicker, title ?? root.firstChild);
  }
  if (kicker.textContent !== consequence.kicker) kicker.textContent = consequence.kicker;

  let detail = root.querySelector<HTMLElement>(".atlas-day-consequence-detail");
  if (!detail) {
    detail = document.createElement("span");
    detail.className = "atlas-day-consequence-detail";
    const title = root.querySelector(":scope > strong");
    title?.insertAdjacentElement("afterend", detail);
  }
  if (detail.textContent !== consequence.detail) detail.textContent = consequence.detail;
}

function applyConsequences(tasks: Map<string, AtlasTaskCard>, selectedDay: string) {
  document.querySelectorAll<HTMLElement>(".atlas-day-task-card").forEach((card) => {
    const taskId = taskIdFromCard(card);
    if (!taskId) return;
    decorateCard(card, taskConsequence(tasks.get(taskId) as AtlasTaskCard, selectedDay));
  });
}

export default function DayConsequenceTimelinePatch() {
  useEffect(() => {
    if (window.location.pathname !== "/day") return;

    const params = new URLSearchParams(window.location.search);
    const selectedDay = params.get("date") || centralDateIso();
    let cancelled = false;
    let frame = 0;
    let taskMap = new Map<string, AtlasTaskCard>();

    function scheduleApply() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!cancelled) applyConsequences(taskMap, selectedDay);
      });
    }

    void fetchAtlasTaskCards({ viewerScoped: true, dueThrough: selectedDay, doneDate: selectedDay })
      .then((response) => {
        if (cancelled) return;
        taskMap = new Map((response.taskCards ?? []).map((task) => [task.task_id, task]));
        scheduleApply();
      })
      .catch(() => {
        taskMap = new Map();
      });

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
