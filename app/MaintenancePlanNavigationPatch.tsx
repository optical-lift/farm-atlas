"use client";

import { useEffect } from "react";

type MaintenanceItem = {
  maintenance_type: string;
  collection_label: string;
  window_key: string;
  estimated_minutes: number;
  object_label: string;
};

type MaintenanceSummary = {
  date: string;
  collections: number;
  objects: number;
  minutes: number;
  morningMinutes: number;
  eveningMinutes: number;
  morningLabels: string;
  eveningLabels: string;
  preview: string;
};

function currentDate() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("date");
  if (explicit) return explicit;
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function compactLabels(items: MaintenanceItem[]) {
  return Array.from(new Set(items.map((item) => item.collection_label))).slice(0, 3).join(" · ");
}

async function loadSummary(date: string): Promise<MaintenanceSummary | null> {
  const response = await fetch(`/api/atlas/maintenance-plan?date=${encodeURIComponent(date)}&days=1`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { items?: MaintenanceItem[] };
  const items = data.items ?? [];
  const morning = items.filter((item) => item.window_key === "morning");
  const evening = items.filter((item) => item.window_key === "evening");
  return {
    date,
    collections: new Set(items.map((item) => item.maintenance_type)).size,
    objects: items.length,
    minutes: items.reduce((sum, item) => sum + item.estimated_minutes, 0),
    morningMinutes: Math.min(120, morning.reduce((sum, item) => sum + item.estimated_minutes, 0)),
    eveningMinutes: Math.min(120, evening.reduce((sum, item) => sum + item.estimated_minutes, 0)),
    morningLabels: compactLabels(morning),
    eveningLabels: compactLabels(evening),
    preview: items.slice(0, 4).map((item) => item.object_label).join(" · ") || "No maintenance fits today’s windows",
  };
}

function summaryMarkup(summary: MaintenanceSummary) {
  const flow = [
    summary.morningMinutes ? `Morning ${summary.morningMinutes} min` : "",
    summary.eveningMinutes ? `Evening ${summary.eveningMinutes} min` : "",
  ].filter(Boolean).join(" · ");
  return `<strong>Maintenance Plan</strong><span>${flow || `${summary.collections} collections`}</span><em>${summary.preview}</em>`;
}

function makeLink(summary: MaintenanceSummary, className: string) {
  const link = document.createElement("a");
  link.href = `/collections/maintenance?date=${encodeURIComponent(summary.date)}`;
  link.className = `${className} atlas-unified-maintenance-link`;
  link.dataset.atlasMaintenancePlan = "true";
  link.dataset.atlasMaintenanceDate = summary.date;
  link.innerHTML = summaryMarkup(summary);
  return link;
}

function isRealMaintenancePlanCard(element: HTMLElement) {
  return (element.textContent ?? "").toLowerCase().includes("maintenance plan");
}

function isLegacyMaintenanceCard(element: HTMLElement) {
  if (element.dataset.atlasMaintenancePlan === "true" || isRealMaintenancePlanCard(element)) return false;
  const value = (element.textContent ?? "").toLowerCase();
  return /(^|\s|·)(weed|weeding|priority weeding|mow|mowing|water|watering|spray|spraying|deadhead|deadheading|edge|edging|prune|pruning|pathway cleanup|venue landscape)(\s|·|$)/.test(value);
}

function wireRealPlanCards(summary: MaintenanceSummary) {
  document.querySelectorAll<HTMLAnchorElement>("a.atlas-day-task-card, a.atlas-run-sheet-box, a.atlas-day-route-box, a.atlas-task-forward-box").forEach((card) => {
    if (!isRealMaintenancePlanCard(card)) return;
    card.href = `/collections/maintenance?date=${encodeURIComponent(summary.date)}`;
    card.dataset.atlasMaintenancePlan = "true";
    card.dataset.atlasMaintenanceDate = summary.date;
  });
}

function collapseVisibleMaintenanceCards(summary: MaintenanceSummary) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    "a.atlas-day-task-card, a.atlas-run-sheet-box, a.atlas-day-route-box, a.atlas-task-forward-box",
  ));
  const legacy = candidates.filter(isLegacyMaintenanceCard);
  if (!legacy.length) return;

  const byParent = new Map<HTMLElement, HTMLElement[]>();
  legacy.forEach((card) => {
    const parent = card.parentElement;
    if (!parent) return;
    byParent.set(parent, [...(byParent.get(parent) ?? []), card]);
  });

  byParent.forEach((cards, parent) => {
    let summaryCard = parent.querySelector<HTMLElement>(":scope > [data-atlas-maintenance-plan='true']");
    if (!summaryCard) {
      const sourceClass = cards[0].className;
      summaryCard = makeLink(summary, sourceClass);
      parent.insertBefore(summaryCard, cards[0]);
    }

    cards.forEach((card) => {
      card.dataset.atlasCollapsedMaintenance = "true";
      card.hidden = true;
      card.style.setProperty("display", "none", "important");
    });
  });
}

function removeStaleSummaryCards(date: string) {
  document.querySelectorAll<HTMLElement>("[data-atlas-maintenance-plan='true']").forEach((card) => {
    if (card.dataset.atlasMaintenanceDate !== date && !isRealMaintenancePlanCard(card)) card.remove();
  });
}

export default function MaintenancePlanNavigationPatch() {
  useEffect(() => {
    let stopped = false;
    let running = false;
    let lastPath = "";
    let lastDate = "";

    const apply = async () => {
      if (running || stopped) return;
      const path = window.location.pathname;
      if (path !== "/" && path !== "/day") return;

      const date = currentDate();
      const routeChanged = path !== lastPath || date !== lastDate;
      lastPath = path;
      lastDate = date;
      if (routeChanged) removeStaleSummaryCards(date);

      running = true;
      try {
        const summary = await loadSummary(date);
        if (!summary || stopped || window.location.pathname !== path || currentDate() !== date) return;
        wireRealPlanCards(summary);
        // The day page already renders its canonical route collections and concrete tasks.
        // Collapsing those cards here can hide a task that is still represented in the hero.
        if (path === "/") collapseVisibleMaintenanceCards(summary);
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => void apply());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onNavigation = () => void apply();
    window.addEventListener("popstate", onNavigation);
    const interval = window.setInterval(() => void apply(), 500);
    void apply();

    return () => {
      stopped = true;
      observer.disconnect();
      window.removeEventListener("popstate", onNavigation);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
