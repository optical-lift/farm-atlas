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

function rankItems(items: AtlasUnifiedMaintenanceItem[]) {
  return [...items].sort((a, b) => {
    if (a.owner_priority !== b.owner_priority) return b.owner_priority - a.owner_priority;
    if (a.must_precede_task !== b.must_precede_task) return Number(b.must_precede_task) - Number(a.must_precede_task);
    if (a.effective_priority_score !== b.effective_priority_score) return b.effective_priority_score - a.effective_priority_score;
    const zoneCompare = (a.zone_label ?? "Elm Farm").localeCompare(b.zone_label ?? "Elm Farm");
    if (zoneCompare !== 0) return zoneCompare;
    return a.sequence_in_window - b.sequence_in_window;
  });
}

function fillWindow(items: AtlasUnifiedMaintenanceItem[], capacity: number) {
  const chosen: AtlasUnifiedMaintenanceItem[] = [];
  let used = 0;
  let currentZone = "";
  const remaining = rankItems(items);

  while (remaining.length) {
    const fitting = remaining.filter((item) => used + item.estimated_minutes <= capacity);
    if (!fitting.length) break;
    const nearby = fitting.find((item) => currentZone && (item.zone_label ?? "Elm Farm") === currentZone);
    const next = nearby ?? fitting[0];
    chosen.push(next);
    used += next.estimated_minutes;
    currentZone = next.zone_label ?? "Elm Farm";
    remaining.splice(remaining.indexOf(next), 1);
  }

  return chosen;
}

async function completeMaintenance(maintenanceObjectId: string, outcome: "fully_completed" | "partially_completed" | "heavier_reset", actualMinutes: number, revisedTotalMinutes?: number) {
  const response = await fetch("/api/atlas/maintenance-completion", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ maintenanceObjectId, outcome, actualMinutes, revisedTotalMinutes: revisedTotalMinutes ?? null, source: "maintenance_task_runner" }),
  });
  const data = await response.json() as { ok: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Maintenance completion failed.");
}

