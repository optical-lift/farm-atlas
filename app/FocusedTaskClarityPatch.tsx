"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function isTaskPath(pathname: string) {
  return pathname === "/task" || pathname.startsWith("/task-focus/");
}

function activeTaskCard() {
  return document.querySelector<HTMLElement>(".atlas-task-ticket-card");
}

function isGerminationCard(card: HTMLElement) {
  const text = [
    card.querySelector("h1")?.textContent,
    card.querySelector(".atlas-task-page-kicker")?.textContent,
    card.querySelector(".atlas-task-page-time-row")?.textContent,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("germination") || text.includes("germination_check");
}

function hideTaskShelf(label: string) {
  document.querySelectorAll<HTMLElement>(".atlas-task-page-section").forEach((section) => {
    const heading = section.querySelector(".atlas-task-page-section-head span")?.textContent?.trim().toLowerCase();
    if (heading === label) section.style.display = "none";
  });
}

function cleanGerminationCard(card: HTMLElement) {
  if (!isGerminationCard(card)) return;

  card.querySelectorAll<HTMLElement>(".atlas-task-page-kicker small, .atlas-task-page-time-row span").forEach((node) => {
    if (node.textContent?.trim().toLowerCase() === "germination_check") node.textContent = "Germination";
  });

  const detail = card.querySelector<HTMLElement>(".atlas-task-detail-card");
  if (detail) detail.style.display = "none";
}

export default function FocusedTaskClarityPatch() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isTaskPath(pathname)) return;

    let stopped = false;
    function patch() {
      if (stopped) return;
      hideTaskShelf("next");
      hideTaskShelf("later");
      const card = activeTaskCard();
      if (card) cleanGerminationCard(card);
    }

    const observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    patch();
    const interval = window.setInterval(patch, 400);
    window.setTimeout(() => window.clearInterval(interval), 8000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
