"use client";

import { useEffect } from "react";

type Card = {
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
  return meta(card, "is_child_task") === true || meta(card, "is_child_task") === "true";
}

function isProgressTask(card: Card) {
  const joined = `${card.task_type ?? ""} ${card.title ?? ""}`.toLowerCase();
  return card.status !== "archived" && !isChildTask(card) && !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin"));
}

function isDone(card: Card) {
  return card.status === "done" || text(meta(card, "checklist_status")) === "done" || card.task_outcomes?.[0]?.outcome === "done";
}

async function fetchTaskCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: Card[] };
  return data.taskCards ?? [];
}

function setDayProgress(done: number, total: number) {
  const lines = Array.from(document.querySelectorAll<HTMLElement>(".atlas-task-progress-hero .atlas-progress-line"));
  const dayLine = lines.find((line) => line.querySelector("span")?.textContent?.trim().toLowerCase() === "day");
  if (!dayLine) return false;

  const value = dayLine.querySelector<HTMLElement>("strong");
  const bar = dayLine.querySelector<HTMLElement>(".atlas-progress-bar i");
  const label = total ? `${done} / ${total} tasks done` : "Complete";
  const width = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 100;

  if (value) value.textContent = label;
  if (bar) bar.style.width = `${width}%`;
  return true;
}

export default function TaskProgressExactDayPatch() {
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function patch() {
      if (stopped || window.location.pathname !== "/task") return;
      const today = todayIso();
      const cards = (await fetchTaskCards()).filter(isProgressTask).filter((card) => card.due_date === today);
      if (stopped) return;
      setDayProgress(cards.filter(isDone).length, cards.length);
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
