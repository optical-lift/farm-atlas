"use client";

import { useEffect } from "react";

type MaintenanceItem = {
  maintenance_type: string;
  collection_label: string;
  window_key: string;
  estimated_minutes: number;
  object_label: string;
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
  return Array.from(new Set(items.map((item) => item.collection_label)))
    .slice(0, 3)
    .join(" · ");
}

async function loadSummary(date: string) {
  const response = await fetch(`/api/atlas/maintenance-plan?date=${encodeURIComponent(date)}&days=1`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { items?: MaintenanceItem[] };
  const items = data.items ?? [];
  const morning = items.filter((item) => item.window_key === "morning");
  const evening = items.filter((item) => item.window_key === "evening");
  return {
    collections: new Set(items.map((item) => item.maintenance_type)).size,
    objects: items.length,
    minutes: items.reduce((sum, item) => sum + item.estimated_minutes, 0),
    morningMinutes: morning.reduce((sum, item) => sum + item.estimated_minutes, 0),
    eveningMinutes: evening.reduce((sum, item) => sum + item.estimated_minutes, 0),
    morningLabels: compactLabels(morning),
    eveningLabels: compactLabels(evening),
    preview: items.slice(0, 4).map((item) => item.object_label).join(" · ") || "No maintenance fits today’s windows",
  };
}

function makeLink(date: string, summary: NonNullable<Awaited<ReturnType<typeof loadSummary>>>, className: string) {
  const link = document.createElement("a");
  link.href = `/collections/maintenance?date=${encodeURIComponent(date)}`;
  link.className = `${className} atlas-unified-maintenance-link`;
  link.dataset.atlasMaintenancePlan = "true";
  const flow = [
    summary.morningMinutes ? `Morning ${summary.morningMinutes} min${summary.morningLabels ? ` · ${summary.morningLabels}` : ""}` : "",
    summary.eveningMinutes ? `Evening ${summary.eveningMinutes} min${summary.eveningLabels ? ` · ${summary.eveningLabels}` : ""}` : "",
  ].filter(Boolean).join(" · ");
  link.innerHTML = `<strong>Maintenance Plan</strong><span>${flow || `${summary.collections} collections · ${summary.minutes} min`}</span><em>${summary.preview}</em>`;
  return link;
}

function isLegacyMaintenanceCard(element: HTMLElement) {
  if (element.dataset.atlasMaintenancePlan === "true") return false;
  const value = (element.textContent ?? "").toLowerCase();
  return /\b(weed|weeding|mow|mowing|water|watering|spray|spraying|deadhead|deadheading|edge|edging|prune|pruning|pathway cleanup|venue landscape)\b/.test(value);
}

function collapseMaintenanceCards(container: HTMLElement, summaryLink: HTMLElement) {
  const cards = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const legacy = cards.filter(isLegacyMaintenanceCard);
  const existing = container.querySelector<HTMLElement>("[data-atlas-maintenance-plan='true']");

  if (!existing) {
    const anchor = legacy[0] ?? cards[0] ?? null;
    if (anchor) container.insertBefore(summaryLink, anchor);
    else container.appendChild(summaryLink);
  }

  legacy.forEach((card) => {
    card.dataset.atlasCollapsedMaintenance = "true";
    card.style.display = "none";
  });
}

export default function MaintenancePlanNavigationPatch() {
  useEffect(() => {
    if (window.location.pathname !== "/" && window.location.pathname !== "/day") return;
    let stopped = false;
    let running = false;

    const apply = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const date = currentDate();
        const summary = await loadSummary(date);
        if (!summary || stopped) return;

        if (window.location.pathname === "/day") {
          const routeGrids = Array.from(document.querySelectorAll<HTMLElement>(".atlas-day-route-grid"));
          routeGrids.forEach((grid) => collapseMaintenanceCards(grid, makeLink(date, summary, "atlas-day-route-box")));

          const workOrderList = document.querySelector<HTMLElement>(".atlas-day-work-order-list");
          if (workOrderList) collapseMaintenanceCards(workOrderList, makeLink(date, summary, "atlas-day-task-card atlas-work-collection-day-card"));

          document.querySelectorAll<HTMLElement>(".atlas-day-route-group .atlas-day-zone-group").forEach((group) => {
            if (Array.from(group.children).some((child) => child instanceof HTMLElement && isLegacyMaintenanceCard(child))) {
              collapseMaintenanceCards(group, makeLink(date, summary, "atlas-day-task-card atlas-work-collection-day-card"));
            }
          });
        } else {
          const containers = Array.from(document.querySelectorAll<HTMLElement>(
            ".atlas-home-task-grid, .atlas-dashboard-task-grid, .atlas-week-grid, .atlas-task-page-list, .atlas-dashboard-task-list",
          ));
          if (containers.length) {
            containers.forEach((container) => collapseMaintenanceCards(container, makeLink(date, summary, "atlas-day-task-card atlas-work-collection-day-card")));
          } else {
            const body = document.querySelector<HTMLElement>(".atlas-dashboard-phone");
            if (body && !body.querySelector("[data-atlas-maintenance-plan='true']")) {
              body.appendChild(makeLink(date, summary, "atlas-day-task-card atlas-work-collection-day-card"));
            }
          }
        }
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => void apply());
    observer.observe(document.body, { childList: true, subtree: true });
    void apply();
    return () => { stopped = true; observer.disconnect(); };
  }, []);
  return null;
}
