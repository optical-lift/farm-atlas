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

function ruleText(item: AtlasUnifiedMaintenanceItem) {
  const weather = Object.entries(item.weather_restrictions ?? {}).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`);
  const equipment = item.equipment_requirements?.length ? `equipment: ${item.equipment_requirements.join(", ")}` : "";
  return [...weather, equipment].filter(Boolean).join(" · ");
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

export default function UnifiedMaintenancePage() {
  const [items, setItems] = useState<AtlasUnifiedMaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDate(params.get("date") || todayIso());
    setTypeFilter(params.get("type"));
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

  const filtered = useMemo(() => typeFilter ? items.filter((item) => item.maintenance_type === typeFilter) : items, [items, typeFilter]);
  const groups = useMemo(() => {
    const grouped = new Map<string, AtlasUnifiedMaintenanceItem[]>();
    filtered.forEach((item) => grouped.set(item.maintenance_type, [...(grouped.get(item.maintenance_type) ?? []), item]));
    return Array.from(grouped.entries()).sort(([, a], [, b]) => Math.max(...b.map((item) => item.effective_priority_score)) - Math.max(...a.map((item) => item.effective_priority_score)));
  }, [filtered]);

  const morning = filtered.filter((item) => item.window_key === "morning");
  const evening = filtered.filter((item) => item.window_key === "evening");

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Maintenance</span></Link>
          <span className="atlas-weather-line">condition · cadence · capacity</span>
          <Link href={`/day?date=${date}`} className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>
        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero"><div><strong>{typeFilter ? filtered[0]?.collection_label ?? "Maintenance" : "Unified Maintenance Plan"}</strong><span>{prettyDate(date)}</span></div><p>{loading ? "Building plan" : `${filtered.length} objects · ${totalMinutes(filtered)} minutes`}</p></section>
          <section className="atlas-overview-stat-grid" aria-label="Maintenance plan stats"><article><strong>{loading ? "…" : groups.length}</strong><span>collections</span></article><article><strong>{loading ? "…" : totalMinutes(morning)}</strong><span>morning min</span></article><article><strong>{loading ? "…" : totalMinutes(evening)}</strong><span>evening min</span></article><article><strong>{loading ? "…" : filtered.filter((item) => item.must_precede_task).length}</strong><span>unlock work</span></article></section>
          <section className="atlas-overview-summary-line"><p>Atlas derives these collections from canonical farm objects. Weather rules, equipment, cadence, condition, dependencies, completion feedback, and labor windows travel with each maintenance type.</p></section>
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading the unified maintenance plan.</div> : null}
          {!loading && !error ? <section className="atlas-overview-zone-list atlas-work-collection-list">
            {groups.map(([type, collectionItems]) => <section key={type} className="atlas-overview-zone-card atlas-work-collection-section">
              <summary><div><strong>{collectionItems[0].collection_label}</strong><span>{totalMinutes(collectionItems)} minutes</span></div><b>{collectionItems.length} {collectionItems.length === 1 ? "object" : "objects"}</b></summary>
              <div className="atlas-overview-task-list">
                {collectionItems.sort((a, b) => a.window_key.localeCompare(b.window_key) || a.sequence_in_window - b.sequence_in_window).map((item) => {
                  const busy = busyId === item.maintenance_object_id;
                  return <article key={item.maintenance_object_id} className="atlas-overview-task-card atlas-work-collection-task-card due">
                    <div><strong>{item.object_label}</strong><span>{item.zone_label ?? "Elm Farm"}</span></div>
                    <em>{item.window_key} · {item.estimated_minutes} min · {item.condition}</em>
                    <p>{item.priority_reasons.join(" · ") || "routine maintenance"}</p>
                    {ruleText(item) ? <p>{ruleText(item)}</p> : null}
                    {item.dependent_task_labels.length ? <p><strong>Unlocks:</strong> {item.dependent_task_labels.join(" · ")}</p> : null}
                    <div className="atlas-maintenance-control-row" aria-label={`Completion for ${item.object_label}`}><button type="button" disabled={busy} onClick={() => void record(item, "fully_completed")}>Fully completed</button><button type="button" disabled={busy} onClick={() => void record(item, "partially_completed")}>Partially completed</button><button type="button" disabled={busy} onClick={() => void record(item, "heavier_reset")}>Heavier than expected</button></div>
                  </article>;
                })}
                {collectionItems[0].collection_path !== `/collections/maintenance?type=${type}` ? <Link className="atlas-day-task-card atlas-work-collection-day-card" href={collectionItems[0].collection_path}><strong>Open {collectionItems[0].collection_label}</strong><span>Dedicated collection</span><em>View this maintenance type</em></Link> : null}
              </div>
            </section>)}
            {!groups.length ? <div className="atlas-task-page-empty">No canonical maintenance fits this day&apos;s available windows.</div> : null}
          </section> : null}
        </div>
      </section>
    </main>
  );
}
