"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasMaintenancePreview,
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

function DayWindow({
  title,
  items,
  fallbackMinutes,
}: {
  title: string;
  items: AtlasMaintenancePreviewItem[];
  fallbackMinutes: number;
}) {
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
        {items.length ? items.map((item) => (
          <article
            key={item.maintenance_object_id}
            className="atlas-overview-task-card atlas-work-collection-task-card due"
          >
            <div>
              <strong>{item.object_label}</strong>
              <span>{item.zone_label ?? "Elm Farm"}</span>
            </div>
            <em>{item.estimated_minutes} min · {item.condition}</em>
            <p>{item.priority_reasons.length ? item.priority_reasons.join(" · ") : "routine maintenance"}</p>
          </article>
        )) : (
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
  }, [startDate]);

  const days = useMemo(() => {
    const grouped = new Map<string, AtlasMaintenancePreviewItem[]>();
    items.forEach((item) => {
      grouped.set(item.schedule_date, [...(grouped.get(item.schedule_date) ?? []), item]);
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const scheduledMinutes = totalMinutes(items);
  const scheduledObjects = new Set(items.map((item) => item.maintenance_object_id)).size;
  const expandedEvenings = new Set(
    items
      .filter((item) => item.window_key === "evening" && item.window_minutes === 120)
      .map((item) => item.schedule_date),
  ).size;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Weeding Preview</span>
          </Link>
          <span className="atlas-weather-line">read-only scheduler</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div>
              <strong>7-Day Weeding Preview</strong>
              <span>Starting {prettyDate(startDate)}</span>
            </div>
            <p>This does not create, move, or complete Anna&apos;s tasks.</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Weeding scheduler preview stats">
            <article><strong>{loading ? "…" : scheduledObjects}</strong><span>objects</span></article>
            <article><strong>{loading ? "…" : scheduledMinutes}</strong><span>minutes</span></article>
            <article><strong>120</strong><span>morning</span></article>
            <article><strong>{loading ? "…" : expandedEvenings}</strong><span>long evenings</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>Morning fills first. Evening is 60 minutes on substantial workdays and 120 minutes on lighter days. Objects still inside cooldown are excluded.</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Building the read-only weeding preview.</div> : null}

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
                    <DayWindow title="Morning Window" items={morning} fallbackMinutes={120} />
                    <DayWindow title="Evening Window" items={evening} fallbackMinutes={significant ? 60 : 120} />
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
