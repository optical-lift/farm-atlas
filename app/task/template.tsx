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

function text(value: unknown) {
  return typeof value === "string" ? value : "";
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

function isRouteKey(value: string): value is RouteKey {
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "harvest" || value === "build" || value === "venue" || value === "water";
}

function subject(card: TaskCard) {
  const display = text(card.metadata?.display_subject);
  if (display) return display;
  return card.title.split("—").slice(1).join("—").trim() || card.title;
}

function label(card: TaskCard) {
  return text(card.metadata?.checklist_label) || subject(card);
}

function collectionLabel(card: TaskCard) {
  return text(card.metadata?.collection_label) || subject(card);
}

function location(card: TaskCard) {
  return text(card.metadata?.display_detail) || card.unlock_text || card.zone_label || "Elm Farm";
}

function collectionZone(card: TaskCard) {
  const explicit = text(card.metadata?.collection_zone);
  if (explicit) return explicit;
  return zoneBucket(location(card));
}

function spacingLines(card: TaskCard) {
  return stringList(card.metadata?.plant_spacing_lines);
}

function detailLines(card: TaskCard) {
  return stringList(card.metadata?.detail_lines);
}

function isDone(card: TaskCard) {
  return text(card.metadata?.checklist_status) === "done";
}

function isChildTask(card: TaskCard) {
  return text(card.metadata?.is_child_task) === "true" || card.metadata?.is_child_task === true;
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

function message(value: string) {
  const card = document.querySelector(".atlas-task-page-active");
  if (!card) return;
  let line = card.querySelector(".atlas-child-checklist-message");
  if (!line) {
    line = document.createElement("p");
    line.className = "atlas-task-page-message atlas-child-checklist-message";
    card.appendChild(line);
  }
  line.textContent = value;
}

function insertLocationPill(parent: TaskCard) {
  const row = document.querySelector(".atlas-task-page-active .atlas-task-page-time-row");
  if (!row) return;
  row.querySelector(".atlas-task-location-pill")?.remove();
  const pill = document.createElement("span");
  pill.className = "atlas-task-location-pill";
  pill.textContent = location(parent);
  row.appendChild(pill);
}

function insertSpacing(parent: TaskCard) {
  const card = document.querySelector(".atlas-task-page-active");
  if (!card) return;
  card.querySelector(".atlas-plant-spacing-card")?.remove();
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

function decorateParent(parent: TaskCard) {
  insertLocationPill(parent);
  insertSpacing(parent);
}

function insertChecklist(parent: TaskCard, children: TaskCard[]) {
  const card = document.querySelector(".atlas-task-page-active");
  if (!card) return;
  card.querySelector(".atlas-child-checklist")?.remove();

  const openChildren = children.filter((child) => !isDone(child));
  const doneChildren = children.filter(isDone);
  const section = document.createElement("section");
  section.className = "atlas-child-checklist";
  section.dataset.parentTaskId = parent.task_id;
  section.innerHTML = `
    <strong>Checklist</strong>
    <div class="atlas-child-checklist-open"></div>
    ${doneChildren.length ? `<details class="atlas-child-checklist-finished"><summary>Already finished · ${doneChildren.length}</summary><div></div></details>` : ""}
  `;

  const openTarget = section.querySelector(".atlas-child-checklist-open");
  openChildren.forEach((child) => openTarget?.appendChild(checkButton(child)));

  const doneTarget = section.querySelector(".atlas-child-checklist-finished div");
  doneChildren.forEach((child) => doneTarget?.appendChild(checkButton(child)));

  const spacing = card.querySelector(".atlas-plant-spacing-card");
  const detail = card.querySelector(".atlas-task-detail-card");
  const place = card.querySelector(".atlas-task-place-card");
  (spacing ?? detail ?? place)?.insertAdjacentElement("afterend", section);
}

function checkButton(child: TaskCard) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isDone(child) ? "atlas-child-check-item done" : "atlas-child-check-item";
  button.dataset.childTaskId = child.task_id;
  button.dataset.nextStatus = isDone(child) ? "open" : "done";
  button.innerHTML = `<span>${isDone(child) ? "✓" : ""}</span><strong>${label(child)}</strong>`;
  return button;
}

function routeCard(task: TaskCard) {
  const link = document.createElement("a");
  link.className = "atlas-route-task-card";
  link.href = `/task?taskId=${encodeURIComponent(task.task_id)}`;
  const details = detailLines(task);
  link.innerHTML = `
    <strong>${collectionLabel(task)}</strong>
    <span>${location(task)}</span>
    ${details.length ? `<em>${details.slice(0, 2).join(" · ")}</em>` : ""}
  `;
  return link;
}

function insertRouteCollection(cards: TaskCard[]) {
  const params = new URLSearchParams(window.location.search);
  const routeParam = params.get("route") ?? "";
  const hasTaskId = Boolean(params.get("taskId"));
  const route = isRouteKey(routeParam) ? routeParam : null;
  document.body.classList.toggle("atlas-route-mode", Boolean(route && !hasTaskId));
  document.querySelector(".atlas-route-collection")?.remove();
  if (!route || hasTaskId) return;

  const parentCards = cards
    .filter((card) => card.status === "open" && !isChildTask(card) && routeForTask(card) === route)
    .sort((a, b) => `${collectionZone(a)}-${numberValue(a.metadata?.day_order)}-${collectionLabel(a)}`.localeCompare(`${collectionZone(b)}-${numberValue(b.metadata?.day_order)}-${collectionLabel(b)}`));

  const hero = document.querySelector(".atlas-task-page-hero");
  if (!hero) return;

  const section = document.createElement("section");
  section.className = "atlas-task-page-section atlas-route-collection";
  const zones = Array.from(new Set(parentCards.map(collectionZone)));
  section.innerHTML = `
    <div class="atlas-route-collection-head">
      <a href="/" class="atlas-route-back">← Routes</a>
      <div>
        <span>${routeLabels[route]}</span>
        <strong>${parentCards.length} ${parentCards.length === 1 ? "task" : "tasks"}</strong>
        <small>${zones.join(" · ")}</small>
      </div>
    </div>
    <div class="atlas-route-zone-list"></div>
  `;

  const target = section.querySelector(".atlas-route-zone-list");
  zones.forEach((zone) => {
    const group = document.createElement("article");
    group.className = "atlas-route-zone-group";
    group.innerHTML = `<h3>${zone}</h3><div></div>`;
    const groupTarget = group.querySelector("div");
    parentCards.filter((task) => collectionZone(task) === zone).forEach((task) => groupTarget?.appendChild(routeCard(task)));
    target?.appendChild(group);
  });

  hero.insertAdjacentElement("afterend", section);
}

export default function TaskTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cards: TaskCard[] = [];

    async function refresh() {
      cards = await loadCards();
      insertRouteCollection(cards);
      const parent = findParent(cards);
      if (!parent) return;
      decorateParent(parent);
      const childCards = cards
        .filter((card) => text(card.metadata?.parent_task_id) === parent.task_id)
        .filter((card) => card.status !== "archived")
        .sort((a, b) => numberValue(a.metadata?.step_order) - numberValue(b.metadata?.step_order));
      if (childCards.length) insertChecklist(parent, childCards);
    }

    function activeParentAndChildren() {
      const parent = findParent(cards);
      if (!parent) return { parent: null, childCards: [] as TaskCard[] };
      const childCards = cards.filter((card) => text(card.metadata?.parent_task_id) === parent.task_id && card.status !== "archived");
      return { parent, childCards };
    }

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const check = target.closest(".atlas-child-check-item") as HTMLButtonElement | null;
      if (check?.dataset.childTaskId) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        fetch("/api/atlas/task-child-toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ taskId: check.dataset.childTaskId, checklistStatus: check.dataset.nextStatus === "done" ? "done" : "open" }),
        }).then(() => refresh());
        return;
      }

      const button = target.closest("button");
      if (!button) return;
      const buttonText = button.textContent?.trim();

      if (buttonText === "Done") {
        const { childCards } = activeParentAndChildren();
        if (childCards.length && childCards.some((child) => !isDone(child))) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          message("Finish the checklist before marking the whole task done.");
        }
        return;
      }

      if (buttonText !== "More" && buttonText !== "Unfinished") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const { parent } = activeParentAndChildren();
      const params = new URLSearchParams(window.location.search);
      const taskId = parent?.task_id ?? params.get("taskId");
      const activeTitle = document.querySelector(".atlas-task-page-active h1")?.textContent?.trim();
      const payload = taskId ? { taskId } : { taskTitle: activeTitle ? `%${activeTitle}%` : "" };

      fetch("/api/atlas/task-unfinished", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...payload,
          laneKey: "maintain",
          workKey: "unfinished",
        }),
      }).then(() => window.location.assign("/task"));
    }

    const observer = new MutationObserver(() => window.setTimeout(refresh, 50));
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    window.setTimeout(refresh, 300);
    return () => {
      document.body.classList.remove("atlas-route-mode");
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return <>{children}</>;
}
