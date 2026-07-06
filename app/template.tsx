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

const ROUTE_NAMES: Record<string, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  harvest: "Harvest",
  build: "Build / Prep",
  water: "Water",
  venue: "Venue",
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

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function routeKey(card: Card) {
  const value = route(card).toLowerCase();
  if (value.includes("build")) return "build";
  if (value.includes("prep")) return "build";
  if (value.includes("plant")) return "plant";
  if (value.includes("weed")) return "weed";
  if (value.includes("mow")) return "mow";
  if (value.includes("seed") || value.includes("sow")) return "seed";
  if (value.includes("harvest")) return "harvest";
  if (value.includes("water")) return "water";
  if (value.includes("venue")) return "venue";
  return value;
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

function dashboardCardsForRouteSource(cards: Card[]) {
  const today = todayIso();
  const dashboardCards = cards.filter(isMainCard).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const todayCards = dashboardCards.filter((card) => !card.due_date || card.due_date <= today);
  const upcomingCards = dashboardCards.filter((card) => card.due_date && card.due_date > today);
  return todayCards.length ? todayCards : upcomingCards;
}

async function fetchTaskCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = (await response.json()) as { taskCards?: Card[] };
  return data.taskCards ?? [];
}

async function insertFirstTaskPreviews() {
  if (window.location.pathname !== "/") return;
  const grid = document.querySelector(".atlas-home-grid");
  const hero = document.querySelector(".atlas-home-task-hero");
  if (!grid || !hero || grid.querySelector(".atlas-home-next-task-strip")) return;

  const today = todayIso();
  const cards = (await fetchTaskCards())
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

async function pointSingleRouteCardsToTaskCards() {
  if (window.location.pathname !== "/") return;
  const routeCards = Array.from(document.querySelectorAll<HTMLAnchorElement>(".atlas-route-sheet-box"));
  if (!routeCards.length) return;

  const cards = dashboardCardsForRouteSource(await fetchTaskCards());
  const byRoute = new Map<string, Card[]>();
  cards.forEach((card) => {
    const key = routeKey(card);
    byRoute.set(key, [...(byRoute.get(key) ?? []), card]);
  });

  routeCards.forEach((card) => {
    const key = routeFromCard(card);
    if (!key) return;
    const matchingCards = byRoute.get(key) ?? [];
    if (matchingCards.length === 1) {
      card.href = `/task?taskId=${encodeURIComponent(matchingCards[0].task_id)}`;
      card.dataset.singleTaskId = matchingCards[0].task_id;
      return;
    }
    card.href = `/task?route=${encodeURIComponent(key)}`;
    delete card.dataset.singleTaskId;
  });
}

async function redirectSingleRoutePageToTaskCard() {
  if (window.location.pathname !== "/task") return;
  const params = new URLSearchParams(window.location.search);
  const routeParam = params.get("route");
  if (!routeParam || params.get("taskId")) return;

  const cards = dashboardCardsForRouteSource(await fetchTaskCards());
  const matchingCards = cards.filter((card) => routeKey(card) === routeParam).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (matchingCards.length === 1) {
    window.location.replace(`/task?taskId=${encodeURIComponent(matchingCards[0].task_id)}`);
  }
}

function activeTaskText(card: Element) {
  return [
    card.querySelector("h1")?.textContent ?? "",
    card.querySelector(".atlas-task-page-kicker")?.textContent ?? "",
    card.querySelector(".atlas-task-page-time-row")?.textContent ?? "",
  ].join(" ").toLowerCase();
}

function defaultToolsForTask(card: Element) {
  const value = activeTaskText(card);
  if (value.includes("mow") || value.includes("walkways") || value.includes("maintenance")) return ["Battery push mower", "Riding mower", "Weed whacker", "Leaf blower"];
  if (value.includes("harvest") || value.includes("garlic") || value.includes("gather")) return ["Gloves", "Snips", "Buckets", "Rubber bands"];
  if (value.includes("weed")) return ["Gloves"];
  if (value.includes("plant") || value.includes("planting") || value.includes("transplant") || value.includes("dahlia")) return ["Hori hori", "Shovel", "Gloves", "Hose"];
  return [];
}

function insertDefaultTaskTools() {
  if (window.location.pathname !== "/task") return;
  const card = document.querySelector(".atlas-task-page-active");
  if (!card) return;
  if (card.querySelector(".atlas-task-tools-card, .atlas-default-task-tools-card")) return;
  const tools = defaultToolsForTask(card);
  if (!tools.length) return;

  const section = document.createElement("section");
  section.className = "atlas-default-task-tools-card";
  section.innerHTML = `<strong>Tools</strong><div></div>`;
  const target = section.querySelector("div");
  tools.forEach((tool) => {
    const chip = document.createElement("span");
    chip.textContent = tool;
    target?.appendChild(chip);
  });

  const spacing = card.querySelector(".atlas-plant-spacing-card");
  const detailCard = card.querySelector(".atlas-task-detail-card");
  const placeCard = card.querySelector(".atlas-task-place-card");
  (spacing ?? detailCard ?? placeCard)?.insertAdjacentElement("afterend", section);
}

function routeTaskLink(card: Card) {
  const link = document.createElement("a");
  const details = detail(card);
  link.className = "atlas-route-task-card";
  link.href = `/task?taskId=${encodeURIComponent(card.task_id)}`;
  link.innerHTML = `
    <strong>${escapeHtml(subject(card))}</strong>
    <span>${escapeHtml(zone(card))}</span>
    ${details ? `<em>${escapeHtml(details)}</em>` : ""}
  `;
  return link;
}

async function groupRouteCollectionByDueDate() {
  if (window.location.pathname !== "/task") return;
  const params = new URLSearchParams(window.location.search);
  const routeParam = params.get("route");
  if (!routeParam || params.get("taskId")) return;
  const section = document.querySelector<HTMLElement>(".atlas-route-collection");
  if (!section) return;

  const allCards = await fetchTaskCards();
  const activeIds = new Set(dashboardCardsForRouteSource(allCards).map((card) => card.task_id));
  let cards = allCards
    .filter((card) => isMainCard(card) && activeIds.has(card.task_id) && routeKey(card) === routeParam)
    .sort((a, b) => `${a.due_date ?? "9999-12-31"}-${sortKey(a)}`.localeCompare(`${b.due_date ?? "9999-12-31"}-${sortKey(b)}`));

  if (!cards.length) {
    cards = allCards
      .filter((card) => isMainCard(card) && routeKey(card) === routeParam)
      .sort((a, b) => `${a.due_date ?? "9999-12-31"}-${sortKey(a)}`.localeCompare(`${b.due_date ?? "9999-12-31"}-${sortKey(b)}`));
  }
  if (!cards.length) return;

  const groupKey = `${routeParam}-${cards.map((card) => card.task_id).join("|")}`;
  if (section.dataset.groupedByDate === groupKey) return;

  const dateKeys = Array.from(new Set(cards.map((card) => card.due_date ?? "No date")));
  section.dataset.groupedByDate = groupKey;
  section.innerHTML = `
    <div class="atlas-route-collection-head">
      <a href="/" class="atlas-route-back">← Routes</a>
      <div>
        <span>${escapeHtml(ROUTE_NAMES[routeParam] ?? routeParam)}</span>
        <strong>${cards.length} ${cards.length === 1 ? "task" : "tasks"}</strong>
        <small>Current work by due date</small>
      </div>
    </div>
    <div class="atlas-route-date-list"></div>
  `;

  const target = section.querySelector(".atlas-route-date-list");
  dateKeys.forEach((dateKey) => {
    const dateCards = cards.filter((card) => (card.due_date ?? "No date") === dateKey);
    const dateGroup = document.createElement("article");
    dateGroup.className = "atlas-route-date-group";
    dateGroup.innerHTML = `<h3>${escapeHtml(prettyDate(dateKey === "No date" ? null : dateKey))}</h3><div></div>`;
    const dateTarget = dateGroup.querySelector("div");
    const zones = Array.from(new Set(dateCards.map(zone)));
    zones.forEach((zoneName) => {
      const zoneGroup = document.createElement("section");
      zoneGroup.className = "atlas-route-zone-group";
      zoneGroup.innerHTML = `<h4>${escapeHtml(zoneName)}</h4><div></div>`;
      const zoneTarget = zoneGroup.querySelector("div");
      dateCards.filter((card) => zone(card) === zoneName).forEach((card) => zoneTarget?.appendChild(routeTaskLink(card)));
      dateTarget?.appendChild(zoneGroup);
    });
    target?.appendChild(dateGroup);
  });
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
      const card = target.closest<HTMLAnchorElement>(".atlas-route-sheet-box");
      if (!card) return;
      if (card.dataset.singleTaskId || card.href.includes("taskId=")) return;
      const route = routeFromCard(card);
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/task?route=${encodeURIComponent(route)}`);
    }

    const observer = new MutationObserver(() => window.setTimeout(() => {
      insertDefaultTaskTools();
      void groupRouteCollectionByDueDate();
    }, 50));
    observer.observe(document.body, { childList: true, subtree: true });

    syncTaskMode();
    void insertFirstTaskPreviews();
    void pointSingleRouteCardsToTaskCards();
    void redirectSingleRoutePageToTaskCard();
    window.setTimeout(() => {
      insertDefaultTaskTools();
      void groupRouteCollectionByDueDate();
    }, 250);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", syncTaskMode);
    return () => {
      document.body.classList.remove("atlas-route-mode", "atlas-task-detail-mode");
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", syncTaskMode);
    };
  }, []);

  return <>{children}</>;
}
