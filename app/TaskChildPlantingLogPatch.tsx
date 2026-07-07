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

function label(card: Card) {
  return text(card.metadata?.checklist_label) || text(card.metadata?.display_subject) || card.title.replace(/^Checklist\s+—\s+/i, "");
}

function needsPlantingLog(card: Card) {
  return card.metadata?.planting_log_required === true || card.metadata?.planting_log_required === "true";
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

export default function TaskChildPlantingLogPatch() {
  useEffect(() => {
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

        window.location.reload();
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Checklist failed.");
      }
    }

    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
