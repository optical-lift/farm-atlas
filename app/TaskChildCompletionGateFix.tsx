"use client";

import { useEffect } from "react";

function checklistRows(card: HTMLElement) {
  return Array.from(card.querySelectorAll<HTMLElement>(".atlas-plant-check__item"));
}

function childChecklistIsComplete(card: HTMLElement) {
  const rows = checklistRows(card);
  return rows.length > 0 && rows.every((row) => row.classList.contains("is-done"));
}

function removeLegacyGateMessages(card: HTMLElement) {
  const nodes = Array.from(card.querySelectorAll<HTMLElement>("p, span, small, div"));
  nodes.forEach((node) => {
    if (node.children.length > 0) return;
    const value = node.textContent?.trim().toLowerCase() ?? "";
    if (value === "finish the checklist before marking the whole task done.") {
      node.remove();
    }
  });
}

function enableDoneButton(card: HTMLElement) {
  const doneButton = card.querySelector<HTMLButtonElement>(".atlas-task-primary-actions button.done");
  if (!doneButton) return null;

  doneButton.disabled = false;
  doneButton.removeAttribute("disabled");
  doneButton.removeAttribute("aria-disabled");
  doneButton.style.pointerEvents = "auto";
  doneButton.style.opacity = "1";
  removeLegacyGateMessages(card);
  return doneButton;
}

async function markChildDone(taskId: string) {
  const response = await fetch("/api/atlas/task-child-toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId, checklistStatus: "done" }),
  });

  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Checklist failed.");
  }
}

async function finishChecklistAndParent(card: HTMLElement, doneButton: HTMLButtonElement) {
  if (card.dataset.completingChecklist === "true") return;

  const remainingRows = checklistRows(card).filter((row) => !row.classList.contains("is-done"));
  if (!remainingRows.length) return;

  card.dataset.completingChecklist = "true";
  doneButton.disabled = true;
  doneButton.setAttribute("aria-busy", "true");
  const originalLabel = doneButton.textContent;
  doneButton.textContent = "Finishing…";

  try {
    const taskIds = remainingRows
      .map((row) => row.dataset.childTaskId?.trim())
      .filter((taskId): taskId is string => Boolean(taskId));

    if (taskIds.length !== remainingRows.length) {
      throw new Error("One or more checklist rows could not be identified.");
    }

    for (const taskId of taskIds) {
      await markChildDone(taskId);
    }

    doneButton.dataset.checklistBypass = "true";
    doneButton.disabled = false;
    doneButton.removeAttribute("aria-busy");
    doneButton.textContent = originalLabel;
    doneButton.click();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checklist failed.";
    window.alert(`Atlas could not finish the checklist: ${message}`);
    doneButton.disabled = false;
    doneButton.removeAttribute("aria-busy");
    doneButton.textContent = originalLabel;
  } finally {
    delete card.dataset.completingChecklist;
  }
}

function applyFix() {
  if (window.location.pathname !== "/task") return;

  const cards = Array.from(document.querySelectorAll<HTMLElement>(".atlas-task-ticket-card"));
  cards.forEach((card) => {
    const heading = card.querySelector("h1")?.textContent?.trim().toLowerCase() ?? "";
    card.classList.toggle("atlas-task-ticket-card--weeding", heading.includes("weeding"));

    const rows = checklistRows(card);
    if (!rows.length) return;

    enableDoneButton(card);
  });
}

export default function TaskChildCompletionGateFix() {
  useEffect(() => {
    if (window.location.pathname !== "/task") return;

    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        applyFix();
      });
    };

    const handleDoneClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const doneButton = target.closest<HTMLButtonElement>(".atlas-task-primary-actions button.done");
      if (!doneButton) return;

      const card = doneButton.closest<HTMLElement>(".atlas-task-ticket-card");
      if (!card || !checklistRows(card).length) return;

      if (doneButton.dataset.checklistBypass === "true") {
        delete doneButton.dataset.checklistBypass;
        return;
      }

      if (childChecklistIsComplete(card)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void finishChecklistAndParent(card, doneButton);
    };

    const observer = new MutationObserver(queue);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "aria-disabled"],
    });

    document.addEventListener("click", handleDoneClick, true);
    queue();
    const interval = window.setInterval(applyFix, 500);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleDoneClick, true);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
