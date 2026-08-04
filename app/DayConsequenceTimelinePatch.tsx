"use client";

import { useEffect } from "react";

import {
  atlasDayTaskConsequence,
  type AtlasDayConsequence,
} from "@/lib/atlas/day-consequence";
import type { AtlasLivingDayPlan, AtlasLivingDayPlanResponse } from "@/lib/atlas/day-plan-contract";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type PresentationConsequence = AtlasDayConsequence;
type PlanState = "planned" | "carried" | "added" | "withheld" | null;

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

async function fetchLivingDayPlan(dateIso: string): Promise<AtlasLivingDayPlan> {
  const params = new URLSearchParams({ date: dateIso });
  const response = await fetch(`/api/atlas/living-day-plan?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = (await response.json()) as AtlasLivingDayPlanResponse;
  if (!response.ok || !data.ok || !data.plan) {
    throw new Error(data.details || data.error || "The finite Living Day plan could not be loaded.");
  }
  return data.plan;
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

function taskEntry(card: HTMLElement) {
  return card.closest<HTMLElement>(".atlas-day-task-entry") ?? card;
}

function removeConsequenceCopy(card: HTMLElement) {
  const root = contentRoot(card);
  root?.querySelector(".atlas-day-consequence-kicker")?.remove();
  root?.querySelector(".atlas-day-consequence-detail")?.remove();
}

function removeDecoration(card: HTMLElement) {
  delete card.dataset.atlasDayConsequence;
  delete card.dataset.atlasDayPlanState;
  const entry = taskEntry(card);
  entry.removeAttribute("data-atlas-day-consequence");
  entry.removeAttribute("data-atlas-day-plan-state");
  entry.style.removeProperty("order");
  removeConsequenceCopy(card);
}

function decorateCard(
  card: HTMLElement,
  consequence: PresentationConsequence | null,
  planState: PlanState,
) {
  if (!consequence && !planState) {
    removeDecoration(card);
    return;
  }

  if (consequence) card.dataset.atlasDayConsequence = consequence.kind;
  else delete card.dataset.atlasDayConsequence;
  if (planState) card.dataset.atlasDayPlanState = planState;
  else delete card.dataset.atlasDayPlanState;

  const entry = taskEntry(card);
  if (consequence) entry.dataset.atlasDayConsequence = consequence.kind;
  else entry.removeAttribute("data-atlas-day-consequence");
  if (planState) entry.dataset.atlasDayPlanState = planState;
  else entry.removeAttribute("data-atlas-day-plan-state");
  entry.style.removeProperty("order");

  const quietInMixedTimeline = Boolean(
    consequence?.kind === "overdue"
      && card.closest(".atlas-day-mixed-timeline"),
  );
  if (quietInMixedTimeline || !consequence) {
    removeConsequenceCopy(card);
    return;
  }

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

function planPresentation(
  task: AtlasTaskCard,
  selectedDay: string,
  plan: AtlasLivingDayPlan | null,
): { consequence: PresentationConsequence | null; state: PlanState } {
  const canonical = atlasDayTaskConsequence(task, selectedDay);
  if (!plan) return { consequence: canonical, state: canonical ? "carried" : null };

  if (plan.withheldFlexibleTaskIds.includes(task.task_id)) {
    return { state: "withheld", consequence: canonical };
  }
  if (plan.addedAfterPlanTaskIds.includes(task.task_id)) {
    return { state: "added", consequence: canonical };
  }
  if (plan.carriedTaskIds.includes(task.task_id)) {
    return { state: "carried", consequence: canonical };
  }
  if (plan.plannedTaskIds.includes(task.task_id)) {
    return { state: "planned", consequence: canonical };
  }
  return { state: canonical ? "carried" : null, consequence: canonical };
}

function applyPlanProgress(plan: AtlasLivingDayPlan | null) {
  if (!plan) return;
  const command = document.querySelector<HTMLElement>(".atlas-day-command-header");
  if (!command) return;

  command.dataset.dayDenominator = `${plan.resolvedCount}/${plan.denominator}`;
  command.dataset.atlasDayPlanFrozen = String(plan.frozen);

  const progress = command.querySelector<HTMLElement>('[aria-label="Day progress"]');
  const value = progress?.querySelector<HTMLElement>("header strong");
  const rail = progress?.querySelector<HTMLElement>('[role="progressbar"]');
  const fill = rail?.querySelector<HTMLElement>("span");
  const valueText = plan.denominator
    ? `${plan.resolvedCount} of ${plan.denominator} dealt with`
    : "No work in the day";
  const percent = plan.denominator
    ? Math.max(0, Math.min(100, Math.round((plan.resolvedCount / plan.denominator) * 100)))
    : 0;

  if (value && value.textContent !== valueText) value.textContent = valueText;
  if (rail) {
    rail.setAttribute("aria-valuemax", String(plan.denominator || 1));
    rail.setAttribute("aria-valuenow", String(plan.resolvedCount));
    rail.setAttribute("aria-valuetext", valueText);
  }
  if (fill && fill.style.width !== `${percent}%`) fill.style.width = `${percent}%`;

  command.querySelector(".atlas-day-plan-contract-note")?.remove();
}

function applyConsequences(
  tasks: Map<string, AtlasTaskCard>,
  selectedDay: string,
  plan: AtlasLivingDayPlan | null,
) {
  document.querySelectorAll<HTMLElement>(".atlas-day-task-card").forEach((card) => {
    const taskId = taskIdFromCard(card);
    if (!taskId) return;
    const task = tasks.get(taskId);
    if (!task) return;
    const presentation = planPresentation(task, selectedDay, plan);
    decorateCard(card, presentation.consequence, presentation.state);
  });
  applyPlanProgress(plan);
}

export default function DayConsequenceTimelinePatch() {
  useEffect(() => {
    if (window.location.pathname !== "/day") return;

    const params = new URLSearchParams(window.location.search);
    const selectedDay = params.get("date") || centralDateIso();
    let cancelled = false;
    let frame = 0;
    let taskMap = new Map<string, AtlasTaskCard>();
    let plan: AtlasLivingDayPlan | null = null;

    function scheduleApply() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!cancelled) applyConsequences(taskMap, selectedDay, plan);
      });
    }

    void Promise.allSettled([
      fetchAtlasTaskCards({ viewerScoped: true, dueThrough: selectedDay, doneDate: selectedDay }),
      fetchLivingDayPlan(selectedDay),
    ]).then(([tasksResult, planResult]) => {
      if (cancelled) return;
      if (tasksResult.status === "fulfilled") {
        taskMap = new Map((tasksResult.value.taskCards ?? []).map((task) => [task.task_id, task]));
      }
      if (planResult.status === "fulfilled") plan = planResult.value;
      scheduleApply();
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