export default function UnifiedMaintenancePage() {
  const [items, setItems] = useState<AtlasUnifiedMaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const significantDayWork = items.some((item) => item.significant_day_work);
  const defaultMorningCapacity = 120;
  const defaultEveningCapacity = significantDayWork ? 60 : 120;
  const morningCapacity = Math.max(
    defaultMorningCapacity,
    ...items.filter((item) => item.window_key === "morning").map((item) => item.window_minutes),
  );
  const eveningCapacity = Math.max(
    defaultEveningCapacity,
    ...items.filter((item) => item.window_key === "evening").map((item) => item.window_minutes),
  );
  const balancedItems = useMemo(() => {
    const morning = fillWindow(items.filter((item) => item.window_key === "morning"), morningCapacity);
    const usedIds = new Set(morning.map((item) => item.maintenance_object_id));
    const eveningPool = items.filter((item) => item.window_key === "evening" && !usedIds.has(item.maintenance_object_id));
    return [...morning, ...fillWindow(eveningPool, eveningCapacity)];
  }, [items, morningCapacity, eveningCapacity]);

  useEffect(() => {
    if (!balancedItems.length) {
      setActiveId(null);
      return;
    }
    if (!activeId || !balancedItems.some((item) => item.maintenance_object_id === activeId)) {
      setActiveId(balancedItems[0].maintenance_object_id);
    }
  }, [activeId, balancedItems]);

  const activeIndex = Math.max(0, balancedItems.findIndex((item) => item.maintenance_object_id === activeId));
  const activeItem = balancedItems[activeIndex] ?? null;
  const morning = balancedItems.filter((item) => item.window_key === "morning");
  const evening = balancedItems.filter((item) => item.window_key === "evening");
  const tools = activeItem ? unique(activeItem.equipment_requirements ?? []) : [];

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

  function queueSection(label: string, queue: AtlasUnifiedMaintenanceItem[], capacity: number) {
    return (
      <section className="atlas-task-page-section">
        <div className="atlas-task-page-section-head"><span>{label}</span><small>{queue.length} tasks · {totalMinutes(queue)} / {capacity} min</small></div>
        {queue.length ? queue.map((item) => (
          <button
            key={item.maintenance_object_id}
            type="button"
            className={item.maintenance_object_id === activeItem?.maintenance_object_id ? "atlas-task-page-row selected" : "atlas-task-page-row"}
            onClick={() => setActiveId(item.maintenance_object_id)}
          >
            <div><strong>{actionLabel(item)} {item.object_label}</strong><span>{item.zone_label ?? "Elm Farm"} · {item.estimated_minutes} min</span></div>
            {item.must_precede_task ? <small>Unlocks work</small> : null}
          </button>
        )) : <p className="atlas-task-page-muted">No {label.toLowerCase()} maintenance scheduled.</p>}
      </section>
    );
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Maintenance</span></Link>
          <span className="atlas-weather-line">{prettyDate(date)}</span>
          <Link href={`/day?date=${date}`} className="atlas-note-plus" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body">
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Building today&apos;s maintenance route.</div> : null}

          {!loading && activeItem ? (
            <>
              <section className="atlas-task-page-hero atlas-task-progress-hero">
                <span>{activeItem.window_key === "morning" ? "Morning route" : "Evening route"} · Task {activeIndex + 1} of {balancedItems.length}</span>
                <div className="atlas-progress-hero-head">
                  <h2>{actionLabel(activeItem)} {activeItem.object_label}</h2>
                  <small>{activeItem.zone_label ?? "Elm Farm"} · {activeItem.estimated_minutes} minutes</small>
                </div>
                <div className="atlas-progress-report">
                  <div className="atlas-progress-next-line"><span>Remaining today</span><strong>{totalMinutes(balancedItems)} minutes across {balancedItems.length} tasks</strong></div>
                  {activeItem.dependent_task_labels.length ? <div className="atlas-progress-next-line"><span>Completing this unlocks</span><strong>{activeItem.dependent_task_labels.join(" · ")}</strong></div> : null}
                </div>
              </section>

              <article className="atlas-task-page-active atlas-task-ticket-card">
                <div className="atlas-task-page-kicker"><span>Up Now</span><small>{activeItem.collection_label}</small></div>
                <h1>{actionLabel(activeItem).toUpperCase()} {activeItem.object_label.toUpperCase()}</h1>
                <div className="atlas-task-page-time-row"><span>{activeItem.window_key === "morning" ? "Morning" : "Evening"}</span><span>{activeItem.estimated_minutes} min</span><span>{activeItem.condition}</span></div>
                <section className="atlas-task-place-card"><small>Location</small><strong>{activeItem.zone_label ?? "Elm Farm"}</strong></section>
                {tools.length ? <section className="atlas-task-detail-card"><strong>Tools</strong>{tools.map((tool) => <p key={tool}>{tool}</p>)}</section> : null}
                {activeItem.priority_reasons.length ? <section className="atlas-task-detail-card"><strong>Why this is next</strong><p>{activeItem.priority_reasons.slice(0, 3).join(" · ")}</p></section> : null}
                <div className="atlas-task-page-actions atlas-task-primary-actions">
                  <button type="button" className="done" disabled={busyId === activeItem.maintenance_object_id} onClick={() => void record(activeItem, "fully_completed")}>{busyId === activeItem.maintenance_object_id ? "Saving" : "Done"}</button>
                  <button type="button" disabled={busyId === activeItem.maintenance_object_id} onClick={() => void record(activeItem, "partially_completed")}>Partly done</button>
                </div>
                <div className="atlas-task-unfinished-grid quiet">
                  <button type="button" disabled={busyId === activeItem.maintenance_object_id} onClick={() => void record(activeItem, "heavier_reset")}>Heavier than expected</button>
                </div>
              </article>

              {queueSection("Morning", morning, morningCapacity)}
              {queueSection("Evening", evening, eveningCapacity)}
            </>
          ) : null}

          {!loading && !balancedItems.length ? <div className="atlas-task-page-empty">No canonical maintenance fits today&apos;s available labor windows.</div> : null}
        </div>
      </section>
    </main>
  );
}
