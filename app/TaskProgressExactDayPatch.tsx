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

function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

function isoFromDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compactDateRange(startIso: string, endIso: string) {
  const start = dateFromIso(startIso);
  const end = dateFromIso(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${startIso}–${endIso}`;
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = sameMonth ? end.toLocaleDateString("en-US", { day: "numeric" }) : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startLabel}–${endLabel}`;
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

function isOpenWork(card: Card) {
  const joined = `${card.task_type ?? ""} ${card.title ?? ""}`.toLowerCase();
  return card.status === "open" && !isChildTask(card) && !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
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

function countOpenWork(cards: Card[], startIso: string, endIso: string) {
  return cards.filter(isOpenWork).filter((card) => card.due_date && card.due_date >= startIso && card.due_date <= endIso).length;
}

function calendarWeekStartFor(date: Date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function calendarWeekEndFor(start: Date) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function monthRows(cards: Card[]) {
  const rows: Array<{ label: string; dateLabel: string; href: string; count: number }> = [];
  let start = calendarWeekStartFor(dateFromIso(todayIso()));

  for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
    const end = calendarWeekEndFor(start);
    const startIso = isoFromDate(start);
    const endIso = isoFromDate(end);

    rows.push({
      label: compactDateRange(startIso, endIso),
      dateLabel: "Sun–Sat",
      href: `/overview/week?date=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
      count: countOpenWork(cards, startIso, endIso),
    });

    start = new Date(end);
    start.setDate(start.getDate() + 1);
  }

  return rows;
}

function patchHomeMonthWeeks(cards: Card[]) {
  const list = document.querySelector<HTMLElement>(".atlas-home-month-week-list");
  if (!list) return false;
  const rows = monthRows(cards);
  const signature = rows.map((row) => `${row.label}:${row.dateLabel}:${row.count}`).join("|");
  if (list.dataset.workWeekSignature === signature) return true;
  list.dataset.workWeekSignature = signature;
  list.replaceChildren();
  rows.forEach((row) => {
    const link = document.createElement("a");
    link.className = "atlas-home-overview-row-link";
    link.href = row.href;

    const label = document.createElement("b");
    label.textContent = row.label;
    const date = document.createElement("small");
    date.textContent = row.dateLabel;
    const count = document.createElement("em");
    count.textContent = String(row.count);

    link.append(label, date, count);
    list.append(link);
  });
  return true;
}

export default function TaskProgressExactDayPatch() {
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function patch() {
      if (stopped) return;
      const cards = await fetchTaskCards();
      if (stopped) return;

      if (window.location.pathname === "/task") {
        const today = todayIso();
        const todayCards = cards.filter(isProgressTask).filter((card) => card.due_date === today);
        setDayProgress(todayCards.filter(isDone).length, todayCards.length);
      }

      if (window.location.pathname === "/") {
        patchHomeMonthWeeks(cards);
      }
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
