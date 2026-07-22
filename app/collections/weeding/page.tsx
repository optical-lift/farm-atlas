"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasMetadataValue, atlasTaskDisplay } from "@/lib/atlas/task-display";
import {
  atlasCollectionTaskSortValue,
  atlasIsDoneTask,
  atlasIsNotReadyCollectionTask,
  atlasIsWeedingCollectionMember,
  atlasVisibleCollectionTasks,
} from "@/lib/atlas/work-collections";

type EffortBand = "heavy" | "moderate" | "light";
type QueueState = "active" | "queued" | "completed" | "skipped";

type WeedingQueueItem = {
  position: number;
  state: QueueState;
  initial_batch: boolean;
  task_id: string;
  title: string;
  task_status: string;
  due_date: string | null;
  label: string;
  condition: string;
  estimated_minutes: number | null;
  object_key: string | null;
};

type WeedingHierarchyStep = {
  rank: number;
  key: string;
  label: string;
  mode: "weeding" | "fall_tillage" | string;
  total_objects: number;
  active_objects: number;
  needs_attention: number;
  maintained: number;
  inactive: number;
  attention_labels: string[];
};

type WeedingCycle = {
  summary: {
    current_rank: number;
    current_zone_label: string;
    next_rank: number | null;
    next_zone_label: string | null;
    active_count: number;
    queued_count: number;
    completed_count: number;
    queue_next_label: string | null;
  };
  queue: WeedingQueueItem[];
  hierarchy: WeedingHierarchyStep[];
};

type WeedingCycleResponse = {
  ok: boolean;
  cycle?: WeedingCycle;
  error?: string;
};

