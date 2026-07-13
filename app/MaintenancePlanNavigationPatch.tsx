"use client";

import { useEffect } from "react";

function currentDate() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("date");
  if (explicit) return explicit;
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

async function loadSummary(date: string) {
  const response = await fetch(`/api/atlas/maintenance-plan?date=${encodeURIComponent(date)}&days=1`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { items?: Array<{ maintenance_type: string; estimated_minutes: number; object_label: string }> };
  const items = data.items ?? [];
  return {
    collections: new Set(items.map((item) => item.maintenance_type)).size,
    objects: items.length,
    minutes: items.reduce((sum, item) => sum + item.estimated_minutes, 0),
    preview: items.slice(0, 2).map((item) => item.object_label).join(" · ") || "No maintenance fits today’s windows",
  };
}

function makeLink(date: string, summary: NonNullable<Awaited<ReturnType<typeof loadSummary>>>, className: string) {
  const link = document.createElement("a");
  link.href = `/collections/maintenance?date=${encodeURIComponent(date)}`;
  link.className = `${className} atlas-unified-maintenance-link`;
  link.dataset.atlasMaintenancePlan = "true";
  link.innerHTML = `<strong>Maintenance Plan</strong><span>${summary.collections} collections · ${summary.objects} objects · ${summary.minutes} min</span><em>${summary.preview}</em>`;
  return link;
}

export default function MaintenancePlanNavigationPatch() {
  useEffect(() => {
    if (window.location.pathname !== "/" && window.location.pathname !== "/day") return;
    let stopped = false;
    let running = false;

    const apply = async () => {
      if (running || stopped || document.querySelector("[data-atlas-maintenance-plan='true']")) return;
      running = true;
      try {
        const date = currentDate();
        const summary = await loadSummary(date);
        if (!summary || stopped) return;
        if (window.location.pathname === "/day") {
          const grid = document.querySelector<HTMLElement>(".atlas-day-route-grid");
          if (grid) grid.appendChild(makeLink(date, summary, "atlas-day-route-box"));
          const list = document.querySelector<HTMLElement>(".atlas-day-work-order-list");
          if (list && !list.querySelector("[data-atlas-maintenance-plan='true']")) list.appendChild(makeLink(date, summary, "atlas-day-task-card atlas-work-collection-day-card"));
        } else {
          const heroGrid = document.querySelector<HTMLElement>(".atlas-home-task-grid, .atlas-dashboard-task-grid, .atlas-week-grid");
          if (heroGrid) heroGrid.appendChild(makeLink(date, summary, "atlas-day-route-box"));
          else {
            const body = document.querySelector<HTMLElement>(".atlas-dashboard-phone");
            if (body) body.appendChild(makeLink(date, summary, "atlas-day-task-card atlas-work-collection-day-card"));
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
