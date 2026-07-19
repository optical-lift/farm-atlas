"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasTaskDisplay } from "@/lib/atlas/task-display";
import {
  atlasBuildGerminationCollectionSummary,
  atlasCollectionTaskSortValue,
  atlasIsDoneTask,
  atlasIsGerminationCollectionMember,
  atlasVisibleCollectionTasks,
} from "@/lib/atlas/work-collections";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cropLabel(task: AtlasTaskCard) {
  return atlasMetaString(task, "crop_variety")
    || atlasMetaString(task, "crop_label")
    || atlasTaskDisplay(task).subject
    || task.title;
}

function sowingDate(task: AtlasTaskCard) {
  return atlasMetaString(task, "source_sown_date")
    || atlasMetaString(task, "actual_sow_date")
    || "unknown";
}

function locationLabel(task: AtlasTaskCard) {
  return task.objects?.map((object) => object.object_label).filter(Boolean).join(" · ")
    || atlasTaskDisplay(task).location
    || "Elm Farm";
}

function taskHref(task: AtlasTaskCard) {
  return `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent("/collections/germination")}`;
}

function GerminationCard({ task }: { task: AtlasTaskCard }) {
  return (
    <Link className="atlas-overview-task-card atlas-work-collection-task-card" href={taskHref(task)}>
      <div>
        <strong>{cropLabel(task)}</strong>
        <span>{locationLabel(task)}</span>
      </div>
      <em>{task.due_date ? `Check ${prettyDate(task.due_date)}` : "Check now"}</em>
      <p>Sown {prettyDate(sowingDate(task))}</p>
    </Link>
  );
}

function CollectionSection({ title, tasks, empty }: { title: string; tasks: AtlasTaskCard[]; empty: string }) {
  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div><strong>{title}</strong><span>{tasks.length} {tasks.length === 1 ? "record" : "records"}</span></div>
        <b>Germination</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? tasks.map((task) => <GerminationCard key={task.task_id} task={task} />) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function GerminationCollectionPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();
  const upcomingThrough = addDaysIso(today, 7);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards();
        const germinationTasks = (response.taskCards ?? [])
          .filter(atlasIsGerminationCollectionMember)
          .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b)));
        setTasks(atlasVisibleCollectionTasks(germinationTasks));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Germination collection failed.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const summary = useMemo(() => atlasBuildGerminationCollectionSummary(tasks, today, "through"), [tasks, today]);
  const dueNow = useMemo(() => tasks
    .filter((task) => (task.status === "open" || task.status === "blocked") && (!task.due_date || task.due_date <= today))
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks, today]);
  const upcoming = useMemo(() => tasks
    .filter((task) => task.status === "open" && task.due_date && task.due_date > today && task.due_date <= upcomingThrough)
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks, today, upcomingThrough]);
  const recentlyDone = useMemo(() => tasks.filter(atlasIsDoneTask).slice(-12).reverse(), [tasks]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Germination</span></Link>
          <span className="atlas-weather-line">all sowing records due for a look</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div><strong>Germination Collection</strong><span>{prettyDate(today)}</span></div>
            <p>{loading ? "Loading sowing records" : summary ? `${summary.dueCount} need a look · ${summary.openCount} still active` : "No germination checks found"}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Germination collection stats">
            <article><strong>{loading ? "…" : dueNow.length}</strong><span>look now</span></article>
            <article><strong>{loading ? "…" : upcoming.length}</strong><span>next 7 days</span></article>
            <article><strong>{loading ? "…" : recentlyDone.length}</strong><span>recently checked</span></article>
            <article><strong>{loading ? "…" : summary?.nextDueLabel ?? "none"}</strong><span>next due</span></article>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading germination collection.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label="Germination records">
              <CollectionSection title="Look Now" tasks={dueNow} empty="No sowing records need checked right now." />
              <CollectionSection title="Upcoming (7 Days)" tasks={upcoming} empty="No germination checks are coming due this week." />
              <CollectionSection title="Recently Checked" tasks={recentlyDone} empty="No germination checks have been completed yet." />
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
