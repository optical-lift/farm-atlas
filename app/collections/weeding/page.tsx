"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasMaintenancePreview,
  setAtlasMaintenanceCondition,
  setAtlasMaintenanceOwnerOverride,
  type AtlasMaintenancePreviewItem,
} from "@/lib/atlas/maintenance-preview-client";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function totalMinutes(items: AtlasMaintenancePreviewItem[]) {
  return items.reduce((total, item) => total + item.estimated_minutes, 0);
}

type Condition = "maintained" | "moderate" | "heavy" | "reset";

type DayWindowProps = {
  title: string;
  items: AtlasMaintenancePreviewItem[];
  fallbackMinutes: number;
  busyId: string | null;
  onOverride: (item: AtlasMaintenancePreviewItem) => void;
  onCondition: (item: AtlasMaintenancePreviewItem, condition: Condition) => void;
};

function DayWindow({
  title,
  items,
  fallbackMinutes,
  busyId,
  onOverride,
  onCondition,
}: DayWindowProps) {
  const capacity = items[0]?.window_minutes ?? fallbackMinutes;
  const used = totalMinutes(items);

  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{used} of {capacity} minutes</span>
        </div>
        <b>{items.length} {items.length === 1 ? "area" : "areas"}</b>
      </summary>

      <div className="atlas-overview-task-list">
        {items.length ? items.map((item) => {
          const busy = busyId === item.maintenance_object_id;
          return (
            <article
              key={item.maintenance_object_id}
              className="atlas-overview-task-card atlas-work-collection-task-card due"
            >
              <div>
                <strong>{item.object_label}</strong>
                <span>{item.zone_label ?? "Elm Farm"}</span>
              </div>
              <em>{item.estimated_minutes} min · {item.condition} · score {Math.round(item.effective_priority_score)}</em>
              <p>{item.priority_reasons.length ? item.priority_reasons.join(" · ") : "routine maintenance"}</p>
              {item.dependent_task_labels.length ? (
                <p><strong>Unlocks:</strong> {item.dependent_task_labels.join(" · ")}</p>
              ) : null}
              <div className="atlas-maintenance-control-row" aria-label={`Controls for ${item.object_label}`}>
                <button type="button" disabled={busy} onClick={() => onOverride(item)}>
                  {item.owner_priority > 0 ? "Remove owner override" : "Move to front"}
                </button>
                <button type="button" disabled={busy} onClick={() => onCondition(item, "maintained")}>Maintained</button>
                <button type="button" disabled={busy} onClick={() => onCondition(item, "moderate")}>Moderate</button>
                <button type="button" disabled={busy} onClick={() => onCondition(item, "heavy")}>Heavy</button>
                <button type="button" disabled={busy} onClick={() => onCondition(item, "reset")}>Needs heavier reset</button>
              </div>
            </article>
          );
        }) : (
          <p className="atlas-task-page-muted">No object fits this labor window.</p>
        )}
      </div>
    </section>
  );
}

export default function WeedingPreviewPage() {
  const [items, setItems] = useState<AtlasMaintenancePreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const startDate = todayIso();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasMaintenancePreview(startDate, 7, "weed");
        setItems(response.items ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Weeding preview failed.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [startDate, revision]);

  async function changeOverride(item: AtlasMaintenancePreviewItem) {
    try {
      setBusyId(item.maintenance_object_id);
      setError(null);
      await setAtlasMaintenanceOwnerOverride(item.maintenance_object_id, item.owner_priority <= 0);
      setRevision((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Owner override failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function changeCondition(item: AtlasMaintenancePreviewItem, condition: Condition) {
    try {
      setBusyId(item.maintenance_object_id);
      setError(null);
      await setAtlasMaintenanceCondition(item.maintenance_object_id, condition);
      setRevision((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Condition update failed.");
    } finally {
      setBusyId(null);
    }
  }

  const days = useMemo(() => {
    const grouped = new Map<string, AtlasMaintenancePreviewItem[]>();
    items.forEach((item) => {
      grouped.set(item.schedule_date, [...(grouped.get(item.schedule_date) ?? []), item]);
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const scheduledMinutes = totalMinutes(items);
  const scheduledObjects = new Set(items.map((item) => item.maintenance_object_id)).size;
  const dependencyObjects = new Set(
    items.filter((item) => item.dependent_task_labels.length > 0).map((item) => item.maintenance_object_id),
  ).size;
  const ownerOverrides = new Set(
    items.filter((item) => item.owner_priority > 0).map((item) => item.maintenance_object_id),
  ).size;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Weeding Preview</span>
          </Link>
          <span className="atlas-weather-line">Phase 3 priority engine</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div>
              <strong>7-Day Weeding Preview</strong>
              <span>Starting {prettyDate(startDate)}</span>
            </div>
            <p>Priority and condition controls update canonical objects. The preview still creates no daily tasks.</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Weeding scheduler preview stats">
            <article><strong>{loading ? "…" : scheduledObjects}</strong><span>objects</span></article>
            <article><strong>{loading ? "…" : scheduledMinutes}</strong><span>minutes</span></article>
            <article><strong>{loading ? "…" : dependencyObjects}</strong><span>unlock work</span></article>
            <article><strong>{loading ? "…" : ownerOverrides}</strong><span>overrides</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>Owner overrides move the canonical object to the front. Condition changes recalculate effort. Blocked planting work is attached directly to the object and shown by name.</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Building the dependency-aware weeding preview.</div> : null}

          {!loading && !error ? (
            <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label="Seven day weeding preview">
              {days.length ? days.map(([date, dayItems]) => {
                const morning = dayItems
                  .filter((item) => item.window_key === "morning")
                  .sort((a, b) => a.sequence_in_window - b.sequence_in_window);
                const evening = dayItems
                  .filter((item) => item.window_key === "evening")
                  .sort((a, b) => a.sequence_in_window - b.sequence_in_window);
                const significant = dayItems.some((item) => item.significant_day_work);

                return (
                  <section key={date} className="atlas-work-collection-day">
                    <section className="atlas-overview-hero atlas-work-collection-hero">
                      <div>
                        <strong>{prettyDate(date)}</strong>
                        <span>{significant ? "Substantial workday" : "Light-day capacity"}</span>
                      </div>
                      <p>{totalMinutes(dayItems)} maintenance minutes</p>
                    </section>
                    <DayWindow
                      title="Morning Window"
                      items={morning}
                      fallbackMinutes={120}
                      busyId={busyId}
                      onOverride={changeOverride}
                      onCondition={changeCondition}
                    />
                    <DayWindow
                      title="Evening Window"
                      items={evening}
                      fallbackMinutes={significant ? 60 : 120}
                      busyId={busyId}
                      onOverride={changeOverride}
                      onCondition={changeCondition}
                    />
                  </section>
                );
              }) : (
                <div className="atlas-task-page-empty">No eligible weeding objects fit the next seven days.</div>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
