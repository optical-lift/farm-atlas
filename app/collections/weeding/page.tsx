"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasMetadataValue, atlasTaskDisplay } from "@/lib/atlas/task-display";
import {
  atlasBuildWeedingCollectionSummary,
  atlasCollectionTaskSortValue,
  atlasIsDoneTask,
  atlasIsNotReadyCollectionTask,
  atlasIsWeedingCollectionMember,
  atlasVisibleCollectionTasks,
} from "@/lib/atlas/work-collections";

type CollectionSectionProps = {
  title: string;
  tasks: AtlasTaskCard[];
  empty: string;
  tone?: "due" | "done" | "paused" | "upcoming";
};

type EffortBand = "heavy" | "moderate" | "light";

const effortBands: Array<{ key: EffortBand; label: string }> = [
  { key: "heavy", label: "Heavy" },
  { key: "moderate", label: "Moderate" },
  { key: "light", label: "Light / Quick" },
];

function taskMinutes(task: AtlasTaskCard) {
  const raw = atlasMetadataValue(task, "estimated_minutes");
  const minutes = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

function taskEffortBand(task: AtlasTaskCard): EffortBand {
  const condition = atlasMetaString(task, "condition").toLowerCase();
  const quickPass = atlasMetadataValue(task, "quick_maintenance_pass") === true;
  const minutes = taskMinutes(task);

  if (quickPass || /maintain|light|easy|quick/.test(condition)) return "light";
  if (/heavy|reset|overgrown/.test(condition)) return "heavy";
  if (/moderate|medium/.test(condition)) return "moderate";
  if (minutes !== null && minutes >= 60) return "heavy";
  if (minutes !== null && minutes < 30) return "light";
  return "moderate";
}

function effortMinutes(tasks: AtlasTaskCard[]) {
  const minutes = tasks.map(taskMinutes);
  if (minutes.some((value) => value === null)) return null;
  return minutes.reduce<number>((total, value) => total + (value ?? 0), 0);
}

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

function taskHref(task: AtlasTaskCard) {
  return `/task?taskId=${encodeURIComponent(task.task_id)}`;
}

function statusLine(task: AtlasTaskCard) {
  if (atlasIsNotReadyCollectionTask(task)) return atlasMetaString(task, "not_ready_reason") || task.blocker_text || "Not ready";
  if (atlasIsDoneTask(task)) return "Resting";
  if (task.status === "blocked") return task.blocker_text || "Waiting";
  if (task.due_date) return task.due_date <= todayIso() ? "Due now" : `Due ${prettyDate(task.due_date)}`;
  return "Open";
}

function WeedingTaskCard({ task, tone }: { task: AtlasTaskCard; tone?: CollectionSectionProps["tone"] }) {
  const display = atlasTaskDisplay(task);
  const estimatedMinutes = taskMinutes(task);

  return (
    <Link className={`atlas-overview-task-card atlas-work-collection-task-card ${tone ?? ""}`} href={taskHref(task)}>
      <div>
        <strong>{display.title}</strong>
        <span>{display.location}</span>
      </div>
      <em>{statusLine(task)}</em>
      <p>{[estimatedMinutes ? `${estimatedMinutes} min` : "", display.detail].filter(Boolean).join(" · ")}</p>
    </Link>
  );
}

function CollectionSection({ title, tasks, empty, tone }: CollectionSectionProps) {
  const groups = effortBands
    .map((band) => ({ ...band, tasks: tasks.filter((task) => taskEffortBand(task) === band.key) }))
    .filter((group) => group.tasks.length > 0);

  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "area" : "areas"}</span>
        </div>
        <b>Weeding</b>
      </summary>
      <div className="atlas-overview-task-list atlas-work-collection-effort-list">
        {groups.length ? groups.map((group) => {
          const totalMinutes = effortMinutes(group.tasks);
          return (
            <section className={`atlas-work-effort-group ${group.key}`} key={group.key} aria-label={`${group.label} weeding`}>
              <header className="atlas-work-effort-header">
                <div>
                  <strong>{group.label}</strong>
                  <span>{group.tasks.length} {group.tasks.length === 1 ? "area" : "areas"}</span>
                </div>
                {totalMinutes !== null ? <b>{totalMinutes} min</b> : null}
              </header>
              <div className="atlas-work-effort-tasks">
                {group.tasks.map((task) => <WeedingTaskCard key={task.task_id} task={task} tone={tone} />)}
              </div>
            </section>
          );
        }) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function WeedingCollectionPage() {
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
        const weedingTasks = (response.taskCards ?? [])
          .filter(atlasIsWeedingCollectionMember)
          .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b)));
        setTasks(atlasVisibleCollectionTasks(weedingTasks));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Weeding collection failed.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const summary = useMemo(() => atlasBuildWeedingCollectionSummary(tasks, today), [tasks, today]);
  const notReady = useMemo(() => tasks.filter(atlasIsNotReadyCollectionTask), [tasks]);
  const dueNow = useMemo(() => tasks
    .filter((task) => (task.status === "open" || task.status === "blocked") && !atlasIsNotReadyCollectionTask(task))
    .filter((task) => !task.due_date || task.due_date <= today)
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks, today]);
  const upcoming = useMemo(() => tasks
    .filter((task) => task.status === "open" && task.due_date && task.due_date > today && task.due_date <= upcomingThrough)
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks, today, upcomingThrough]);
  const recentlyDone = useMemo(() => tasks
    .filter(atlasIsDoneTask)
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Weeding</span></Link>
          <span className="atlas-weather-line">flower beds + growing rows</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div>
              <strong>Weeding Collection</strong>
              <span>{prettyDate(today)}</span>
            </div>
            <p>{loading ? "Loading weedable areas" : summary ? `${summary.dueCount} due · ${summary.doneRecentCount} resting · ${summary.notReadyCount} not ready` : "No weeding areas found"}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Weeding collection stats">
            <article><strong>{loading ? "…" : summary?.dueCount ?? 0}</strong><span>due</span></article>
            <article><strong>{loading ? "…" : summary?.doneRecentCount ?? 0}</strong><span>resting</span></article>
            <article><strong>{loading ? "…" : summary?.notReadyCount ?? 0}</strong><span>not ready</span></article>
            <article><strong>{loading ? "…" : summary?.nextDueLabel ?? "none"}</strong><span>next due</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>{summary?.preview ?? "No active weeding areas."}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading weeding collection.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label="Weeding areas">
              <CollectionSection title="Due Now" tasks={dueNow} empty="No beds or areas due for weeding now." tone="due" />
              <CollectionSection title="Upcoming (7 Days)" tasks={upcoming} empty="No weeding areas scheduled in the next 7 days." tone="upcoming" />
              <CollectionSection title="Recently Done / Resting" tasks={recentlyDone} empty="No recently weeded areas." tone="done" />
              <CollectionSection title="Not Ready" tasks={notReady} empty="No weeding areas are paused." tone="paused" />
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
