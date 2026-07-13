"use client";

import { useEffect } from "react";

type Card = {
  task_id: string;
  parent_task_id?: string | null;
  status: string;
  due_date: string | null;
  title: string;
  task_type?: string;
  metadata?: Record<string, unknown> | null;
  task_outcomes?: Array<{ outcome?: string | null }>;
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meta(card: Card, key: string) {
  return card.metadata?.[key];
}

function isChildTask(card: Card) {
  return Boolean(card.parent_task_id) || meta(card, "is_child_task") === true || meta(card, "is_child_task") === "true";
}

function isProgressTask(card: Card) {
  const joined = `${card.task_type ?? ""} ${card.title ?? ""}`.toLowerCase();
  const terminal = card.status === "archived" || card.status === "skipped" || card.status === "cancelled";
  return !terminal && !isChildTask(card) && !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin"));
}

function isDone(card: Card) {
  return card.status === "done" || text(meta(card, "checklist_status")) === "done" || card.task_outcomes?.[0]?.outcome === "done";
}

function selectedTaskId() {
  const queryId = new URLSearchParams(window.location.search).get("taskId");
  if (queryId) return queryId;
  const match = window.location.pathname.match(/^\/task-focus\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function fetchTaskCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: Card[] };
  return data.taskCards ?? [];
}

function progressLines() {
  return Array.from(document.querySelectorAll<HTMLElement>(".atlas-task-progress-hero .atlas-progress-line"));
}

function lineByLabel(label: string) {
  return progressLines().find((line) => line.querySelector("span")?.textContent?.trim().toLowerCase() === label);
}

function setProgress(line: HTMLElement | undefined, valueText: string, done: number, total: number) {
  if (!line) return;
  const value = line.querySelector<HTMLElement>("strong");
  const bar = line.querySelector<HTMLElement>(".atlas-progress-bar i");
  const width = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  if (value) value.textContent = valueText;
  if (bar) bar.style.width = `${width}%`;
}

function setDayProgress(done: number, total: number) {
  const label = total ? `${done} / ${total} tasks done` : "No tasks planned today";
  setProgress(lineByLabel("day"), label, done, total);
}

function setTaskProgress(cards: Card[]) {
  const line = lineByLabel("task");
  if (!line) return;
  const taskId = selectedTaskId();
  const children = taskId ? cards.filter((card) => card.parent_task_id === taskId && card.status !== "archived") : [];
  if (!children.length) {
    line.hidden = true;
    line.style.display = "none";
    return;
  }
  line.hidden = false;
  line.style.removeProperty("display");
  const done = children.filter(isDone).length;
  setProgress(line, `${done} / ${children.length} steps done`, done, children.length);
}

export default function TaskProgressExactDayPatch() {
  useEffect(() => {
    const isTaskRoute = window.location.pathname === "/task" || window.location.pathname.startsWith("/task-focus/");
    if (!isTaskRoute) return;

    let stopped = false;
    let timer: number | null = null;

    async function patch() {
      if (stopped) return;
      const cards = await fetchTaskCards();
      if (stopped) return;
      const today = todayIso();
      const todayCards = cards.filter(isProgressTask).filter((card) => card.due_date === today);
      setDayProgress(todayCards.filter(isDone).length, todayCards.length);
      setTaskProgress(cards);
    }

    function queuePatch() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void patch();
      }, 120);
    }

    const observer = new MutationObserver(queuePatch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    queuePatch();
    const interval = window.setInterval(() => void patch(), 600);
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
