"use client";

import { useEffect } from "react";

type RouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";

type TaskCard = {
  task_id: string;
  title: string;
  task_type?: string;
  status: string;
  due_date: string | null;
  unlock_text?: string | null;
  zone_label?: string | null;
  metadata?: Record<string, unknown> | null;
};

const routeLabels: Record<RouteKey, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  harvest: "Harvest",
  build: "Build / Prep",
  venue: "Venue",
  water: "Water",
};

const routeOrder: RouteKey[] = ["plant", "weed", "mow", "seed", "harvest", "build", "venue", "water"];

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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function dayOnly(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function isRouteKey(value: string): value is RouteKey {
  return routeOrder.includes(value as RouteKey);
}

function isChildTask(card: TaskCard) {
  return card.metadata?.is_child_task === true || card.metadata?.is_child_task === "true";
}

function isDashboardWork(card: TaskCard) {
  const joined = `${card.task_type ?? ""} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  return card.status === "open" && !isChildTask(card) && !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
}

function subject(card: TaskCard) {
  return text(card.metadata?.collection_label) || text(card.metadata?.display_subject) || card.title.split("—").slice(1).join("—").trim() || card.title;
}

function location(card: TaskCard) {
  return text(card.metadata?.display_detail) || card.unlock_text || card.zone_label || "Elm Farm";
}

function zoneBucket(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("oak") || lower.includes("strawberry orchard")) return "Shady Oak";
  if (lower.includes("main garden") || lower.includes("straw strip")) return "Main Garden";
  if (lower.includes("field") || lower.includes("fr")) return "Field Rows";
  if (lower.includes("barn")) return "Barn Beds";
  if (lower.includes("berry") || lower.includes("bw")) return "Berry Walk";
  if (lower.includes("u-pick") || lower.includes("u pick")) return "U-Pick";
  if (lower.includes("follow me")) return "Follow Me";
  if (lower.includes("curve")) return "Curve Garden";
  if (lower.includes("lilac")) return "Lilac Haven";
  if (lower.includes("garage") || lower.includes("hydrangea")) return "Garage / House Beds";
  if (lower.includes("grow room")) return "Grow Room";
  if (lower.includes("entry") || lower.includes("billboard")) return "Entry Billboard";
  if (lower.includes("chicken")) return "Chicken Coop";
  return value;
}

function collectionZone(card: TaskCard) {
  return text(card.metadata?.collection_zone) || zoneBucket(location(card));
}

function routeForTask(card: TaskCard): RouteKey {
  const explicit = text(card.metadata?.work_route);
  if (isRouteKey(explicit)) return explicit;
  const joined = `${card.task_type ?? ""} ${card.title} ${text(card.metadata?.work_rhythm)} ${text(card.metadata?.display_action)}`.toLowerCase();
  if (joined.includes("water")) return "water";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("weed")) return "weed";
  if (joined.includes("seed") || joined.includes("sow")) return "seed";
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("garlic") || joined.includes("gather")) return "harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch")) return "build";
  if (joined.includes("plant") || joined.includes("transplant")) return "plant";
  return "venue";
}

function detail(card: TaskCard) {
  return stringList(card.metadata?.detail_lines)[0] || location(card);
}

function taskSortKey(card: TaskCard) {
  const dayOrder = typeof card.metadata?.day_order === "number" ? card.metadata.day_order : 999;
  return `${String(dayOrder).padStart(3, "0")}-${subject(card)}`;
}

async function fetchTaskCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: TaskCard[] };
  return data.taskCards ?? [];
}

function routePreview(cards: TaskCard[]) {
  return cards.map(subject).slice(0, 2).join(" · ");
}

function routeCountLine(cards: TaskCard[]) {
  return routeOrder
    .map((key) => ({ key, count: cards.filter((card) => routeForTask(card) === key).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${routeLabels[item.key]} ${item.count}`)
    .join(" · ") || "No farm tasks planned";
}

