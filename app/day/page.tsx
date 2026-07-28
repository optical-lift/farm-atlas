"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import DayTrailSummary from "@/components/atlas/day-trail-summary";
import {
  LivingDayCarried,
  LivingDayCompletionSummary,
  LivingDayGoals,
  LivingDayJournal,
  LivingDayUnlocked,
} from "@/components/atlas/living-day-primitives";
import {
  atlasDayCurrentTask,
  atlasDayIsCarePulse,
  atlasDayRouteState,
  atlasDayTaskCues,
  atlasDayTaskFamily,
  type AtlasDayRouteState,
} from "@/lib/atlas/day-route";
import { fetchAtlasLivingDay } from "@/lib/atlas/living-day-client";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";
import type { AtlasJournalEvent } from "@/lib/atlas/journal-contract";
import {
  atlasIsCropCycleTask,
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasRouteOrder,
  atlasTaskDisplay,
  type AtlasWorkRouteKey,
} from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import { atlasWorkOrderLabel, atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import {
  atlasBuildGerminationCollectionSummary,
  atlasBuildWeedingCollectionSummary,
  atlasIsGerminationCollectionMember,
  atlasIsMowingCollectionMember,
  atlasIsWeedingCollectionMember,
  type AtlasWorkCollectionSummary,
} from "@/lib/atlas/work-collections";

type RouteKey = AtlasWorkRouteKey;
type DayViewMode = "work_order" | "zone";
type WeatherResponse = { ok: boolean; label?: string };

const routeLabels = atlasRouteLabels;
const routeOrder = atlasRouteOrder;

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function dayOnly(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function shiftIsoDate(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function dayHref(dateIso: string) {
  return `/day?date=${encodeURIComponent(dateIso)}&view=work_order`;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === "1" || value === 1;
}

function isChildTask(task: AtlasTaskCard) {
  return Boolean(task.parent_task_id) || meta(task, "is_child_task") === true || meta(task, "is_child_task") === "true";
}

function isWorkTask(task: AtlasTaskCard) {
  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  if (task.status === "archived" || task.status === "skipped" || isChildTask(task)) return false;
  if (atlasIsCropCycleTask(task)) return true;
  return !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
}

function isDashboardWork(task: AtlasTaskCard) {
  return (task.status === "open" || task.status === "blocked") && isWorkTask(task);
}

function isDoneTask(task: AtlasTaskCard) {
  if (task.task_outcomes?.[0]?.outcome === "reopened") return false;
  return task.status === "done" || text(meta(task, "checklist_status")) === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function isOwnerOnlyTask(task: AtlasTaskCard) {
  const ownerTask = meta(task, "owner_task");
  const assignedTo = text(meta(task, "assigned_to")).toLowerCase();
  return ownerTask === true || ownerTask === "true" || assignedTo === "owner";
}

function collectionZone(task: AtlasTaskCard) {
  return text(task.zone_label) || text(meta(task, "collection_zone")) || atlasTaskDisplay(task).location || "Elm Farm";
}

function taskHref(task: AtlasTaskCard, returnTo?: string) {
  const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  return `/task-focus/${encodeURIComponent(task.task_id)}${suffix}`;
}

function taskResultHref(task: AtlasTaskCard, returnTo?: string, correction = false) {
  const base = taskHref(task, returnTo);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${correction ? `${separator}correction=1` : ""}#result`;
}

function routeHref(dateIso: string, key: RouteKey) {
  return `/day?date=${encodeURIComponent(dateIso)}&route=${encodeURIComponent(key)}`;
}

function isExtraCredit(task: AtlasTaskCard) {
  const mode = text(meta(task, "day_work_order_mode")) || text(meta(task, "work_order_mode"));
  const label = `${text(meta(task, "day_work_order_label"))} ${text(meta(task, "work_order_label"))}`.toLowerCase();
  return mode === "extra_credit" || label.includes("extra credit");
}

function requiresStructuredResult(task: AtlasTaskCard) {
  if (truthy(meta(task, "quick_complete_allowed"))) return false;
  if (meta(task, "quick_complete_allowed") === false || meta(task, "quick_complete_allowed") === "false") return true;
  if (
    truthy(meta(task, "structured_result_required"))
    || truthy(meta(task, "result_capture_required"))
    || truthy(meta(task, "planting_log_required"))
    || truthy(meta(task, "requires_result"))
    || Boolean(meta(task, "capture_kind"))
  ) return true;

  const route = atlasRouteKeyForTask(task);
  const joined = `${task.task_type ?? ""} ${task.action_key ?? ""} ${task.generated_from ?? ""}`.toLowerCase();
  return atlasIsCropCycleTask(task)
    || route === "seed"
    || route === "plant"
    || route === "harvest"
    || /germination|harvest|transplant|planting|readiness|production/.test(joined);
}

function objectStateBefore(task: AtlasTaskCard) {
  return task.objects.map((object) => ({
    object_id: object.object_id,
    life_status: object.life_status ?? "open",
    weed_pressure: object.weed_pressure ?? "unknown",
    water_status: object.water_status ?? "unknown",
    last_touched_at: object.last_touched_at ?? null,
    last_weeded_at: object.last_weeded_at ?? null,
    last_watered_at: object.last_watered_at ?? null,
    last_checked_at: object.last_checked_at ?? null,
    decision_required: object.decision_required ?? false,
    presentability: object.presentability ?? "unknown",
  }));
}

function optimisticTask(task: AtlasTaskCard, outcome: "done" | "reopened") {
  const done = outcome === "done";
  return {
    ...task,
    status: done ? "done" : "open",
    metadata: { ...(task.metadata ?? {}), checklist_status: done ? "done" : "open" },
    task_outcomes: [{
      event_id: `optimistic:${task.task_id}:${outcome}`,
      outcome,
      lane_key: task.action_key,
      work_key: task.action_key,
      blocker_reason: null,
      note: null,
      created_at: new Date().toISOString(),
    }, ...(task.task_outcomes ?? [])],
  } satisfies AtlasTaskCard;
}

function latestEvidence(task: AtlasTaskCard) {
  const outcome = task.task_outcomes?.[0];
  if (outcome) return outcome.note || outcome.blocker_reason || outcome.outcome.replaceAll("_", " ");
  const transition = task.task_transitions?.[0];
  if (transition) return transition.note || transition.reason || transition.transition.replaceAll("_", " ");
  return "No result has been recorded yet.";
}

type TaskCardProps = {
  task: AtlasTaskCard;
  complete?: boolean;
  overdue?: boolean;
  expandable?: boolean;
  returnTo?: string;
  routeState?: AtlasDayRouteState;
  onNodePress?: (task: AtlasTaskCard) => void;
  nodeSaving?: boolean;
};

function TaskCard({ task, complete = false, overdue = false, expandable = false, returnTo, routeState, onNodePress, nodeSaving = false }: TaskCardProps) {
  const display = atlasTaskDisplay(task);
  const zone = collectionZone(task);
  const isGrowRoomCare = task.title === "Grow Room Care" && task.task_type === "grow_room_care";
  const statusLine = isGrowRoomCare ? zone : `${atlasWorkOrderLabel(task)} · ${zone}`;
  const family = atlasDayTaskFamily(task);
  const cues = atlasDayTaskCues(task);
  const routeClass = routeState ? `atlas-day-route-${routeState}` : "";
  const className = `atlas-day-task-card${complete ? " complete" : ""}${overdue ? " atlas-day-overdue-task-card" : ""}${atlasIsCropCycleTask(task) ? " atlas-crop-cycle-task-card" : ""}${routeClass ? ` ${routeClass}` : ""}`;

  const summaryContent = (
    <>
      {overdue ? <b className="atlas-day-overdue-badge">Overdue</b> : null}
      {!complete && !overdue ? <small className="atlas-day-task-family">{routeState === "current" ? `Current · ${family}` : family}</small> : null}
      <strong>{display.title}</strong>
      <span>{overdue ? `Due ${prettyDate(task.due_date ?? "")}` : complete ? "Complete" : statusLine}</span>
      {display.detail ? <em>{display.detail}</em> : null}
      {!complete && !overdue && cues.length ? <span className="atlas-day-task-cues">{cues.map((cue) => <i key={cue}>{cue}</i>)}</span> : null}
    </>
  );

  const card = expandable ? (
    <details className={`${className} atlas-journal-task-row`} aria-current={routeState === "current" ? "step" : undefined}>
      <summary>{summaryContent}<b className="atlas-journal-row-caret" aria-hidden="true">⌄</b></summary>
      <div className="atlas-journal-task-detail">
        <dl>
          <div><dt>Place</dt><dd>{task.objects.length ? task.objects.map((object) => object.object_label).join(" · ") : zone}</dd></div>
          <div><dt>Time</dt><dd>{task.due_date ? prettyDate(task.due_date) : "No date recorded"}</dd></div>
          <div><dt>Evidence</dt><dd>{latestEvidence(task)}</dd></div>
          <div><dt>Effect</dt><dd>{task.unlock_text || task.blocker_text || "No secondary effect is recorded."}</dd></div>
        </dl>
        <Link href={taskHref(task, returnTo)}>Open full task <span aria-hidden="true">→</span></Link>
      </div>
    </details>
  ) : (
    <Link className={className} href={taskHref(task, returnTo)} aria-current={routeState === "current" ? "step" : undefined}>
      {summaryContent}
    </Link>
  );

  if (!onNodePress) return card;
  return (
    <div className={`atlas-day-task-entry${complete ? " atlas-day-complete-entry" : ""}${routeClass ? ` ${routeClass}` : ""}`}>
      <button
        type="button"
        className={`atlas-day-task-node${complete ? " is-complete" : ""}${nodeSaving ? " is-saving" : ""}`}
        aria-label={complete ? `Uncomplete ${display.title}` : `Mark ${display.title} done`}
        aria-pressed={complete}
        disabled={nodeSaving}
        onClick={() => onNodePress(task)}
      ><span aria-hidden="true" /></button>
      {card}
    </div>
  );
}

function CompletionEcho({ task, event, saving, returnTo, onPress }: { task: AtlasTaskCard; event?: AtlasJournalEvent; saving: boolean; returnTo: string; onPress: (task: AtlasTaskCard) => void }) {
  const label = atlasTaskDisplay(task).title;
  const effect = event?.detail || task.task_outcomes?.[0]?.note || task.task_outcomes?.[0]?.outcome || "Completed";
  return (
    <div className="atlas-day-completion-echo" data-completed-task-id={task.task_id}>
      <button type="button" className={saving ? "is-saving" : ""} aria-label={`Uncomplete ${label}`} aria-pressed="true" disabled={saving} onClick={() => onPress(task)}><span aria-hidden="true" /></button>
      <details className="atlas-journal-completion-echo-copy">
        <summary><strong>{label}</strong><span>{effect.replaceAll("_", " ")}</span><b aria-hidden="true">⌄</b></summary>
        <div><span>{event ? `Journal · ${event.sourceEvent.replaceAll("_", " ")}` : "Canonical task result"}</span><Link href={taskHref(task, returnTo)}>Open result <span aria-hidden="true">→</span></Link></div>
      </details>
    </div>
  );
}

function WorkCollectionCard({ collection, route = false }: { collection: AtlasWorkCollectionSummary; route?: boolean }) {
  const status = collection.key === "germination"
    ? `${collection.dueCount} need a look · ${collection.openCount} active`
    : `${collection.dueCount} due · ${collection.doneRecentCount} resting · ${collection.notReadyCount} not ready`;
  return (
    <Link className={`atlas-day-task-card atlas-work-collection-day-card${route ? " atlas-day-route-collection" : ""}`} href={collection.href}>
      {route ? <small className="atlas-day-task-family">Collection</small> : null}
      <strong>{collection.label}</strong><span>{status}</span><em>{collection.preview}</em>
    </Link>
  );
}

function ViewToggle({ viewMode, onChange }: { viewMode: DayViewMode; onChange: (mode: DayViewMode) => void }) {
  return (
    <div className="atlas-day-filter-pill atlas-day-view-toggle" aria-label="View day as timeline or zone">
      <button type="button" className={viewMode === "work_order" ? "selected" : ""} onClick={() => onChange("work_order")}>Timeline</button>
      <button type="button" className={viewMode === "zone" ? "selected" : ""} onClick={() => onChange("zone")}>Zone</button>
    </div>
  );
}

function AtlasDayPageContent() {
  const searchParams = useSearchParams();
  const dateIso = searchParams.get("date") || todayIso();
  const requestedRoute = searchParams.get("route");
  const requestedView = searchParams.get("view");
  const routeFilter = requestedRoute && routeOrder.includes(requestedRoute as RouteKey) ? requestedRoute as RouteKey : null;
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [livingDay, setLivingDay] = useState<AtlasLivingDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [livingLoading, setLivingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [livingError, setLivingError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [viewMode, setViewMode] = useState<DayViewMode>("work_order");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const livingRequestSequence = useRef(0);

  useEffect(() => {
    if (requestedView === "zone" || requestedView === "area") setViewMode("zone");
    else setViewMode("work_order");
  }, [requestedView, dateIso]);

  const loadTasks = useCallback(async (reset = false) => {
    const requestId = ++requestSequence.current;
    try {
      if (reset) { setLoading(true); setTasks([]); }
      setError(null);
      const response = await fetchAtlasTaskCards({ viewerScoped: true, dueThrough: dateIso, doneDate: dateIso });
      if (requestId !== requestSequence.current) return;
      setTasks(response.taskCards ?? []);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
    } finally {
      if (requestId === requestSequence.current && reset) setLoading(false);
    }
  }, [dateIso]);

  const loadLivingDay = useCallback(async (reset = false) => {
    const requestId = ++livingRequestSequence.current;
    try {
      if (reset) { setLivingLoading(true); setLivingDay(null); }
      setLivingError(null);
      const response = await fetchAtlasLivingDay(dateIso);
      if (requestId !== livingRequestSequence.current) return;
      setLivingDay(response);
    } catch (loadError) {
      if (requestId === livingRequestSequence.current) setLivingError(loadError instanceof Error ? loadError.message : "Journal failed.");
    } finally {
      if (requestId === livingRequestSequence.current && reset) setLivingLoading(false);
    }
  }, [dateIso]);

  useEffect(() => { void loadTasks(true); void loadLivingDay(true); }, [loadLivingDay, loadTasks]);

  useEffect(() => {
    async function loadWeather() {
      try {
        const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = (await response.json()) as WeatherResponse;
        setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable");
      } catch { setWeatherLabel("weather unavailable"); }
    }
    void loadWeather();
  }, []);

  const allDayTasks = useMemo(() => tasks.filter(isWorkTask).filter((task) => task.due_date === dateIso), [dateIso, tasks]);
  const dayTasks = useMemo(() => tasks.filter(isDashboardWork).filter((task) => task.due_date === dateIso).sort((a, b) => atlasWorkOrderSortValue(a).localeCompare(atlasWorkOrderSortValue(b))), [dateIso, tasks]);
  const overdueTasks = useMemo(() => {
    if (dateIso !== todayIso()) return [];
    return tasks.filter(isDashboardWork).filter((task) => Boolean(task.due_date && task.due_date < dateIso)).filter((task) => !isOwnerOnlyTask(task) && !isExtraCredit(task)).filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task) && !atlasIsGerminationCollectionMember(task)).sort((a, b) => `${a.due_date ?? ""}-${atlasWorkOrderSortValue(a)}`.localeCompare(`${b.due_date ?? ""}-${atlasWorkOrderSortValue(b)}`));
  }, [dateIso, tasks]);
  const progressTasks = useMemo(() => allDayTasks.filter((task) => !isExtraCredit(task)), [allDayTasks]);
  const requiredTasks = useMemo(() => dayTasks.filter((task) => !isExtraCredit(task)), [dayTasks]);
  const standaloneTasks = useMemo(() => requiredTasks.filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task) && !atlasIsGerminationCollectionMember(task)), [requiredTasks]);
  const extraCreditTasks = useMemo(() => dayTasks.filter(isExtraCredit), [dayTasks]);
  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask).filter((task) => !atlasIsGerminationCollectionMember(task)), [allDayTasks]);
  const finishedProgressTasks = useMemo(() => progressTasks.filter(isDoneTask), [progressTasks]);
  const blockedProgressTasks = useMemo(() => progressTasks.filter((task) => task.status === "blocked" && !isDoneTask(task)), [progressTasks]);
  const doneStandaloneTasks = useMemo(() => doneDayTasks.filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task)), [doneDayTasks]);
  const filteredTasks = useMemo(() => routeFilter ? standaloneTasks.filter((task) => atlasRouteKeyForTask(task) === routeFilter) : standaloneTasks, [routeFilter, standaloneTasks]);
  const timelineTasks = useMemo(() => [...standaloneTasks, ...doneStandaloneTasks].sort((a, b) => atlasWorkOrderSortValue(a).localeCompare(atlasWorkOrderSortValue(b))), [doneStandaloneTasks, standaloneTasks]);
  const filteredTimelineTasks = useMemo(() => routeFilter ? timelineTasks.filter((task) => atlasRouteKeyForTask(task) === routeFilter) : timelineTasks, [routeFilter, timelineTasks]);
  const currentTask = useMemo(() => atlasDayCurrentTask(standaloneTasks) ?? atlasDayCurrentTask(requiredTasks), [requiredTasks, standaloneTasks]);
  const careTasks = useMemo(() => requiredTasks.filter(atlasDayIsCarePulse).filter((task) => task.task_id !== currentTask?.task_id).slice(0, 3), [currentTask, requiredTasks]);
  const openRequiredCount = useMemo(() => requiredTasks.filter((task) => task.status === "open").length, [requiredTasks]);

  const weedingCollection = useMemo(() => atlasBuildWeedingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const germinationCollection = useMemo(() => atlasBuildGerminationCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const showWeedingCollection = Boolean(weedingCollection && weedingCollection.dueCount > 0);
  const showGerminationCollection = Boolean(germinationCollection && germinationCollection.dueCount > 0);
  const collectionCount = Number(showWeedingCollection) + Number(showGerminationCollection);

  const routeCards = useMemo(() => {
    const regularEntries = routeOrder.map((key) => {
      const collection = key === "weed" ? weedingCollection : null;
      const routeTasks = standaloneTasks.filter((task) => atlasRouteKeyForTask(task) === key);
      return { key, collection: collection && collection.dueCount > 0 ? collection : null, tasks: routeTasks };
    }).filter((entry) => entry.collection || entry.tasks.length);
    const germinationEntry = germinationCollection && germinationCollection.dueCount > 0
      ? [{ key: "germination" as const, collection: germinationCollection, tasks: [] as AtlasTaskCard[] }]
      : [];
    return [...regularEntries, ...germinationEntry].sort((a, b) => {
      if (a.key === "weed") return -1;
      if (b.key === "weed") return 1;
      if (a.key === "germination") return -1;
      if (b.key === "germination") return 1;
      if (a.key === "mow") return 1;
      if (b.key === "mow") return -1;
      return routeOrder.indexOf(a.key as RouteKey) - routeOrder.indexOf(b.key as RouteKey);
    });
  }, [germinationCollection, standaloneTasks, weedingCollection]);

  const zones = useMemo(() => Array.from(new Set(filteredTasks.map(collectionZone))).sort((a, b) => a.localeCompare(b)), [filteredTasks]);
  const returnTo = routeFilter ? routeHref(dateIso, routeFilter) : dayHref(dateIso);
  const previousDate = shiftIsoDate(dateIso, -1);
  const nextDate = shiftIsoDate(dateIso, 1);
  const completionEventByTask = useMemo(() => {
    const map = new Map<string, AtlasJournalEvent>();
    for (const event of livingDay?.journal.events ?? []) {
      if (!event.taskId) continue;
      const current = map.get(event.taskId);
      if (!current || event.occurredAt > current.occurredAt) map.set(event.taskId, event);
    }
    return map;
  }, [livingDay]);
  const standaloneJournalEvents = useMemo(() => (livingDay?.journal.events ?? []).filter((event) => !event.taskId && event.eventKind !== "unlock"), [livingDay]);
  const pageResolved = !loading && progressTasks.length > 0 && finishedProgressTasks.length === progressTasks.length;

  async function toggleTaskCompletion(task: AtlasTaskCard) {
    const complete = isDoneTask(task);
    if (!complete && requiresStructuredResult(task)) { window.location.assign(taskResultHref(task, returnTo)); return; }

    const previousTasks = tasks;
    const transition = complete ? "reopened" : "done";
    setSavingTaskId(task.task_id);
    setError(null);
    setTasks((current) => current.map((row) => row.task_id === task.task_id ? optimisticTask(row, transition) : row));
    try {
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: complete ? { completion_source: "day_timeline_completion_echo" } : { completion_source: "day_timeline_quick_complete", objectStateBefore: objectStateBefore(task) },
      });
      await Promise.all([loadTasks(false), loadLivingDay(false)]);
    } catch (transitionError) {
      setTasks(previousTasks);
      const message = transitionError instanceof Error ? transitionError.message : "Task update failed.";
      setError(message);
      if (complete) window.location.assign(taskResultHref(task, returnTo, true));
    } finally { setSavingTaskId(null); }
  }

  function timelineRow(task: AtlasTaskCard) {
    if (isDoneTask(task)) {
      return <CompletionEcho key={`echo:${task.task_id}`} task={task} event={completionEventByTask.get(task.task_id)} saving={savingTaskId === task.task_id} returnTo={returnTo} onPress={(row) => void toggleTaskCompletion(row)} />;
    }
    return <TaskCard key={task.task_id} task={task} expandable routeState={atlasDayRouteState(task, currentTask?.task_id ?? null)} returnTo={returnTo} onNodePress={(row) => void toggleTaskCompletion(row)} nodeSaving={savingTaskId === task.task_id} />;
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/" className="atlas-note-plus" aria-label="Back to today">+</Link>
        </header>

        <div className="atlas-task-page-body">
          <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
            <div className="atlas-day-browse-head">
              <Link href={routeFilter ? dayHref(dateIso) : "/"} className="atlas-route-back atlas-day-back">{routeFilter ? "← Day plan" : "← Week"}</Link>
              <div className="atlas-day-browse-title-row"><span>{routeFilter ? routeLabels[routeFilter] : dayOnly(dateIso)}</span><strong>{loading ? "Loading" : `${dayTasks.length} open · ${overdueTasks.length} overdue · ${doneDayTasks.length} done`}</strong></div>
              <p>{loading ? "Loading farm work" : routeFilter ? `${filteredTasks.length} ${filteredTasks.length === 1 ? "task" : "tasks"} in this collection` : `${standaloneTasks.length} regular tasks · ${collectionCount} work collections`}</p>
            </div>

            {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
            {livingError ? <div className="atlas-journal-read-error">Journal view unavailable. Today’s tasks remain usable.</div> : null}

            {!routeFilter ? (
              <article className="atlas-day-command-header" data-day-denominator={`${finishedProgressTasks.length}/${progressTasks.length}`}>
                <div className="atlas-day-command-topline">
                  <div className="atlas-day-command-date"><strong>{prettyDate(dateIso)}</strong><span>{loading ? "Loading" : `${openRequiredCount} open${blockedProgressTasks.length ? ` · ${blockedProgressTasks.length} blocked` : ""}`}</span></div>
                  <ViewToggle viewMode={viewMode} onChange={setViewMode} />
                </div>
                <DayTrailSummary compact loading={loading} completed={finishedProgressTasks.length} total={progressTasks.length} blocked={blockedProgressTasks.length} />
                <details className="atlas-day-overview-drawer atlas-day-command-overview">
                  <summary><span className="atlas-day-next-label">Next</span><div className="atlas-day-next-copy"><strong>{currentTask ? atlasTaskDisplay(currentTask).title : loading ? "Loading the day" : "The day is clear"}</strong><em>{currentTask ? collectionZone(currentTask) : "No open required work"}</em></div><b aria-hidden="true">⌄</b></summary>
                  <div className="atlas-day-command-overview-body">
                    {currentTask ? <Link className="atlas-day-open-current" href={taskHref(currentTask, returnTo)}>Open current task <span aria-hidden="true">→</span></Link> : null}
                    {careTasks.length ? <div className="atlas-day-care-lane"><span>Care today</span><p>{careTasks.map((task) => atlasTaskDisplay(task).title).join(" · ")}</p></div> : null}
                    <div className="atlas-day-overview-pills" aria-label="Day work groups">{routeCards.map((entry) => <span key={entry.key}>{entry.key === "germination" ? "Check" : routeLabels[entry.key as RouteKey]} {entry.collection?.dueCount ?? entry.tasks.length}</span>)}</div>
                    <div className="atlas-day-route-grid">{routeCards.length ? routeCards.map((entry) => entry.collection
                      ? <Link key={entry.key} className="atlas-day-route-box" href={entry.collection.href}><strong>{entry.collection.label}</strong><span>{entry.collection.dueCount} due</span><em>{entry.collection.preview}</em></Link>
                      : <Link key={entry.key} className="atlas-day-route-box" href={routeHref(dateIso, entry.key as RouteKey)}><strong>{routeLabels[entry.key as RouteKey]}</strong><span>{entry.tasks.length} {entry.tasks.length === 1 ? "task" : "tasks"}</span><em>{entry.tasks.slice(0, 2).map((task) => atlasTaskDisplay(task).title).join(" · ")}</em></Link>) : <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div>}</div>
                  </div>
                </details>
              </article>
            ) : null}

            {!routeFilter && livingDay ? <LivingDayCarried rhythms={livingDay.carriedRhythms} decisions={livingDay.ownerDecisions} returnTo={returnTo} /> : null}

            {!routeFilter && overdueTasks.length ? (
              <article className="atlas-day-route-group atlas-day-overdue-group" aria-label="Overdue carry-forward work">
                <div className="atlas-day-overdue-group-head"><div><span>Carry forward</span><h3>Overdue</h3></div><b>{overdueTasks.length}</b></div>
                <p>These unfinished tasks remain ahead of today’s regular work.</p>
                <div className="atlas-day-work-order-list">{overdueTasks.map((task) => <TaskCard task={task} overdue key={task.task_id} returnTo={returnTo} />)}</div>
              </article>
            ) : null}

            <div className="atlas-day-task-groups">
              {routeFilter ? (
                <article className="atlas-day-route-group atlas-day-work-order-group"><h3>{routeLabels[routeFilter]}</h3><div className="atlas-day-work-order-list atlas-day-route-spine">{filteredTimelineTasks.map(timelineRow)}{!loading && !filteredTimelineTasks.length ? <div className="atlas-day-route-empty">No open tasks in this collection.</div> : null}</div></article>
              ) : viewMode === "work_order" ? (
                <article className="atlas-day-route-group atlas-day-work-order-group atlas-day-timeline-group"><h3>Today</h3><div className="atlas-day-work-order-list atlas-day-route-spine">{showWeedingCollection && weedingCollection ? <WorkCollectionCard collection={weedingCollection} route /> : null}{showGerminationCollection && germinationCollection ? <WorkCollectionCard collection={germinationCollection} route /> : null}{timelineTasks.map(timelineRow)}{!loading && !collectionCount && !timelineTasks.length ? <div className="atlas-day-route-empty">No open farm tasks planned for this day.</div> : null}</div></article>
              ) : (
                <>{showWeedingCollection && weedingCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{weedingCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={weedingCollection} /></div></article> : null}{showGerminationCollection && germinationCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{germinationCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={germinationCollection} /></div></article> : null}{zones.map((zone) => <article className="atlas-day-route-group" key={zone}><h3>{zone}</h3><div className="atlas-day-zone-group">{filteredTasks.filter((task) => collectionZone(task) === zone).map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}</div></article>)}</>
              )}

              {!routeFilter && livingDay ? <LivingDayGoals goals={livingDay.goals} returnTo={returnTo} /> : null}
              {!routeFilter && livingDay ? <LivingDayJournal events={standaloneJournalEvents} /> : null}
              {!routeFilter && livingDay ? <LivingDayUnlocked unlocks={livingDay.unlockedToday} returnTo={returnTo} /> : null}
              {!routeFilter && pageResolved && livingDay ? <LivingDayCompletionSummary summary={livingDay.completionSummary} /> : null}
              {!routeFilter && livingLoading ? <div className="atlas-journal-loading">Loading Journal and goals…</div> : null}

              {!routeFilter && extraCreditTasks.length ? <article className="atlas-day-route-group atlas-day-extra-credit-group"><h3>Extra Credit</h3><div className="atlas-day-zone-group">{extraCreditTasks.map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}</div></article> : null}

              {!routeFilter && doneStandaloneTasks.length ? (
                <details className="atlas-day-overview-drawer atlas-day-complete-drawer"><summary><span className="atlas-day-complete-label">Complete</span><span className="atlas-day-complete-count">{doneStandaloneTasks.length} {doneStandaloneTasks.length === 1 ? "task" : "tasks"}</span><b aria-hidden="true">⌄</b></summary><div className="atlas-day-complete-body atlas-day-zone-group">{doneStandaloneTasks.map((task) => <TaskCard task={task} complete key={task.task_id} returnTo={returnTo} onNodePress={(row) => void toggleTaskCompletion(row)} nodeSaving={savingTaskId === task.task_id} />)}</div></details>
              ) : null}
            </div>

            {!routeFilter ? <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days"><Link href={dayHref(previousDate)} aria-label="Open yesterday"><span aria-hidden="true">←</span><em>Yesterday</em></Link><Link href={dayHref(nextDate)} aria-label="Open tomorrow"><em>Tomorrow</em><span aria-hidden="true">→</span></Link></nav> : null}
          </section>
        </div>
      </section>
    </main>
  );
}

function DayPageFallback() {
  return <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell"><section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone"><div className="atlas-task-page-body"><section className="atlas-task-page-section atlas-route-collection atlas-day-browse"><div className="atlas-day-route-empty">Loading farm tasks.</div></section></div></section></main>;
}

export default function AtlasDayPage() {
  return <Suspense fallback={<DayPageFallback />}><AtlasDayPageContent /></Suspense>;
}
