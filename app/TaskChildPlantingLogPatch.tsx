"use client";

import { useEffect } from "react";

type Card = {
  task_id: string;
  title: string;
  status: string;
  metadata?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function html(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function label(card: Card) {
  return text(card.metadata?.checklist_label) || text(card.metadata?.display_subject) || card.title.replace(/^Checklist\s+—\s+/i, "");
}

function stepOrder(card: Card) {
  return typeof card.metadata?.step_order === "number" ? card.metadata.step_order : 999;
}

function parentId(card: Card) {
  return text(card.metadata?.parent_task_id);
}

function isDone(card: Card) {
  return text(card.metadata?.checklist_status) === "done";
}

function needsPlantingLog(card: Card) {
  return card.metadata?.planting_log_required === true || card.metadata?.planting_log_required === "true";
}

function detailLines(card: Card) {
  return stringList(card.metadata?.detail_lines);
}

async function fetchCards() {
  const response = await fetch("/api/atlas/task-cards", { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as { taskCards?: Card[] };
  return data.taskCards ?? [];
}

async function toggleChecklist(taskId: string, checklistStatus: "open" | "done", body: Record<string, unknown> = {}) {
  const response = await fetch("/api/atlas/task-child-toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId, checklistStatus, ...body }),
  });
  const data = await response.json() as { ok?: boolean; details?: string; error?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Checklist failed.");
}

function renderButton(child: Card) {
  const done = isDone(child);
  const details = detailLines(child);
  return `
    <button type="button" class="${done ? "atlas-child-check-item done" : "atlas-child-check-item"}" data-child-task-id="${html(child.task_id)}" data-next-status="${done ? "open" : "done"}">
      <span>${done ? "✓" : ""}</span>
      <div class="atlas-child-check-copy">
        <strong>${html(label(child))}</strong>
        ${details.map((line) => `<em>${html(line)}</em>`).join("")}
      </div>
    </button>
  `;
}

function renderStableChecklists(cards: Card[]) {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".atlas-child-checklist[data-parent-task-id]"));
  sections.forEach((section) => {
    const id = section.dataset.parentTaskId ?? "";
    const children = cards
      .filter((card) => parentId(card) === id && card.status !== "archived")
      .sort((a, b) => stepOrder(a) - stepOrder(b));
    if (!children.length) return;
    const signature = children.map((child) => `${child.task_id}:${text(child.metadata?.checklist_status)}:${text(child.metadata?.planting_log?.recorded_at)}`).join("|");
    if (section.dataset.stableChecklistSignature === signature) return;
    section.dataset.stableChecklistSignature = signature;
    section.innerHTML = `
      <strong>Checklist</strong>
      <div class="atlas-child-checklist-open atlas-child-checklist-stable-list">
        ${children.map(renderButton).join("")}
      </div>
    `;
  });
}

function markButton(button: HTMLButtonElement, done: boolean) {
  button.disabled = false;
  button.classList.toggle("done", done);
  button.dataset.nextStatus = done ? "open" : "done";
  const check = button.querySelector("span");
  if (check) check.textContent = done ? "✓" : "";
}

export default function TaskChildPlantingLogPatch() {
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function refreshStableChecklists() {
      if (stopped || window.location.pathname !== "/task") return;
      const cards = await fetchCards();
      if (!stopped) renderStableChecklists(cards);
    }

    function queueRefresh() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshStableChecklists();
      }, 90);
    }

    async function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLButtonElement>(".atlas-child-check-item");
      if (!button?.dataset.childTaskId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const taskId = button.dataset.childTaskId;
      const checklistStatus = button.dataset.nextStatus === "done" ? "done" : "open";

      try {
        button.disabled = true;
        const cards = await fetchCards();
        const child = cards.find((card) => card.task_id === taskId);
        if (!child) throw new Error("Checklist item was not found.");

        if (checklistStatus === "done" && needsPlantingLog(child)) {
          const defaultAmount = numberText(child.metadata?.planting_log_default_amount);
          const defaultLocation = text(child.metadata?.planting_log_default_location) || text(child.metadata?.display_detail);
          const amount = window.prompt(`How many ${label(child)} did Anna plant?`, defaultAmount)?.trim();
          if (!amount) {
            button.disabled = false;
            return;
          }
          const location = window.prompt(`Where did Anna plant ${label(child)}?`, defaultLocation)?.trim();
          if (!location) {
            button.disabled = false;
            return;
          }
          await toggleChecklist(taskId, checklistStatus, { plantedAmount: amount, plantedLocation: location });
        } else {
          await toggleChecklist(taskId, checklistStatus);
        }

        markButton(button, checklistStatus === "done");
        queueRefresh();
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Checklist failed.");
      }
    }

    const observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("click", handleClick, true);
    queueRefresh();
    const interval = window.setInterval(() => void refreshStableChecklists(), 650);
    window.setTimeout(() => window.clearInterval(interval), 7000);

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
      observer.disconnect();
      window.removeEventListener("click", handleClick, true);
    };
  }, []);

  return null;
}
