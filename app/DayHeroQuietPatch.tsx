"use client";

import { useEffect } from "react";

function parseCount(value: string) {
  const match = value.match(/(\d+)\s+(?:task|tasks|due)\b/i);
  return match ? Number(match[1]) : 0;
}

function cleanRouteMeta(value: string) {
  const count = parseCount(value);
  if (!count) return value;
  if (/\bdue\b/i.test(value)) return `${count} due`;
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

function isQuietRouteBox(box: HTMLElement) {
  const value = box.textContent?.toLowerCase() ?? "";
  return value.includes("kids chore") || value.includes("feed chickens") || value.includes("feed · kids chores");
}

function applyDayHeroCleanup() {
  if (window.location.pathname !== "/day") return;

  const hero = document.querySelector<HTMLElement>(".atlas-day-route-hero");
  if (!hero) return;

  let hiddenTaskCount = 0;
  const boxes = Array.from(hero.querySelectorAll<HTMLElement>(".atlas-day-route-box"));

  boxes.forEach((box) => {
    if (isQuietRouteBox(box)) {
      const meta = box.querySelector<HTMLElement>("span")?.textContent ?? "";
      hiddenTaskCount += parseCount(meta) || 1;
      box.remove();
      return;
    }

    const meta = box.querySelector<HTMLElement>("span");
    if (meta?.textContent) meta.textContent = cleanRouteMeta(meta.textContent);
  });

  const countPill = hero.querySelector<HTMLElement>(".atlas-day-route-count-pill");
  if (countPill && hiddenTaskCount > 0) {
    const current = Number(countPill.textContent?.trim());
    if (Number.isFinite(current)) countPill.textContent = String(Math.max(0, current - hiddenTaskCount));
  }
}

export default function DayHeroQuietPatch() {
  useEffect(() => {
    if (window.location.pathname !== "/day") return;

    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        applyDayHeroCleanup();
      });
    };

    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    queue();

    return () => observer.disconnect();
  }, []);

  return null;
}