function taskMinutes(task: AtlasTaskCard) {
  const raw = atlasMetadataValue(task, "estimated_minutes");
  const minutes = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

function taskEffortBand(task: AtlasTaskCard): EffortBand {
  const condition = atlasMetaString(task, "condition").toLowerCase();
  const lightPass = atlasMetadataValue(task, "light_maintenance_pass") === true
    || atlasMetadataValue(task, "quick_maintenance_pass") === true;
  const minutes = taskMinutes(task);

  if (lightPass || /maintain|light|easy|quick/.test(condition)) return "light";
  if (/heavy|reset|overgrown/.test(condition)) return "heavy";
  if (/moderate|medium/.test(condition)) return "moderate";
  if (minutes !== null && minutes >= 60) return "heavy";
  if (minutes !== null && minutes < 30) return "light";
  return "moderate";
}

function effortLabel(task: AtlasTaskCard) {
  const band = taskEffortBand(task);
  return band.charAt(0).toUpperCase() + band.slice(1);
}

function queueEffortLabel(item: WeedingQueueItem) {
  const condition = item.condition.toLowerCase();
  if (/heavy|reset|overgrown/.test(condition)) return "Heavy";
  if (/maintain|light|easy|quick/.test(condition)) return "Light";
  return "Moderate";
}

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

function daysSince(dateIso: string) {
  const start = new Date(`${dateIso}T12:00:00`);
  const end = new Date(`${todayIso()}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function maintenanceAgeLabel(task: AtlasTaskCard) {
  const lastSprayed = atlasMetaString(task, "last_sprayed_at");
  const lastWeeded = atlasMetaString(task, "last_weeded_at") || "2026-06-24";
  const dateIso = lastSprayed || lastWeeded;
  const action = lastSprayed ? "sprayed" : "weeded";
  const days = daysSince(dateIso);

  if (days === null) return `Last ${action} ${prettyDate(dateIso)}`;
  if (days === 0) return `${action === "sprayed" ? "Sprayed" : "Weeded"} today`;
  if (days === 1) return `1 day since ${action}`;
  return `${days} days since ${action}`;
}

function taskHref(taskId: string) {
  return `/task?taskId=${encodeURIComponent(taskId)}`;
}

function statusLine(task: AtlasTaskCard) {
  if (atlasIsNotReadyCollectionTask(task)) {
    return atlasMetaString(task, "not_ready_reason") || task.blocker_text || "Not ready";
  }
  if (atlasIsDoneTask(task)) return "Resting";
  if (task.status === "blocked") return task.blocker_text || "Waiting";
  if (task.due_date) return task.due_date <= todayIso() ? "Work now" : `Due ${prettyDate(task.due_date)}`;
  return "Open";
}

function taskSort(a: AtlasTaskCard, b: AtlasTaskCard) {
  const aQueue = Number(atlasMetadataValue(a, "release_queue_position")) || Number.MAX_SAFE_INTEGER;
  const bQueue = Number(atlasMetadataValue(b, "release_queue_position")) || Number.MAX_SAFE_INTEGER;
  if (aQueue !== bQueue) return aQueue - bQueue;
  return atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b));
}

function doneSort(a: AtlasTaskCard, b: AtlasTaskCard) {
  return (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");
}

function WeedingTaskCard({ task, tone }: { task: AtlasTaskCard; tone?: "due" | "done" | "paused" }) {
  const display = atlasTaskDisplay(task);
  const estimatedMinutes = taskMinutes(task);

  return (
    <Link className={`atlas-overview-task-card atlas-work-collection-task-card ${tone ?? ""}`} href={taskHref(task.task_id)}>
      <div>
        <strong>{display.title}</strong>
        <span>{display.location}</span>
      </div>
      <em>{statusLine(task)}</em>
      <p>{[estimatedMinutes ? `${estimatedMinutes} min` : "", effortLabel(task), maintenanceAgeLabel(task)].filter(Boolean).join(" · ")}</p>
    </Link>
  );
}

function TaskPanel({
  title,
  subtitle,
  tasks,
  empty,
  tone,
}: {
  title: string;
  subtitle: string;
  tasks: AtlasTaskCard[];
  empty: string;
  tone?: "due" | "done" | "paused";
}) {
  return (
    <section className="atlas-weeding-panel">
      <header className="atlas-weeding-panel-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <b>{tasks.length}</b>
      </header>
      <div className="atlas-overview-task-list">
        {tasks.length
          ? tasks.map((task) => <WeedingTaskCard key={task.task_id} task={task} tone={tone} />)
          : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

function QueueRow({ item, nextPosition }: { item: WeedingQueueItem; nextPosition: number | null }) {
  const isNext = item.state === "queued" && item.position === nextPosition;
  const status = item.state === "completed"
    ? "Done"
    : item.state === "active"
      ? "Work now"
      : isNext
        ? "Next"
        : item.state === "skipped"
          ? "Skipped"
          : "Waiting";
  const rowClass = `atlas-weeding-queue-row ${item.state}${isNext ? " next" : ""}`;
  const detail = [
    item.estimated_minutes ? `${item.estimated_minutes} min` : "",
    queueEffortLabel(item),
  ].filter(Boolean).join(" · ");
  const content = (
    <>
      <span className="atlas-weeding-queue-number">{item.position}</span>
      <div>
        <strong>{item.title}</strong>
        <span>{detail}</span>
      </div>
      <b>{status}</b>
    </>
  );

  if (item.state === "active" || item.state === "completed") {
    return <Link className={rowClass} href={taskHref(item.task_id)}>{content}</Link>;
  }
  return <div className={rowClass}>{content}</div>;
}

function queueExplanation(cycle: WeedingCycle | null) {
  if (!cycle) return "The queue is loading.";
  const { active_count: active, queued_count: queued, queue_next_label: next } = cycle.summary;
  if (active > 0 && queued > 0) {
    return `Finish the ${active} released ${active === 1 ? "task" : "tasks"}. Then ${next || "the next row"} releases for the next workday.`;
  }
  if (queued > 0) return `${next || "The next row"} is waiting to release.`;
  return "The Field Row queue is cleared.";
}

function hierarchyStepCopy(step: WeedingHierarchyStep, cycle: WeedingCycle) {
  if (step.mode === "fall_tillage") return "No hand-weeding · beds wait for fall tillage";
  if (step.rank === cycle.summary.current_rank) {
    return `${cycle.summary.active_count} active · ${cycle.summary.queued_count} waiting in the Field Row queue`;
  }
  if (step.rank === cycle.summary.next_rank) {
    return `Next tier · ${step.needs_attention} ${step.needs_attention === 1 ? "area" : "areas"} currently flagged`;
  }
  if (step.needs_attention > 0) {
    return `${step.needs_attention} ${step.needs_attention === 1 ? "area" : "areas"} currently flagged`;
  }
  return step.maintained > 0 ? `${step.maintained} resting / maintained` : "No active hand-weeding work";
}

function hierarchyBadge(step: WeedingHierarchyStep, cycle: WeedingCycle) {
  if (step.mode === "fall_tillage") return "Tillage";
  if (step.rank === cycle.summary.current_rank) return "Current";
  if (step.rank === cycle.summary.next_rank) return "Next";
  if (step.needs_attention === 0) return "Resting";
  return `Tier ${step.rank}`;
}

export default function WeedingCollectionPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [cycle, setCycle] = useState<WeedingCycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [taskResponse, cycleResponse] = await Promise.all([
          fetchAtlasTaskCards(),
          fetch("/api/atlas/weeding-cycle", {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            cache: "no-store",
          }),
        ]);

        const cycleData = (await cycleResponse.json()) as WeedingCycleResponse;
        if (!cycleResponse.ok || !cycleData.ok || !cycleData.cycle) {
          throw new Error(cycleData.error || "Weeding cycle failed.");
        }

        const weedingTasks = (taskResponse.taskCards ?? [])
          .filter(atlasIsWeedingCollectionMember)
          .sort(taskSort);
        setTasks(atlasVisibleCollectionTasks(weedingTasks));
        setCycle(cycleData.cycle);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Weeding collection failed.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const activeQueueIds = useMemo(() => new Set(
    cycle?.queue.filter((item) => item.state === "active").map((item) => item.task_id) ?? [],
  ), [cycle]);

  const workNow = useMemo(() => tasks
    .filter((task) => (task.status === "open" || task.status === "blocked") && !atlasIsNotReadyCollectionTask(task))
    .filter((task) => activeQueueIds.size > 0
      ? activeQueueIds.has(task.task_id)
      : !task.due_date || task.due_date <= today)
    .sort(taskSort), [tasks, activeQueueIds, today]);

  const recentlyDone = useMemo(() => tasks
    .filter(atlasIsDoneTask)
    .sort(doneSort)
    .slice(0, 6), [tasks]);

  const notReady = useMemo(() => tasks
    .filter(atlasIsNotReadyCollectionTask)
    .sort(taskSort), [tasks]);

  const nextQueuePosition = useMemo(() => cycle?.queue
    .filter((item) => item.state === "queued")
    .map((item) => item.position)
    .sort((a, b) => a - b)[0] ?? null, [cycle]);

  const heroLine = cycle
    ? `${cycle.summary.current_zone_label} · ${cycle.summary.active_count} active · ${cycle.summary.queued_count} waiting`
    : "Loading the farm weeding cycle";
  const nextZone = cycle?.summary.next_zone_label || "none";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell atlas-weeding-cycle-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Weeding</span></Link>
          <span className="atlas-weather-line">farm cycle + released work</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body atlas-weeding-cycle-body">
          <section className="atlas-overview-hero atlas-work-collection-hero atlas-weeding-cycle-hero">
            <div>
              <strong>Weeding Cycle</strong>
              <span>{prettyDate(today)}</span>
            </div>
            <p>{heroLine}</p>
          </section>

          <section className="atlas-overview-stat-grid atlas-weeding-cycle-stats" aria-label="Weeding cycle stats">
            <article><strong>{loading ? "…" : `${cycle?.summary.current_rank ?? 1}/9`}</strong><span>current tier</span></article>
            <article><strong>{loading ? "…" : cycle?.summary.active_count ?? workNow.length}</strong><span>work now</span></article>
            <article><strong>{loading ? "…" : cycle?.summary.queued_count ?? 0}</strong><span>in queue</span></article>
            <article><strong>{loading ? "…" : nextZone}</strong><span>next zone</span></article>
          </section>

          <section className="atlas-overview-summary-line atlas-weeding-cycle-summary">
            <p>{cycle
              ? `${queueExplanation(cycle)} ${cycle.summary.next_zone_label ? `${cycle.summary.next_zone_label} begins after the Field Row queue clears.` : ""}`
              : "Loading the next weeding movement."}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading weeding cycle.</div> : null}

          {!loading && cycle ? (
            <section className="atlas-weeding-cycle-stack" aria-label="Weeding work and cycle">
              <TaskPanel
                title="Work Now"
                subtitle="Only released work appears here"
                tasks={workNow}
                empty="No weeding task is currently released."
                tone="due"
              />

              <section className="atlas-weeding-panel atlas-weeding-queue-panel">
                <header className="atlas-weeding-panel-header">
                  <div>
                    <strong>Field Row Queue</strong>
                    <span>Finish the current batch, then release one row at a time</span>
                  </div>
                  <b>{cycle.queue.length}</b>
                </header>
                <div className="atlas-weeding-queue-list">
                  {cycle.queue.map((item) => (
                    <QueueRow key={item.task_id} item={item} nextPosition={nextQueuePosition} />
                  ))}
                </div>
                <p className="atlas-weeding-panel-note">{queueExplanation(cycle)}</p>
              </section>

              <section className="atlas-weeding-panel atlas-weeding-hierarchy-panel">
                <header className="atlas-weeding-panel-header">
                  <div>
                    <strong>Farm Weeding Order</strong>
                    <span>The hierarchy—not the calendar—decides what comes next</span>
                  </div>
                  <b>1–9</b>
                </header>
                <div className="atlas-weeding-hierarchy-list">
                  {cycle.hierarchy.map((step) => (
                    <article
                      key={step.key}
                      className={`atlas-weeding-hierarchy-row${step.rank === cycle.summary.current_rank ? " current" : ""}${step.rank === cycle.summary.next_rank ? " next" : ""}${step.mode === "fall_tillage" ? " excluded" : ""}`}
                    >
                      <span className="atlas-weeding-hierarchy-number">{step.rank}</span>
                      <div>
                        <strong>{step.label}</strong>
                        <span>{hierarchyStepCopy(step, cycle)}</span>
                        {step.attention_labels.length ? <p>{step.attention_labels.join(" · ")}</p> : null}
                      </div>
                      <b>{hierarchyBadge(step, cycle)}</b>
                    </article>
                  ))}
                </div>
              </section>

              {recentlyDone.length ? (
                <TaskPanel
                  title="Recently Done / Resting"
                  subtitle="Completed work stays visible without blocking the queue"
                  tasks={recentlyDone}
                  empty="No recently weeded areas."
                  tone="done"
                />
              ) : null}

              {notReady.length ? (
                <TaskPanel
                  title="Paused / Not Ready"
                  subtitle="Excluded until the underlying condition changes"
                  tasks={notReady}
                  empty="No weeding areas are paused."
                  tone="paused"
                />
              ) : null}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
