"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchAtlasUnifiedMaintenancePlan, type AtlasUnifiedMaintenanceItem } from "@/lib/atlas/maintenance-plan-client";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function totalMinutes(items: AtlasUnifiedMaintenanceItem[]) {
  return items.reduce((sum, item) => sum + item.estimated_minutes, 0);
}

function actionLabel(item: AtlasUnifiedMaintenanceItem) {
  const labels: Record<string, string> = {
    weed: "Weed",
    mow: "Mow",
    edge: "Edge",
    prune: "Prune",
    spray: "Spray",
    deadhead: "Deadhead",
    water: "Water",
    pathway_cleanup: "Clean up",
    seasonal_bed_reset: "Reset",
    venue_landscape_preparation: "Prepare",
  };
  return labels[item.maintenance_type] ?? item.collection_label;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function completeMaintenance(maintenanceObjectId: string, outcome: "fully_completed" | "partially_completed" | "heavier_reset", actualMinutes: number, revisedTotalMinutes?: number) {
  const response = await fetch("/api/atlas/maintenance-completion", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ maintenanceObjectId, outcome, actualMinutes, revisedTotalMinutes: revisedTotalMinutes ?? null, source: "unified_maintenance_plan" }),
  });
  const data = await response.json() as { ok: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Maintenance completion failed.");
}

function RouteCard({ route, items, busyId, onRecord }: {
  route: string;
  items: AtlasUnifiedMaintenanceItem[];
  busyId: string | null;
  onRecord: (item: AtlasUnifiedMaintenanceItem, outcome: "fully_completed" | "partially_completed" | "heavier_reset") => void;
}) {
  const tools = unique(items.flatMap((item) => item.equipment_requirements ?? []));
  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div><strong>{route}</strong><span>{totalMinutes(items)} minutes</span></div>
        <b>{items.length} {items.length === 1 ? "stop" : "stops"}</b>
      </summary>
      <div className="atlas-overview-task-list">
        {items.map((item) => {
          const busy = busyId === item.maintenance_object_id;
          return (
            <article key={item.maintenance_object_id} className="atlas-overview-task-card atlas-work-collection-task-card due">
              <div>
                <strong>{actionLabel(item)} {item.object_label}</strong>
                <span>{item.collection_label} · {item.estimated_minutes} min · {item.condition}</span>
              </div>
              {item.dependent_task_labels.length ? <p><strong>Unlocks:</strong> {item.dependent_task_labels.join(" · ")}</p> : null}
              {item.priority_reasons.length ? <p>{item.priority_reasons.slice(0, 3).join(" · ")}</p> : null}
              <div className="atlas-maintenance-control-row" aria-label={`Completion for ${item.object_label}`}>
                <button type="button" disabled={busy} onClick={() => onRecord(item, "fully_completed")}>Done</button>
                <button type="button" disabled={busy} onClick={() => onRecord(item, "partially_completed")}>Partial</button>
                <button type="button" disabled={busy} onClick={() => onRecord(item, "heavier_reset")}>Heavier</button>
              </div>
            </article>
          );
        })}
        {tools.length ? <div className="atlas-overview-summary-line"><p><strong>Bring:</strong> {tools.join(" · ")}</p></div> : null}
      </div>
    </section>
  );
}

export default function UnifiedMaintenancePage() {
  const [items, setItems] = useState<AtlasUnifiedMaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDate(params.get("date") || todayIso());
  }, []);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchAtlasUnifiedMaintenancePlan(date, 1);
        setItems(result.items ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Maintenance plan failed.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [date, revision]);

  async function record(item: AtlasUnifiedMaintenanceItem, outcome: "fully_completed" | "partially_completed" | "heavier_reset") {
    const actualPrompt = outcome === "fully_completed" ? `Actual minutes for ${item.object_label}?` : outcome === "partially_completed" ? `Minutes completed on ${item.object_label}?` : "Minutes worked before discovering the heavier reset?";
    const actualValue = window.prompt(actualPrompt, String(item.estimated_minutes));
    if (actualValue === null) return;
    const actualMinutes = Math.max(0, Math.round(Number(actualValue)));
    if (!Number.isFinite(actualMinutes)) return;
    let revisedTotalMinutes: number | undefined;
    if (outcome === "heavier_reset") {
      const revisedValue = window.prompt("Revised total minutes needed?", String(Math.max(item.estimated_minutes, actualMinutes)));
      if (revisedValue === null) return;
      revisedTotalMinutes = Math.max(1, Math.round(Number(revisedValue)));
      if (!Number.isFinite(revisedTotalMinutes)) return;
    }
    try {
      setBusyId(item.maintenance_object_id);
      setError(null);
      await completeMaintenance(item.maintenance_object_id, outcome, actualMinutes, revisedTotalMinutes);
      setRevision((value) => value + 1);
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "Maintenance completion failed.");
    } finally {
      setBusyId(null);
    }
  }

  const windows = useMemo(() => ["morning", "evening"].map((windowKey) => {
    const windowItems = items.filter((item) => item.window_key === windowKey).sort((a, b) => a.sequence_in_window - b.sequence_in_window);
    const routes = new Map<string, AtlasUnifiedMaintenanceItem[]>();
    windowItems.forEach((item) => {
      const route = item.zone_label || "Elm Farm";
      routes.set(route, [...(routes.get(route) ?? []), item]);
    });
    return { windowKey, items: windowItems, routes: Array.from(routes.entries()) };
  }), [items]);

  const scheduled = totalMinutes(items);
  const collections = unique(items.map((item) => item.collection_label));
  const unlockCount = items.filter((item) => item.must_precede_task).length;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Maintenance</span></Link>
          <span className="atlas-weather-line">today&apos;s farm route</span>
          <Link href={`/day?date=${date}`} className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>
        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div><strong>Maintenance Plan</strong><span>{prettyDate(date)}</span></div>
            <p>{loading ? "Building today’s route" : `${scheduled} minutes remaining · ${collections.length} kinds of work`}</p>
          </section>
          <section className="atlas-overview-stat-grid" aria-label="Maintenance plan stats">
            <article><strong>{loading ? "…" : totalMinutes(windows[0].items)}</strong><span>morning min</span></article>
            <article><strong>{loading ? "…" : totalMinutes(windows[1].items)}</strong><span>evening min</span></article>
            <article><strong>{loading ? "…" : unique(items.map((item) => item.zone_label || "Elm Farm")).length}</strong><span>farm routes</span></article>
            <article><strong>{loading ? "…" : unlockCount}</strong><span>unlock work</span></article>
          </section>
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading today&apos;s maintenance routes.</div> : null}
          {!loading && !error ? <section className="atlas-overview-zone-list atlas-work-collection-list">
            {windows.map(({ windowKey, items: windowItems, routes }) => (
              <section key={windowKey} className="atlas-day-route-group atlas-day-work-collection-group">
                <h3>{windowKey === "morning" ? "Morning" : "Evening"} · {totalMinutes(windowItems)} minutes</h3>
                {routes.map(([route, routeItems]) => <RouteCard key={`${windowKey}-${route}`} route={route} items={routeItems} busyId={busyId} onRecord={(item, outcome) => void record(item, outcome)} />)}
                {!routes.length ? <div className="atlas-task-page-empty">No {windowKey} maintenance scheduled.</div> : null}
              </section>
            ))}
            {!items.length ? <div className="atlas-task-page-empty">No canonical maintenance fits this day&apos;s available labor windows.</div> : null}
          </section> : null}
        </div>
      </section>
    </main>
  );
}
