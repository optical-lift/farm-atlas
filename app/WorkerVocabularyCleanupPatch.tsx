"use client";

import { useEffect } from "react";

const hiddenPhrases = [
  "mow by thursday",
  "friday–sunday visibility",
  "friday-sunday visibility",
  "if it was just mowed",
  "skip to the next useful thursday",
  "top of list",
  "after weeding",
  "last thing",
  "morning first",
  "first pass",
  "midday flex",
  "this morning only",
  "then move on to the rest of the day",
];

function isPlannerText(value: string) {
  const lower = value.trim().toLowerCase();
  return hiddenPhrases.some((phrase) => lower.includes(phrase));
}

function cleanSegmentedText(value: string) {
  const parts = value.split("·").map((part) => part.trim()).filter(Boolean);
  const kept = parts.filter((part) => !isPlannerText(part));
  return kept.join(" · ");
}

function applyCleanup() {
  document.querySelectorAll<HTMLElement>(
    ".atlas-task-detail-card p, .atlas-task-page-row small, .atlas-day-task-card span, .atlas-day-route-box span"
  ).forEach((node) => {
    const current = node.textContent?.trim() ?? "";
    if (!current) return;

    if (isPlannerText(current)) {
      const cleaned = cleanSegmentedText(current);
      if (cleaned && cleaned !== current) {
        node.textContent = cleaned;
      } else {
        node.style.display = "none";
      }
    }
  });

  document.querySelectorAll<HTMLElement>(".atlas-task-detail-card").forEach((card) => {
    const visibleLines = Array.from(card.querySelectorAll<HTMLElement>("p")).filter(
      (line) => line.style.display !== "none" && Boolean(line.textContent?.trim())
    );
    if (visibleLines.length === 0) card.style.display = "none";
  });
}

export default function WorkerVocabularyCleanupPatch() {
  useEffect(() => {
    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        applyCleanup();
      });
    };

    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    queue();

    return () => observer.disconnect();
  }, []);

  return null;
}
