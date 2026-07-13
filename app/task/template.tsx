"use client";

import { type ReactNode, useEffect } from "react";

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

const mainRoutes = new Set<RouteKey>(["plant", "weed", "mow", "seed", "build"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 999;
}

function norm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function html(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isRouteKey(value: string): value is RouteKey {
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "harvest" || value === "build" || value === "venue" || value === "water";
}

function subject(card: TaskCard) {
  return text(card.metadata?.display_subject) || card.title.split("—").slice(1).join("—").trim() || card.title;
}

function collectionLabel(card: TaskCard) {
  return text(card.metadata?.collection_label) || subject(card);
}

function location(card: TaskCard) {
  return text(card.metadata?.display_detail) || card.unlock_text || card.zone_label || "Elm Farm";
}

function collectionZone(card: TaskCard) {
  return text(card.metadata?.collection_zone) || zoneBucket(location(card));
}

function spacingLines(card: TaskCard) {
  return stringList(card.metadata?.plant_spacing_lines);
}

function detailLines(card: TaskCard) {
  return stringList(card.metadata?.detail_lines);
}

function taskTools(parent: TaskCard) {
  const explicit = stringList(parent.metadata?.tool_lines);
  if (explicit.length) return explicit;
  const route = routeForTask(parent);
  if (route === "plant") return ["Hori hori", "Shovel", "Gloves", "Hose"];
  if (route === "weed") return ["Gloves"];
  if (route === "harvest") return ["Gloves", "Snips", "Buckets", "Rubber bands"];
  if (route === "mow") return ["Battery push mower", "Riding mower", "Weed whacker", "Leaf blower"];
  return [];
}

function isChildTask(card: TaskCard) {
  return text(card.metadata?.is_child_task) === "true" || card.metadata?.is_child_task === true;
}

function isParentOpen(card: TaskCard) {
  return card.status === "open" && !isChildTask(card);
}

function taskSortKey(card: TaskCard) {
  return `${card.due_date ?? "9999-12-31"}-${String(numberValue(card.metadata?.day_order)).padStart(3, "0")}-${collectionLabel(card)}`;
}

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isTodayWork(card: TaskCard) {
  return card.due_date === todayIso();
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function findParent(cards: TaskCard[]) {
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get("taskId");
  const activeTitle = norm(document.querySelector(".atlas-task-page-active h1")?.textContent?.trim());
  const candidates = cards.filter((card) => !isChildTask(card));
  if (taskId) {
    const direct = candidates.find((card) => card.task_id === taskId);
    if (direct) return direct;
  }
  if (!activeTitle) return null;
  return candidates.find((card) => norm(subject(card)) === activeTitle || norm(card.title).includes(activeTitle)) ?? null;
}

function routeForTask(card: TaskCard): RouteKey {
  const explicit = text(card.metadata?.work_route);
  if (isRouteKey(explicit)) return explicit;
  const taskText = `${card.task_type ?? ""} ${card.title} ${text(card.metadata?.work_rhythm)} ${text(card.metadata?.display_action)}`.toLowerCase();
  if (taskText.includes("water")) return "water";
  if (taskText.includes("mow")) return "mow";
  if (taskText.includes("weed")) return "weed";
  if (taskText.includes("seed") || taskText.includes("sow")) return "seed";
  if (taskText.includes("harvest") || taskText.includes("postharvest") || taskText.includes("garlic") || taskText.includes("gather")) return "harvest";
  if (taskText.includes("venue") || taskText.includes("paint") || taskText.includes("trim") || taskText.includes("tidy") || taskText.includes("chicken")) return "venue";
  if (taskText.includes("build") || taskText.includes("prep") || taskText.includes("string") || taskText.includes("arch")) return "build";
  if (taskText.includes("plant") || taskText.includes("transplant")) return "plant";
  return "venue";
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

async function loadCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: TaskCard[] };
  return data.taskCards ?? [];
}

function removeTimingPills() {
  document.querySelectorAll(".atlas-task-page-time-row span, .atlas-task-page-row small").forEach((item) => {
    const value = item.textContent?.trim().toLowerCase();
    if (value === "morning" || value === "afternoon" || value === "after rain") item.remove();
  });
}

function insertLocationPill(parent: TaskCard) {
  const row = document.querySelector(".atlas-task-page-active .atlas-task-page-time-row");
  if (!row) return;
  if (row.querySelector(".atlas-task-location-pill")) return;
  const place = location(parent);
  if (routeForTask(parent) === "mow" || norm(place) === "weekly production paths") return;
  const pill = document.createElement("span");
  pill.className = "atlas-task-location-pill";
  pill.textContent = place;
  row.appendChild(pill);
}

function insertSpacing(parent: TaskCard) {
  const card = document.querySelector(".atlas-task-page-active");
  if (!card || card.querySelector(".atlas-plant-spacing-card")) return;
  const lines = spacingLines(parent);
  if (!lines.length) return;

  const section = document.createElement("section");
  section.className = "atlas-plant-spacing-card";
  section.innerHTML = `<strong>Spacing</strong><div></div>`;
  const target = section.querySelector("div");
  lines.forEach((line) => {
    const chip = document.createElement("span");
    chip.textContent = line;
    target?.appendChild(chip);
  });

  const detail = card.querySelector(".atlas-task-detail-card");
  const place = card.querySelector(".atlas-task-place-card");
  (detail ?? place)?.insertAdjacentElement("afterend", section);
}

function insertTools(parent: TaskCard) {
  const card = document.querySelector(".atlas-task-page-active");
  if (!card || card.querySelector(".atlas-task-tools-card, .atlas-default-task-tools-card")) return;
  const tools = taskTools(parent);
  if (!tools.length) return;

  const section = document.createElement("section");
  section.className = "atlas-task-tools-card";
  section.innerHTML = `<strong>Tools</strong><div></div>`;
  const target = section.querySelector("div");
  tools.forEach((tool) => {
    const chip = document.createElement("span");
    chip.textContent = tool;
    target?.appendChild(chip);
  });

  const spacing = card.querySelector(".atlas-plant-spacing-card");
  const detail = card.querySelector(".atlas-task-detail-card");
  const place = card.querySelector(".atlas-task-place-card");
  (spacing ?? detail ?? place)?.insertAdjacentElement("afterend", section);
}

function decorateParent(parent: TaskCard) {
  removeTimingPills();
  insertLocationPill(parent);
  insertSpacing(parent);
  insertTools(parent);
}

function routeCard(task: TaskCard) {
  const link = document.createElement("a");
  link.className = "atlas-route-task-card";
  link.href = `/task?taskId=${encodeURIComponent(task.task_id)}`;
  const details = detailLines(task);
  link.innerHTML = `
    <strong>${html(collectionLabel(task))}</strong>
    <span>${html(location(task))}</span>
    ${details.length ? `<em>${html(details.slice(0, 2).join(" · "))}</em>` : ""}
  `;
  return link;
}

function lineupTaskCard(task: TaskCard) {
  const link = routeCard(task);
  link.classList.add("atlas-lineup-task-card");
  const route = routeForTask(task);
  const meta = document.createElement("small");
  meta.textContent = `${routeLabels[route]} · ${prettyDate(task.due_date)}`;
  link.insertBefore(meta, link.firstChild);
  return link;
}

function insertZoneGroups(target: Element | null, labelText: string, cards: TaskCard[], groupBy: (card: TaskCard) => string) {
  if (!target || cards.length === 0) return;
  const shelf = document.createElement("article");
  shelf.className = "atlas-lineup-shelf";
  shelf.innerHTML = `<h3>${labelText}</h3><div class="atlas-lineup-zone-list"></div>`;
  const list = shelf.querySelector(".atlas-lineup-zone-list");
  const groups = Array.from(new Set(cards.map(groupBy)));
  groups.forEach((groupName) => {
    const group = document.createElement("section");
    group.className = "atlas-route-zone-group atlas-lineup-zone-group";
    group.innerHTML = `<h4>${html(groupName)}</h4><div></div>`;
    const groupTarget = group.querySelector("div");
    cards.filter((task) => groupBy(task) === groupName).forEach((task) => groupTarget?.appendChild(lineupTaskCard(task)));
    list?.appendChild(group);
  });
  target.appendChild(shelf);
}

function insertWeeklyLineup(cards: TaskCard[], hasTaskId: boolean) {
  const existing = document.querySelector(".atlas-route-lineup");
  if (hasTaskId) {
    existing?.remove();
    return;
  }

  const anchor = document.querySelector(".atlas-route-collection") ?? document.querySelector(".atlas-task-page-hero");
  if (!anchor) return;

  const parentCards = cards.filter(isParentOpen).sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
  const mainCards = parentCards.filter((card) => mainRoutes.has(routeForTask(card)));
  const sideCards = parentCards.filter((card) => !mainRoutes.has(routeForTask(card)));
  const signature = parentCards.map((card) => card.task_id).join("|");
  if (existing instanceof HTMLElement && existing.dataset.lineupSignature === signature) return;
  existing?.remove();

  const section = document.createElement("section");
  section.className = "atlas-task-page-section atlas-route-lineup";
  section.dataset.lineupSignature = signature;
  section.innerHTML = `
    <div class="atlas-route-collection-head atlas-lineup-head">
      <div><span>Lineup</span><strong>${parentCards.length} open</strong><small>Main work by place. Side work by route.</small></div>
    </div>
    <div class="atlas-lineup-body"></div>
  `;
  const body = section.querySelector(".atlas-lineup-body");
  insertZoneGroups(body, "Main Work", mainCards, collectionZone);
  insertZoneGroups(body, "Side Work", sideCards, (card) => routeLabels[routeForTask(card)]);

  if (anchor.classList.contains("atlas-route-collection")) anchor.appendChild(section);
  else anchor.insertAdjacentElement("afterend", section);
}

function insertRouteCollection(cards: TaskCard[]) {
  const params = new URLSearchParams(window.location.search);
  const routeParam = params.get("route") ?? "";
  const hasTaskId = Boolean(params.get("taskId"));
  const route = isRouteKey(routeParam) ? routeParam : null;
  const isCollectionPage = !hasTaskId;
  const existing = document.querySelector<HTMLElement>(".atlas-route-collection");
  document.body.classList.toggle("atlas-route-mode", Boolean(route && isCollectionPage));
  document.body.classList.toggle("atlas-task-collection-mode", Boolean(isCollectionPage));
  if (hasTaskId) {
    existing?.remove();
    document.querySelector(".atlas-route-lineup")?.remove();
    return;
  }

  if (!route) {
    existing?.remove();
    insertWeeklyLineup(cards, hasTaskId);
    return;
  }
  document.querySelector(".atlas-route-lineup")?.remove();

  const parentCards = cards
    .filter((card) => isParentOpen(card) && routeForTask(card) === route && isTodayWork(card))
    .sort((a, b) => `${collectionZone(a)}-${String(numberValue(a.metadata?.day_order)).padStart(3, "0")}-${collectionLabel(a)}`.localeCompare(`${collectionZone(b)}-${String(numberValue(b.metadata?.day_order)).padStart(3, "0")}-${collectionLabel(b)}`));
  const signature = `${route}-${todayIso()}-${parentCards.map((card) => card.task_id).join("|")}`;
  if (existing?.dataset.routeSignature === signature) return;

  const hero = document.querySelector(".atlas-task-page-hero");
  if (!hero) return;
  existing?.remove();

  const section = document.createElement("section");
  section.className = "atlas-task-page-section atlas-route-collection";
  section.dataset.routeSignature = signature;
  const zones = Array.from(new Set(parentCards.map(collectionZone)));
  section.innerHTML = `
    <div class="atlas-route-collection-head">
      <a href="/" class="atlas-route-back">← Routes</a>
      <div><span>${routeLabels[route]}</span><strong>${parentCards.length} ${parentCards.length === 1 ? "task" : "tasks"} today</strong><small>${zones.length ? zones.join(" · ") : "No tasks in this route today"}</small></div>
    </div>
    <div class="atlas-route-zone-list"></div>
  `;

  const target = section.querySelector(".atlas-route-zone-list");
  zones.forEach((zone) => {
    const group = document.createElement("article");
    group.className = "atlas-route-zone-group";
    group.innerHTML = `<h3>${html(zone)}</h3><div></div>`;
    const groupTarget = group.querySelector("div");
    parentCards.filter((task) => collectionZone(task) === zone).forEach((task) => groupTarget?.appendChild(routeCard(task)));
    target?.appendChild(group);
  });

  hero.insertAdjacentElement("afterend", section);
}

export default function TaskTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cards: TaskCard[] = [];
    let stopped = false;
    const timers: number[] = [];

    async function refresh() {
      if (stopped) return;
      cards = await loadCards();
      if (stopped) return;
      removeTimingPills();
      insertRouteCollection(cards);
      const parent = findParent(cards);
      if (!parent) return;
      decorateParent(parent);
      // The React task card owns the checklist and task transitions.
    }

    function scheduleRefresh(delay: number) {
      const timer = window.setTimeout(() => void refresh(), delay);
      timers.push(timer);
    }

    function scheduleSettledRefreshes() {
      [120, 400, 900, 1800, 3200].forEach(scheduleRefresh);
    }

    scheduleSettledRefreshes();
    return () => {
      stopped = true;
      document.body.classList.remove("atlas-route-mode", "atlas-task-collection-mode");
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return <>{children}</>;
}
