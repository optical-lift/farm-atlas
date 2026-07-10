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

function parentLabel(card: Card) {
  return text(card.metadata?.display_subject) || card.title.replace(/^[^—]+—\s*/i, "");
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function defaultAmount(card: Card) {
  return numberText(card.metadata?.planting_log_default_amount);
}

function defaultLocation(card: Card) {
  return text(card.metadata?.planting_log_default_location) || text(card.metadata?.display_detail);
}

function logSummary(card: Card) {
  const log = card.metadata?.planting_log as Record<string, unknown> | undefined;
  return text(log?.summary);
}

function hasChildren(card: Card, cards: Card[]) {
  return cards.some((candidate) => parentId(candidate) === card.task_id && candidate.status !== "archived");
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
  const data = await response.json() as { ok?: boolean; details?: string; error?: string; plantingLog?: { summary?: string } | null };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Checklist failed.");
  return data.plantingLog ?? null;
}

function renderInlineLog(child: Card) {
  if (!needsPlantingLog(child) || isDone(child)) return "";
  return `
    <form class="atlas-child-plant-log" data-child-task-id="${html(child.task_id)}" hidden>
      <label><span>Count</span><input name="plantedAmount" inputmode="numeric" type="number" min="0" step="1" value="${html(defaultAmount(child))}" /></label>
      <label><span>Where</span><input name="plantedLocation" type="text" value="${html(defaultLocation(child))}" placeholder="Bed or area" /></label>
      <div class="atlas-child-plant-log-actions">
        <button type="submit">Save planted</button>
        <button type="button" class="atlas-child-log-cancel">Cancel</button>
      </div>
      <p class="atlas-child-log-error" aria-live="polite"></p>
    </form>
  `;
}

function renderButton(child: Card) {
  const done = isDone(child);
  const details = detailLines(child);
  const summary = logSummary(child);
  return `
    <div class="${done ? "atlas-child-check-item done" : "atlas-child-check-item"}" data-child-task-id="${html(child.task_id)}" data-next-status="${done ? "open" : "done"}" data-planting-log-required="${needsPlantingLog(child) ? "true" : "false"}">
      <button type="button" class="atlas-child-check-touch">
        <span>${done ? "✓" : ""}</span>
        <div class="atlas-child-check-copy">
          <strong>${html(label(child))}</strong>
          ${details.map((line) => `<em>${html(line)}</em>`).join("")}
          ${summary ? `<em class="atlas-child-log-summary">${html(summary)}</em>` : ""}
        </div>
      </button>
      ${renderInlineLog(child)}
    </div>
  `;
}

function checklistSignature(children: Card[]) {
  return children.map((child) => `${child.task_id}:${text(child.metadata?.checklist_status)}:${text((child.metadata?.planting_log as Record<string, unknown> | undefined)?.recorded_at)}`).join("|");
}

function currentParentCard(cards: Card[]) {
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get("taskId");
  if (taskId) {
    const explicit = cards.find((card) => card.task_id === taskId && hasChildren(card, cards));
    if (explicit) return explicit;
  }

  const activeHeading = normalized(document.querySelector<HTMLElement>(".atlas-task-ticket-card h1")?.textContent ?? "");
  if (!activeHeading) return null;

  return cards.find((card) => card.status !== "archived" && hasChildren(card, cards) && normalized(parentLabel(card)).includes(activeHeading))
    ?? cards.find((card) => card.status !== "archived" && hasChildren(card, cards) && activeHeading.includes(normalized(parentLabel(card))));
}

function ensureChecklistMount(cards: Card[]) {
  const parent = currentParentCard(cards);
  const activeCard = document.querySelector<HTMLElement>(".atlas-task-ticket-card");
  if (!parent || !activeCard) return false;

  const existing = activeCard.querySelector<HTMLElement>(".atlas-child-checklist[data-parent-task-id]");
  if (existing?.dataset.parentTaskId === parent.task_id) return true;
  existing?.remove();

  const section = document.createElement("section");
  section.className = "atlas-child-checklist";
  section.dataset.parentTaskId = parent.task_id;

  const anchor = activeCard.querySelector<HTMLElement>(".atlas-task-page-actions");
  if (anchor) activeCard.insertBefore(section, anchor);
  else activeCard.appendChild(section);

  return true;
}

function renderStableChecklists(cards: Card[]) {
  ensureChecklistMount(cards);
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".atlas-child-checklist[data-parent-task-id]"));
  let rendered = false;

  sections.forEach((section) => {
    const id = section.dataset.parentTaskId ?? "";
    const children = cards
      .filter((card) => parentId(card) === id && card.status !== "archived")
      .sort((a, b) => stepOrder(a) - stepOrder(b));
    if (!children.length) return;

    const signature = checklistSignature(children);
    const alreadyStable = section.dataset.stableChecklistSignature === signature && section.querySelector(".atlas-child-checklist-stable-list");
    const activelyEditing = section.querySelector(".atlas-child-check-item.logging, .atlas-child-check-item.saving");
    if (alreadyStable || activelyEditing) return;

    section.dataset.stableChecklistSignature = signature;
    section.innerHTML = `
      <strong>Checklist</strong>
      <div class="atlas-child-checklist-open atlas-child-checklist-stable-list">
        ${children.map(renderButton).join("")}
      </div>
    `;
    rendered = true;
  });

  return rendered;
}