function buildDayHtml(dateIso: string, cards: TaskCard[]) {
  const dayCards = cards
    .filter(isDashboardWork)
    .filter((card) => card.due_date === dateIso)
    .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
  const routes = routeOrder
    .map((key) => ({ key, cards: dayCards.filter((card) => routeForTask(card) === key) }))
    .filter((item) => item.cards.length > 0);

  const routeBoxes = routes.length
    ? routes.map((item, index) => `<a class="atlas-day-route-box" href="#atlas-day-route-${item.key}"><small>${index + 1} · ${html(routeLabels[item.key])}</small><strong>${html(routeLabels[item.key])}</strong><span>${item.cards.length} ${item.cards.length === 1 ? "task" : "tasks"}</span><em>${html(routePreview(item.cards))}</em></a>`).join("")
    : `<div class="atlas-day-route-empty">No farm tasks planned for this day.</div>`;

  const groups = routes.map((route) => {
    const zones = Array.from(new Set(route.cards.map(collectionZone)));
    const zoneGroups = zones.map((zone) => {
      const rows = route.cards
        .filter((card) => collectionZone(card) === zone)
        .map((card) => `<a class="atlas-day-task-card" href="/task?taskId=${encodeURIComponent(card.task_id)}"><strong>${html(subject(card))}</strong><span>${html(location(card))}</span><em>${html(detail(card))}</em></a>`)
        .join("");
      return `<div class="atlas-day-zone-group"><h4>${html(zone)}</h4>${rows}</div>`;
    }).join("");
    return `<article class="atlas-day-route-group" id="atlas-day-route-${route.key}"><h3>${html(routeLabels[route.key])}</h3>${zoneGroups}</article>`;
  }).join("");

  return `
    <div class="atlas-route-collection-head atlas-day-browse-head">
      <a href="/" class="atlas-route-back">← Week</a>
      <div>
        <span>${html(dayOnly(dateIso))}</span>
        <strong>${dayCards.length} ${dayCards.length === 1 ? "task" : "tasks"}</strong>
        <small>${html(routeCountLine(dayCards))}</small>
      </div>
    </div>
    <article class="atlas-day-route-hero">
      <div class="atlas-day-route-hero-head"><div><span>Day plan</span><strong>${html(prettyDate(dateIso))}</strong></div><em class="atlas-day-route-count-pill">${dayCards.length}</em></div>
      <div class="atlas-day-route-grid">${routeBoxes}</div>
    </article>
    <div class="atlas-day-task-groups">${groups}</div>
  `;
}

function openHomeDayCard(target: HTMLElement) {
  const card = target.closest(".atlas-week-day-preview-card");
  if (!card) return false;
  const cards = Array.from(document.querySelectorAll(".atlas-week-day-preview-card"));
  const index = Math.max(0, cards.indexOf(card));
  window.location.assign(`/task?date=${encodeURIComponent(addDaysIso(index + 1))}`);
  return true;
}

export default function WeekDayNavigation() {
  useEffect(() => {
    let timer: number | null = null;

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (openHomeDayCard(target)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }

    async function renderDayBrowse() {
      if (window.location.pathname !== "/task") return;
      const params = new URLSearchParams(window.location.search);
      const dateIso = params.get("date");
      if (!dateIso) {
        document.body.classList.remove("atlas-day-browse-mode");
        document.querySelector(".atlas-day-browse")?.remove();
        return;
      }

      document.body.classList.add("atlas-day-browse-mode");
      const hero = document.querySelector(".atlas-task-page-hero");
      if (!hero) return;
      const cards = await fetchTaskCards();
      const signature = `${dateIso}-${cards.map((card) => `${card.task_id}:${card.status}:${card.due_date}`).join("|")}`;
      const existing = document.querySelector<HTMLElement>(".atlas-day-browse");
      if (existing?.dataset.daySignature === signature) return;
      existing?.remove();
      document.querySelector(".atlas-route-lineup")?.remove();
      document.querySelector(".atlas-route-collection:not(.atlas-day-browse)")?.remove();

      const section = document.createElement("section");
      section.className = "atlas-task-page-section atlas-route-collection atlas-day-browse";
      section.dataset.daySignature = signature;
      section.innerHTML = buildDayHtml(dateIso, cards);
      hero.insertAdjacentElement("afterend", section);
    }

    function queueRender() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void renderDayBrowse();
      }, 160);
    }

    const observer = new MutationObserver(queueRender);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    queueRender();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      document.body.classList.remove("atlas-day-browse-mode");
    };
  }, []);

  return null;
}
