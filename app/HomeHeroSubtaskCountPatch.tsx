"use client";

import { useEffect } from "react";

type Card = {
  task_id: string;
  title: string;
  status: string;
  metadata?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meta(card: Card, key: string) {
  return card.metadata?.[key];
}

function isChildTask(card: Card) {
  return meta(card, "is_child_task") === true || meta(card, "is_child_task") === "true";
}

function parentTaskId(card: Card) {
  return text(meta(card, "parent_task_id"));
}

function isActiveChecklistChild(card: Card) {
  if (!isChildTask(card)) return false;
  const checklistStatus = text(meta(card, "checklist_status")).toLowerCase();
  const atlasStatus = text(meta(card, "atlas_status")).toLowerCase();
  const relevance = text(meta(card, "relevance")).toLowerCase();
  return card.status !== "archived" && checklistStatus !== "archived" && atlasStatus !== "not_relevant" && relevance !== "not_relevant";
}

function subtaskCounts(cards: Card[]) {
  const counts = new Map<string, number>();
  cards.filter(isActiveChecklistChild).forEach((card) => {
    const parentId = parentTaskId(card);
    if (!parentId) return;
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  });
  return counts;
}

async function fetchTaskCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: Card[] };
  return data.taskCards ?? [];
}

function patchHeroCards(cards: Card[]) {
  const counts = subtaskCounts(cards);
  const heroCards = Array.from(document.querySelectorAll<HTMLElement>(".atlas-task-forward-box[data-single-task-id]"));
  if (!heroCards.length) return false;

  const signature = heroCards.map((card) => {
    const taskId = card.dataset.singleTaskId ?? "";
    return `${taskId}:${counts.get(taskId) ?? 0}`;
  }).join("|");

  const grid = document.querySelector<HTMLElement>(".atlas-home-task-hero .atlas-run-sheet-grid");
  if (grid?.dataset.subtaskCountSignature === signature) return true;
  if (grid) grid.dataset.subtaskCountSignature = signature;

  heroCards.forEach((card) => {
    const taskId = card.dataset.singleTaskId ?? "";
    const count = counts.get(taskId) ?? 0;
    const small = card.querySelector<HTMLElement>("small");
    if (!small) return;
    if (!small.dataset.baseLabel) small.dataset.baseLabel = small.textContent ?? "";
    const baseLabel = small.dataset.baseLabel;
    const stepLabel = `${count} ${count === 1 ? "step" : "steps"}`;
    small.textContent = `${baseLabel} · ${stepLabel}`;
  });

  return true;
}

export default function HomeHeroSubtaskCountPatch() {
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function patch() {
      if (stopped || window.location.pathname !== "/") return;
      const cards = await fetchTaskCards();
      if (stopped) return;
      patchHeroCards(cards);
    }

    function queuePatch() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void patch();
      }, 220);
    }

    const observer = new MutationObserver(queuePatch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    queuePatch();
    const interval = window.setInterval(() => void patch(), 700);
    window.setTimeout(() => window.clearInterval(interval), 8000);

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
      observer.disconnect();
    };
  }, []);

  return null;
}
