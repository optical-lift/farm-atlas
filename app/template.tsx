"use client";

import { type ReactNode, useEffect } from "react";

const ROUTE_KEYS: Record<string, string> = {
  plant: "plant",
  weed: "weed",
  mow: "mow",
  seed: "seed",
  harvest: "harvest",
  water: "water",
  venue: "venue",
};

type Card = {
  task_id: string;
  title: string;
  task_type?: string;
  status: string;
  due_date: string | null;
  unlock_text?: string | null;
  zone_label?: string | null;
  priority?: string;
  metadata?: Record<string, unknown> | null;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function routeFromCard(card: Element) {
  const label = card.querySelector("strong")?.textContent?.trim().toLowerCase() ?? "";
  const small = card.querySelector("small")?.textContent?.trim().toLowerCase() ?? "";
  const text = `${label} ${small}`;
  if (text.includes("build")) return "build";
  for (const [word, route] of Object.entries(ROUTE_KEYS)) {
    if (text.includes(word)) return route;
  }
  return null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function meta(card: Card, key: string) {
  return card.metadata?.[key];
}

function subject(card: Card) {
  return text(meta(card, "collection_label")) || text(meta(card, "display_subject")) || card.title.split("—").slice(1).join("—").trim() || card.title;
}

function zone(card: Card) {
  const explicit = text(meta(card, "collection_zone"));
  if (explicit) return explicit;
  return text(meta(card, "display_detail")) || card.unlock_text || card.zone_label || "Elm Farm";
}

function route(card: Card) {
  const explicit = text(meta(card, "work_route"));
  if (explicit) return explicit;
  const joined = `${card.task_type ?? ""} ${card.title} ${text(meta(card, "work_rhythm"))} ${text(meta(card, "display_action"))}`.toLowerCase();
  if (joined.includes("water")) return "Water";
  if (joined.includes("mow")) return "Mow";
  if (joined.includes("weed")) return "Weed";
  if (joined.includes("seed") || joined.includes("sow")) return "Seed";
  if (joined.includes("harvest") || joined.includes("garlic")) return "Harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string")) return "Build";
  if (joined.includes("plant") || joined.includes("transplant")) return "Plant";
  if (joined.includes("paint") || joined.includes("trim") || joined.includes("tidy")) return "Venue";
  return "Task";
}

function routeLabel(card: Card) {
  const value = route(card);
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function isMainCard(card: Card) {
  const joined = `${card.task_type ?? ""} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  const isChild = meta(card, "is_child_task") === true || meta(card, "is_child_task") === "true";
  return card.status === "open" && !isChild && !joined.includes("verify") && !joined.includes("check") && !joined.includes("confirm") && !joined.includes("germin");
}

function sortKey(card: Card) {
  const dayOrder = typeof meta(card, "day_order") === "number" ? meta(card, "day_order") : 999;
  return `${card.due_date ?? "9999-12-31"}-${priorityRank[card.priority ?? "normal"] ?? 9}-${String(dayOrder).padStart(3, "0")}-${card.title}`;
}

function detail(card: Card) {
  return stringList(meta(card, "detail_lines"))[0] || text(meta(card, "display_detail")) || card.unlock_text || "Open task";
}

async function insertFirstTaskPreviews() {
  if (window.location.pathname !== "/") return;
  const grid = document.querySelector(".atlas-home-grid");
  const hero = document.querySelector(".atlas-home-task-hero");
  if (!grid || !hero || grid.querySelector(".atlas-home-next-task-strip")) return;

  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = (await response.json()) as { taskCards?: Card[] };
  const today = todayIso();
  const cards = (data.taskCards ?? [])
    .filter(isMainCard)
    .filter((card) => !card.due_date || card.due_date <= today)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .slice(0, 2);
  if (!cards.length) return;

  const strip = document.createElement("section");
  strip.className = "atlas-home-next-task-strip";
  cards.forEach((card) => {
    const link = document.createElement("a");
    link.className = "atlas-home-next-task-card";
    link.href = `/task?taskId=${encodeURIComponent(card.task_id)}`;
    link.innerHTML = `<small>${routeLabel(card)} · ${zone(card)}</small><strong>${subject(card)}</strong><span>${detail(card)}</span><em>Open task</em>`;
    strip.appendChild(link);
  });

  hero.insertAdjacentElement("afterend", strip);
}

function syncTaskMode() {
  const isTaskPage = window.location.pathname === "/task";
  const params = new URLSearchParams(window.location.search);
  const hasRoute = Boolean(params.get("route"));
  const hasTaskId = Boolean(params.get("taskId"));
  document.body.classList.toggle("atlas-route-mode", isTaskPage && hasRoute && !hasTaskId);
  document.body.classList.toggle("atlas-task-detail-mode", isTaskPage && hasTaskId);
}

export default function RootTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const card = target.closest(".atlas-route-sheet-box");
      if (!card) return;
      const route = routeFromCard(card);
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/task?route=${encodeURIComponent(route)}`);
    }

    syncTaskMode();
    void insertFirstTaskPreviews();
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", syncTaskMode);
    return () => {
      document.body.classList.remove("atlas-route-mode", "atlas-task-detail-mode");
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", syncTaskMode);
    };
  }, []);

  return <>{children}</>;
}