function setRowError(row: HTMLElement, message: string) {
  const error = row.querySelector<HTMLElement>(".atlas-child-log-error");
  if (error) error.textContent = message;
}

function showInlineLog(row: HTMLElement) {
  const form = row.querySelector<HTMLFormElement>(".atlas-child-plant-log");
  if (!form) return;
  row.classList.add("logging");
  form.hidden = false;
  setRowError(row, "");
  form.querySelector<HTMLInputElement>("input[name='plantedAmount']")?.focus();
}

function hideInlineLog(row: HTMLElement) {
  const form = row.querySelector<HTMLFormElement>(".atlas-child-plant-log");
  if (!form) return;
  row.classList.remove("logging");
  form.hidden = true;
  setRowError(row, "");
}

function markRow(row: HTMLElement, done: boolean, summary?: string) {
  row.classList.toggle("done", done);
  row.classList.remove("logging", "saving");
  row.dataset.nextStatus = done ? "open" : "done";
  const check = row.querySelector(".atlas-child-check-touch span");
  if (check) check.textContent = done ? "✓" : "";
  const form = row.querySelector<HTMLFormElement>(".atlas-child-plant-log");
  if (form) form.hidden = true;
  if (summary) {
    const copy = row.querySelector(".atlas-child-check-copy");
    const existing = row.querySelector(".atlas-child-log-summary");
    if (existing) existing.textContent = summary;
    else copy?.insertAdjacentHTML("beforeend", `<em class="atlas-child-log-summary">${html(summary)}</em>`);
  }
}

export default function TaskChildPlantingLogPatch() {
  useEffect(() => {
    let stopped = false;
    const timers: number[] = [];

    async function refreshStableChecklists() {
      if (stopped || window.location.pathname !== "/task") return;
      const cards = await fetchCards();
      if (!stopped) renderStableChecklists(cards);
    }

    function scheduleRefresh(delay: number) {
      const timer = window.setTimeout(() => void refreshStableChecklists(), delay);
      timers.push(timer);
    }

    function scheduleSettledRefreshes() {
      [250, 800, 1600, 3000].forEach(scheduleRefresh);
    }

    async function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const cancel = target.closest<HTMLButtonElement>(".atlas-child-log-cancel");
      if (cancel) {
        const row = cancel.closest<HTMLElement>(".atlas-child-check-item");
        if (row) hideInlineLog(row);
        return;
      }

      const touch = target.closest<HTMLButtonElement>(".atlas-child-check-touch");
      const row = touch?.closest<HTMLElement>(".atlas-child-check-item");
      if (!touch || !row?.dataset.childTaskId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const taskId = row.dataset.childTaskId;
      const checklistStatus = row.dataset.nextStatus === "done" ? "done" : "open";

      if (checklistStatus === "done" && row.dataset.plantingLogRequired === "true") {
        showInlineLog(row);
        return;
      }

      try {
        row.classList.add("saving");
        await toggleChecklist(taskId, checklistStatus);
        markRow(row, checklistStatus === "done");
      } catch (error) {
        row.classList.remove("saving");
        setRowError(row, error instanceof Error ? error.message : "Checklist failed.");
      }
    }

    async function handleSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.classList.contains("atlas-child-plant-log")) return;
      event.preventDefault();
      event.stopPropagation();

      const row = form.closest<HTMLElement>(".atlas-child-check-item");
      const taskId = row?.dataset.childTaskId;
      if (!row || !taskId) return;

      const plantedAmount = form.querySelector<HTMLInputElement>("input[name='plantedAmount']")?.value.trim() ?? "";
      const plantedLocation = form.querySelector<HTMLInputElement>("input[name='plantedLocation']")?.value.trim() ?? "";
      if (!plantedAmount) {
        setRowError(row, "Add the count first.");
        return;
      }
      if (!plantedLocation) {
        setRowError(row, "Add the location first.");
        return;
      }

      try {
        row.classList.add("saving");
        setRowError(row, "Saving…");
        const plantingLog = await toggleChecklist(taskId, "done", { plantedAmount, plantedLocation });
        markRow(row, true, plantingLog?.summary);
        setRowError(row, "");
      } catch (error) {
        row.classList.remove("saving");
        setRowError(row, error instanceof Error ? error.message : "Checklist failed.");
      }
    }

    window.addEventListener("click", handleClick, true);
    window.addEventListener("submit", handleSubmit, true);
    scheduleSettledRefreshes();

    return () => {
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("submit", handleSubmit, true);
    };
  }, []);

  return null;
}
