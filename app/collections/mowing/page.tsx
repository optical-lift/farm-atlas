"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasTaskDisplay } from "@/lib/atlas/task-display";
import {
  atlasBuildMowingCollectionSummary,
  atlasCollectionTaskSortValue,
  atlasIsDoneTask,
  atlasIsMowingCollectionMember,
  atlasIsNotReadyCollectionTask,
} from "@/lib/atlas/work-collections";

type WeatherResponse = { ok: boolean; label?: string };

type CollectionSectionProps = {
  title: string;
  tasks: AtlasTaskCard[];
  empty: string;
  tone?: "due" | "done" | "paused" | "upcoming";
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

function nextDue(task: AtlasTaskCard) {
  return atlasMetaString(task, "next_due_at") || task.due_date;
}

function taskHref(task: AtlasTaskCard) {
  return `/task?taskId=${encodeURIComponent(task.task_id)}`;
}

function statusLine(task: AtlasTaskCard) {
  if (atlasIsNotReadyCollectionTask(task)) return atlasMetaString(task, "not_ready_reason") || task.blocker_text || "Not ready";
  if (atlasIsDoneTask(task)) return `Done${atlasMetaString(task, "next_due_at") ? ` · next ${prettyDate(atlasMetaString(task, "next_due_at"))}` : ""}`;
  if (task.status === "blocked") return task.blocker_text || "Waiting";
  if (task.due_date) return task.due_date <= todayIso() ? "Due now" : `Due ${prettyDate(task.due_date)}`;
  return "Open";
}

function MowingTaskCard({ task, tone }: { task: AtlasTaskCard; tone?: CollectionSectionProps["tone"] }) {
  const display = atlasTaskDisplay(task);
  const equipment = atlasMetaString(task, "equipment_group")?.replaceAll("_", " ");

  return (
    <Link className={`atlas-overview-task-card atlas-work-collection-task-card ${tone ?? ""}`} href={taskHref(task)}>
      <div>
        <strong>{display.title}</strong>
        <span>{display.location}</span>
      </div>
      <em>{statusLine(task)}</em>
      <p>{equipment ? `${equipment} · ${display.detail}` : display.detail}</p>
    </Link>
  );
}

function CollectionSection({ title, tasks, empty, tone }: CollectionSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "area" : "areas"}</span>
        </div>
        <b>Mowing</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? tasks.map((task) => <MowingTaskCard key={task.task_id} task={task} tone={tone} />) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function MowingCollectionPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = todayIso();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards();
        setTasks((response.taskCards ?? []).filter(atlasIsMowingCollectionMember).sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Mowing collection failed.");
      } finally {
        setLoading(false);
      }
    }

    async function loadWeather() {
      try {
        const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = (await response.json()) as WeatherResponse;
        setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable");
      } catch {
        setWeatherLabel("weather unavailable");
      }
    }

    void load();
    void loadWeather();
  }, []);

  const summary = useMemo(() => atlasBuildMowingCollectionSummary(tasks, today), [tasks, today]);
  const notReady = useMemo(() => tasks.filter(atlasIsNotReadyCollectionTask), [tasks]);
  const dueNow = useMemo(() => tasks
    .filter((task) => (task.status === "open" || task.status === "blocked") && !atlasIsNotReadyCollectionTask(task))
    .filter((task) => !task.due_date || task.due_date <= today)
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks, today]);
  const upcoming = useMemo(() => tasks
    .filter((task) => task.status === "open" && task.due_date && task.due_date > today)
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b))), [tasks, today]);
  const recentlyDone = useMemo(() => tasks
    .filter(atlasIsDoneTask)
    .sort((a, b) => String(nextDue(a) ?? "").localeCompare(String(nextDue(b) ?? ""))), [tasks]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Mowing</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div>
              <strong>Mowing Collection</strong>
              <span>{prettyDate(today)}</span>
            </div>
            <p>{loading ? "Loading mowing areas" : summary ? `${summary.dueCount} due · ${summary.doneRecentCount} resting · ${summary.notReadyCount} not ready` : "No mowing areas found"}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Mowing collection stats">
            <article><strong>{loading ? "…" : summary?.dueCount ?? 0}</strong><span>due</span></article>
            <article><strong>{loading ? "…" : summary?.doneRecentCount ?? 0}</strong><span>resting</span></article>
            <article><strong>{loading ? "…" : summary?.notReadyCount ?? 0}</strong><span>not ready</span></article>
            <article><strong>{loading ? "…" : summary?.nextDueLabel ?? "none"}</strong><span>next due</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>{summary?.preview ?? "Mowing is a work collection: each area closes and recurs independently."}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading mowing collection.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label="Mowing areas">
              <CollectionSection title="Due Now" tasks={dueNow} empty="No mowing areas due now." tone="due" />
              <CollectionSection title="Upcoming" tasks={upcoming} empty="No upcoming mowing areas scheduled." tone="upcoming" />
              <CollectionSection title="Recently Done / Resting" tasks={recentlyDone} empty="No mowing areas recently completed." tone="done" />
              <CollectionSection title="Not Ready" tasks={notReady} empty="No mowing areas are paused." tone="paused" />
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
