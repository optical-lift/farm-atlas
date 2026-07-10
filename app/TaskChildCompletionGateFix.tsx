"use client";

import { useEffect } from "react";

function childChecklistIsComplete(card: HTMLElement) {
  const rows = Array.from(card.querySelectorAll<HTMLElement>(".atlas-plant-check__item"));
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

function applyFix() {
  if (window.location.pathname !== "/task") return;

  const cards = Array.from(document.querySelectorAll<HTMLElement>(".atlas-task-ticket-card"));
  cards.forEach((card) => {
    const heading = card.querySelector("h1")?.textContent?.trim().toLowerCase() ?? "";
    card.classList.toggle("atlas-task-ticket-card--weeding", heading.includes("weeding"));

    if (!childChecklistIsComplete(card)) return;

    const doneButton = card.querySelector<HTMLButtonElement>(".atlas-task-primary-actions button.done");
    if (!doneButton) return;

    doneButton.disabled = false;
    doneButton.removeAttribute("disabled");
    doneButton.removeAttribute("aria-disabled");
    doneButton.style.pointerEvents = "auto";
    doneButton.style.opacity = "1";
    removeLegacyGateMessages(card);
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

    const observer = new MutationObserver(queue);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "aria-disabled"],
    });

    queue();
    const interval = window.setInterval(applyFix, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
