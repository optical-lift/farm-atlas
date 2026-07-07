"use client";

import { useEffect } from "react";

type Card = {
  task_id: string;
  title: string;
  task_type?: string;
  status: string;
  priority?: string;
  due_date: string | null;
  unlock_text?: string | null;
  zone_label?: string | null;
  metadata?: Record<string, unknown> | null;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function html(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meta(card: Card, key: string) {
  return card.metadata?.[key];
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isChildTask(card: Card) {
  return meta(card, "is_child_task") === true || meta(card, "is_child_task") === "true";
}

function isHeroWork(card: Card) {
  const joined = `${card.task_type ?? ""} ${card.title ?? ""} ${card.unlock_text ?? ""}`.toLowerCase();
  return card.status === "open" && !isChildTask(card) && !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
}

function routeLabel(card: Card) {
  const explicit = text(meta(card, "work_route"));
  const joined = `${card.task_type ?? ""} ${card.title ?? ""} ${text(meta(card, "work_rhythm"))} ${text(meta(card, "display_action"))}`.toLowerCase();
  const route = explicit ||
    (joined.includes("water") ? "water" :
    joined.includes("mow") ? "mow" :
    joined.includes("weed") ? "weed" :
    joined.includes("seed") || joined.includes("sow") ? "seed" :
    joined.includes("harvest") || joined.includes("garlic") || joined.includes("gather") ? "harvest" :
    joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch") ? "build" :
    joined.includes("plant") || joined.includes("transplant") ? "plant" : "task");
  if (route === "build") return "Build";
  return route.charAt(0).toUpperCase() + route.slice(1).replace(/_/g, " ");
}

function subject(card: Card) {
  return text(meta(card, "collection_label")) || text(meta(card, "display_subject")) || card.title.split("—").slice(1).join("—").trim() || card.title;
}

function location(card: Card) {
  return text(meta(card, "collection_zone")) || text(meta(card, "display_detail")) || card.unlock_text || card.zone_label || "Elm Farm";
}

function detail(card: Card) {
  return stringList(meta(card, "detail_lines"))[0] || text(meta(card, "display_detail")) || card.unlock_text || "Open task";
}

function sortKey(card: Card) {
  const dayOrder = typeof meta(card, "day_order") === "number" ? meta(card, "day_order") : 999;
  return `${card.due_date ?? "9999-12-31"}-${priorityRank[card.priority ?? "normal"] ?? 9}-${String(dayOrder).padStart(3, "0")}-${card.title}`;
}

async function fetchTaskCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: Card[] };
  return data.taskCards ?? [];
}

function taskBuckets(cards: Card[]) {
  const today = todayIso();
  const open = cards.filter(isHeroWork).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const todayCards = open.filter((card) => card.due_date === today);
  const source = todayCards.length >= 4 ? todayCards : [...todayCards, ...open.filter((card) => card.due_date !== today)];
  return source.slice(0, 4);
}

function cardHtml(card: Card) {
  return `<a class="atlas-run-sheet-box atlas-route-sheet-box atlas-task-forward-box" href="/task?taskId=${encodeURIComponent(card.task_id)}" data-single-task-id="${html(card.task_id)}"><small>${html(routeLabel(card))} · ${html(location(card))}</small><strong>${html(subject(card))}</strong><span>${html(location(card))}</span><em>${html(detail(card))}</em></a>`;
}

export default function HomeTaskForwardHeroPatch() {
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function patchHero() {
      if (stopped || window.location.pathname !== "/") return;
      const grid = document.querySelector<HTMLElement>(".atlas-home-task-hero .atlas-run-sheet-grid");
      if (!grid) return;
      const cards = await fetchTaskCards();
      if (stopped) return;
      const buckets = taskBuckets(cards);
      if (!buckets.length) return;
      const signature = buckets.map((card) => card.task_id).join("|");
      if (grid.dataset.taskForwardSignature === signature) return;
      grid.dataset.taskForwardSignature = signature;
      grid.innerHTML = buckets.map(cardHtml).join("");
    }

    function queuePatch() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void patchHero();
      }, 180);
    }

    const observer = new MutationObserver(queuePatch);
    observer.observe(document.body, { childList: true, subtree: true });
    queuePatch();
    const interval = window.setInterval(() => void patchHero(), 700);
    window.setTimeout(() => window.clearInterval(interval), 7000);

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
      observer.disconnect();
    };
  }, []);

  return null;
}
