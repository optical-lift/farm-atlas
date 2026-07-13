"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAtlasMaintenancePreview,
  type AtlasMaintenancePreviewItem,
} from "@/lib/atlas/maintenance-preview-client";

type CompletionOutcome = "fully_completed" | "partially_completed" | "heavier_reset";

type WeedingSectionProps = {
  title: string;
  items: AtlasMaintenancePreviewItem[];
  empty: string;
  tone?: "due" | "done" | "paused" | "upcoming";
  busyId: string | null;
  onComplete: (item: AtlasMaintenancePreviewItem, outcome: CompletionOutcome) => void;
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function totalMinutes(items: AtlasMaintenancePreviewItem[]) {
  return items.reduce((sum, item) => sum + item.estimated_minutes, 0);
}

async function recordCompletion(
  maintenanceObjectId: string,
  outcome: CompletionOutcome,
  actualMinutes: number | null,
  revisedTotalMinutes?: number | null,
) {
  const response = await fetch("/api/atlas/maintenance-completion", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      maintenanceObjectId,
      outcome,
      actualMinutes,
      revisedTotalMinutes: revisedTotalMinutes ?? null,
      source: "weeding_collection",
    }),
  });
  const data = (await response.json()) as { ok: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Weeding completion failed.");
}

function statusLine(item: AtlasMaintenancePreviewItem, today: string) {
  if (item.schedule_date === today) return `${item.window_key === "morning" ? "Morning" : "Evening"} · due now`;
  return `Due ${prettyDate(item.schedule_date)}`;
}

function WeedingTaskCard({ item, tone, busyId, onComplete }: {
  item: AtlasMaintenancePreviewItem;
  tone?: WeedingSectionProps["tone"];
  busyId: string | null;
  onComplete: WeedingSectionProps["onComplete"];
}) {
  const busy = busyId === item.maintenance_object_id;
  return (
    <article className={`atlas-overview-task-card atlas-work-collection-task-card ${tone ?? ""}`}>
      <div>
        <strong>Weed · {item.object_label}</strong>
        <span>{item.zone_label ?? "Elm Farm"}</span>
      </div>
      <em>{statusLine(item, todayIso())}</em>
      <p>{item.estimated_minutes} min · {item.condition}</p>
      {item.dependent_task_labels.length ? <p><strong>Unlocks:</strong> {item.dependent_task_labels.join(" · ")}</p> : null}
      <div className="atlas-maintenance-control-row" aria-label={`Weeding completion for ${item.object_label}`}>
        <button type="button" disabled={busy} onClick={() => onComplete(item, "fully_completed")}>Fully weeded</button>
        <button type="button" disabled={busy} onClick={() => onComplete(item, "partially_completed")}>Partly weeded</button>
        <button type="button" disabled={busy} onClick={() => onComplete(item, "heavier_reset")}>Heavier</button>
      </div>
    </article>
  );
}

function CollectionSection({ title, items, empty, tone, busyId, onComplete }: WeedingSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{items.length} {items.length === 1 ? "area" : "areas"} · {totalMinutes(items)} min</span>
        </div>
        <b>Weeding</b>
      </summary>
      <div className="atlas-overview-task-list">
        {items.length
          ? items.map((item) => <WeedingTaskCard key={`${item.schedule_date}-${item.maintenance_object_id}`} item={item} tone={tone} busyId={busyId} onComplete={onComplete} />)
          : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function WeedingCollectionPage() {
  const [date, setDate] = useState(todayIso());
  const [items, setItems] = useState<AtlasMaintenancePreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const response = await fetchAtlasMaintenancePreview(date, 7, "weed");
        setItems(response.items ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Weeding collection failed.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [date, revision]);

  async function complete(item: AtlasMaintenancePreviewItem, outcome: CompletionOutcome) {
    let actualMinutes: number | null = item.estimated_minutes;
    let revisedTotalMinutes: number | null = null;

    if (outcome === "partially_completed") {
      const entered = window.prompt(`Minutes completed on ${item.object_label}?`, String(Math.max(1, Math.floor(item.estimated_minutes / 2))));
      if (entered === null) return;
      actualMinutes = Math.max(0, Math.round(Number(entered)));
      if (!Number.isFinite(actualMinutes)) return;
    }

    if (outcome === "heavier_reset") {
      const entered = window.prompt(`Revised total minutes needed for ${item.object_label}?`, String(item.estimated_minutes));
      if (entered === null) return;
      revisedTotalMinutes = Math.max(1, Math.round(Number(entered)));
      if (!Number.isFinite(revisedTotalMinutes)) return;
      actualMinutes = 0;
    }

    try {
      setBusyId(item.maintenance_object_id);
      setError(null);
      await recordCompletion(item.maintenance_object_id, outcome, actualMinutes, revisedTotalMinutes);
      setRevision((value) => value + 1);
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "Weeding completion failed.");
    } finally {
      setBusyId(null);
    }
  }

  const dueNow = useMemo(() => items
    .filter((item) => item.schedule_date === date)
    .sort((a, b) => a.window_key.localeCompare(b.window_key) || a.sequence_in_window - b.sequence_in_window), [date, items]);
  const upcoming = useMemo(() => items
    .filter((item) => item.schedule_date > date)
    .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date) || a.window_key.localeCompare(b.window_key) || a.sequence_in_window - b.sequence_in_window), [date, items]);
  const morningDue = dueNow.filter((item) => item.window_key === "morning");
  const eveningDue = dueNow.filter((item) => item.window_key === "evening");
  const nextDue = upcoming[0]?.schedule_date ?? null;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Weeding</span></Link>
          <span className="atlas-weather-line">beds and flower rows</span>
          <Link href={`/day?date=${date}`} className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div><strong>Weeding Collection</strong><span>{prettyDate(date)}</span></div>
            <p>{loading ? "Loading weeding areas" : `${dueNow.length} due · ${totalMinutes(dueNow)} minutes`}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Weeding collection stats">
            <article><strong>{loading ? "…" : morningDue.length}</strong><span>morning</span></article>
            <article><strong>{loading ? "…" : eveningDue.length}</strong><span>evening</span></article>
            <article><strong>{loading ? "…" : totalMinutes(dueNow)}</strong><span>minutes due</span></article>
            <article><strong>{loading ? "…" : nextDue ? prettyDate(nextDue) : "none"}</strong><span>next due</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>{dueNow.length ? dueNow.map((item) => item.object_label).slice(0, 4).join(" · ") : "No weeding areas due today."}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading weeding collection.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label="Weeding areas">
              <CollectionSection title="Morning — Due Now" items={morningDue} empty="No morning weeding due." tone="due" busyId={busyId} onComplete={(item, outcome) => void complete(item, outcome)} />
              <CollectionSection title="Evening — Due Now" items={eveningDue} empty="No evening weeding due." tone="due" busyId={busyId} onComplete={(item, outcome) => void complete(item, outcome)} />
              <CollectionSection title="Upcoming" items={upcoming} empty="No upcoming weeding areas scheduled." tone="upcoming" busyId={busyId} onComplete={(item, outcome) => void complete(item, outcome)} />
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
