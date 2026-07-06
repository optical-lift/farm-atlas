"use client";

import { type ReactNode, useEffect } from "react";

type TaskCard = {
  task_id: string;
  title: string;
  status: string;
  due_date: string | null;
  metadata?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 999;
}

function norm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function subject(card: TaskCard) {
  const display = text(card.metadata?.display_subject);
  if (display) return display;
  return card.title.split("—").slice(1).join("—").trim() || card.title;
}

function label(card: TaskCard) {
  return text(card.metadata?.checklist_label) || subject(card);
}

function isDone(card: TaskCard) {
  return text(card.metadata?.checklist_status) === "done";
}

function findParent(cards: TaskCard[]) {
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get("taskId");
  const activeTitle = norm(document.querySelector(".atlas-task-page-active h1")?.textContent?.trim());
  const candidates = cards.filter((card) => text(card.metadata?.is_child_task) !== "true" && card.metadata?.is_child_task !== true);
  if (taskId) {
    const direct = candidates.find((card) => card.task_id === taskId);
    if (direct) return direct;
  }
  if (!activeTitle) return null;
  return candidates.find((card) => norm(subject(card)) === activeTitle || norm(card.title).includes(activeTitle)) ?? null;
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

  const detail = card.querySelector(".atlas-task-detail-card");
  const place = card.querySelector(".atlas-task-place-card");
  (detail ?? place)?.insertAdjacentElement("afterend", section);
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

export default function TaskTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cards: TaskCard[] = [];

    async function refresh() {
      cards = await loadCards();
      const parent = findParent(cards);
      if (!parent) return;
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
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return <>{children}</>;
}
