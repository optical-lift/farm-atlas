"use client";

import Link from "next/link";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import DayTrailSummary from "@/components/atlas/day-trail-summary";
import {
  LivingDayCarried,
  LivingDayCompletionSummary,
  LivingDayGoals,
  LivingDayJournal,
  LivingDayUnlocked,
} from "@/components/atlas/living-day-primitives";
import { useAtlasWorkerDayProjection } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import {
  atlasDayRouteState,
  atlasDayTaskCues,
  atlasDayTaskFamily,
  atlasDayTaskPartnerKey,
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
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import {
  atlasWorkOrderAnchorForTask,
  atlasWorkOrderLabel,
  atlasWorkOrderNumber,
} from "@/lib/atlas/work-order";

type RouteKey = AtlasWorkRouteKey;
type DayViewMode = "work_order" | "zone";
type WeatherResponse = { ok: boolean; label?: string };
type DayWindowKey = "morning" | "afternoon" | "evening";

type DayWindow = {
  key: DayWindowKey;
  label: string;
  recoveryLabel: string;
  order: number;
};

type DayPartnerPlan = Map<string, { window: DayWindowKey; order: number }>;
type RenderTimelineGroup = { key: string; label: string; tasks: AtlasTaskCard[] };

const routeLabels = atlasRouteLabels;
const routeOrder = atlasRouteOrder;
const dayWindows: DayWindow[] = [
  { key: "morning", label: "Morning", recoveryLabel: "Morning fit", order: 0 },
  { key: "afternoon", label: "Afternoon", recoveryLabel: "Afternoon fit", order: 1 },
  { key: "evening", label: "Evening", recoveryLabel: "Evening fit", order: 2 },
];

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

function prettyShortDate(dateIso: string | null | undefined) {
  if (!dateIso) return "date unknown";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  return task.status !== "archived" && task.status !== "skipped" && !isChildTask(task);
}

function isDashboardWork(task: AtlasTaskCard) {
  return (task.status === "open" || task.status === "blocked") && isWorkTask(task);
}

function isDoneTask(task: AtlasTaskCard) {
  if (task.task_outcomes?.[0]?.outcome === "reopened") return false;
  return task.status === "done" || text(meta(task, "checklist_status")) === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function isOverdueTask(task: AtlasTaskCard, selectedDay: string) {
  return !isDoneTask(task) && Boolean(task.due_date && task.due_date < selectedDay);
}

function overdueAgeDays(task: AtlasTaskCard, selectedDay: string) {
  if (!task.due_date) return 0;
  const due = new Date(`${task.due_date}T12:00:00Z`);
  const selected = new Date(`${selectedDay}T12:00:00Z`);
  if (Number.isNaN(due.getTime()) || Number.isNaN(selected.getTime())) return 0;
  return Math.max(0, Math.round((selected.getTime() - due.getTime()) / 86_400_000));
}

function recurringOccurrence(task: AtlasTaskCard) {
  const interval = Number(meta(task, "repeat_interval_days"));
  return Number.isFinite(interval) && interval > 1
    || Boolean(text(meta(task, "repeat_rule")))
    || Boolean(text(meta(task, "task_series_key")))
    || Boolean(text(meta(task, "engine_instance_key")));
}

function overdueWorkerLine(task: AtlasTaskCard, selectedDay: string, zone: string) {
  if (!task.due_date) return `Still open · ${zone}`;
  if (recurringOccurrence(task)) {
    return `${dayOnly(task.due_date)} occurrence · still open · due ${prettyShortDate(task.due_date)} · ${zone}`;
  }
  return `Still open · due ${prettyShortDate(task.due_date)} · ${zone}`;
}

function dayWindowForTask(task: AtlasTaskCard): DayWindowKey {
  const anchor = atlasWorkOrderAnchorForTask(task);
  if (anchor === "top" || anchor === "morning") return "morning";
  if (anchor === "midday" || anchor === "visibility") return "afternoon";
  return "evening";
}

function dayWindowDefinition(key: DayWindowKey) {
  return dayWindows.find((window) => window.key === key) ?? dayWindows[0];
}

function buildDayPartnerPlan(todayTasks: AtlasTaskCard[]): DayPartnerPlan {
  const candidates = new Map<string, Map<DayWindowKey, { count: number; order: number }>>();

  for (const task of todayTasks) {
    const partnerKey = atlasDayTaskPartnerKey(task);
    if (!partnerKey) continue;
    const window = dayWindowForTask(task);
    const order = atlasWorkOrderNumber(task);
    const byWindow = candidates.get(partnerKey) ?? new Map<DayWindowKey, { count: number; order: number }>();
    const current = byWindow.get(window);
    byWindow.set(window, {
      count: (current?.count ?? 0) + 1,
      order: Math.min(current?.order ?? order, order),
    });
    candidates.set(partnerKey, byWindow);
  }

  const plan: DayPartnerPlan = new Map();
  for (const [partnerKey, byWindow] of candidates) {
    const winner = Array.from(byWindow.entries()).sort((left, right) => {
      if (left[1].count !== right[1].count) return right[1].count - left[1].count;
      const windowDifference = dayWindowDefinition(left[0]).order - dayWindowDefinition(right[0]).order;
      if (windowDifference) return windowDifference;
      return left[1].order - right[1].order;
    })[0];
    if (winner) plan.set(partnerKey, { window: winner[0], order: winner[1].order });
  }
  return plan;
}

function resolvedDayWindowForTask(task: AtlasTaskCard, selectedDay: string, partnerPlan: DayPartnerPlan) {
  const belongsToWorkingDay = task.due_date === selectedDay || isOverdueTask(task, selectedDay);
  const partner = belongsToWorkingDay ? partnerPlan.get(atlasDayTaskPartnerKey(task)) : null;
  return partner?.window ?? dayWindowForTask(task);
}

function resolvedWorkOrderNumber(task: AtlasTaskCard, selectedDay: string, partnerPlan: DayPartnerPlan) {
  const belongsToWorkingDay = task.due_date === selectedDay || isOverdueTask(task, selectedDay);
  const partner = belongsToWorkingDay ? partnerPlan.get(atlasDayTaskPartnerKey(task)) : null;
  return partner?.order ?? atlasWorkOrderNumber(task);
}

function currentDayWindow(hour: number | null): DayWindowKey {
  if (hour === null || hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function upcomingWindowOrder(hour: number | null) {
  const current = dayWindowDefinition(currentDayWindow(hour)).order;
  return [...dayWindows.slice(current), ...dayWindows.slice(0, current)];
}

function mixedDaySortValue(task: AtlasTaskCard, selectedDay: string, partnerPlan: DayPartnerPlan) {
  const window = dayWindowDefinition(resolvedDayWindowForTask(task, selectedDay, partnerPlan)).order;
  const order = String(resolvedWorkOrderNumber(task, selectedDay, partnerPlan)).padStart(5, "0");
  const partnerKey = atlasDayTaskPartnerKey(task);
  const overdueRank = isOverdueTask(task, selectedDay) ? 0 : 1;
  const due = task.due_date ?? "9999-12-31";
  return `${window}-${order}-${partnerKey}-${overdueRank}-${due}-${atlasTaskDisplay(task).title}`;
}

function uniqueTasks(tasks: AtlasTaskCard[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (seen.has(task.task_id)) return false;
    seen.add(task.task_id);
    return true;
  });
}

function nextTaskForCurrentWindow(tasks: AtlasTaskCard[], hour: number | null, selectedDay: string, partnerPlan: DayPartnerPlan) {
  const open = tasks.filter((task) => !isDoneTask(task));
  for (const window of upcomingWindowOrder(hour)) {
    const candidate = open
      .filter((task) => resolvedDayWindowForTask(task, selectedDay, partnerPlan) === window.key)
      .sort((a, b) => mixedDaySortValue(a, selectedDay, partnerPlan).localeCompare(mixedDaySortValue(b, selectedDay, partnerPlan)))[0];
    if (candidate) return candidate;
  }
  return null;
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

function taskAnchorId(task: AtlasTaskCard) {
  return `day-task-${task.task_id}`;
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

function latestEvidence(task: AtlasTaskCard) {
  const outcome = task.task_outcomes?.[0];
  if (outcome) return outcome.note || outcome.blocker_reason || outcome.outcome.replaceAll("_", " ");
  const transition = task.task_transitions?.[0];
  if (transition) return transition.note || transition.reason || transition.transition.replaceAll("_", " ");
  return "No result has been recorded yet.";
}

function shortProjectTitle(title: string) {
  return title
    .replace(/^First Ticketed Thursday\s*[—-]\s*/i, "")
    .replace(/^Get the\s+/i, "")
    .replace(/^Finish the\s+/i, "")
    .trim();
}

function unlockSummary(task: AtlasTaskCard) {
  const unlocks = task.move_context?.unlocks ?? [];
  if (!unlocks.length) return null;
  const assignees = Array.from(new Set(unlocks.map((item) => item.assigneeName).filter(Boolean)));
  if (assignees.length === 1) return unlocks.length === 1 ? `Unlocks ${assignees[0]}` : `Unlocks ${assignees[0]} ×${unlocks.length}`;
  return `Unlocks ${unlocks.length} moves`;
}

function advancesSummary(task: AtlasTaskCard) {
  const projects = task.move_context?.projects ?? [];
  if (!projects.length) return null;
  const primary = shortProjectTitle(projects[0].title);
  return projects.length === 1 ? `Advances ${primary}` : `Advances ${primary} +${projects.length - 1}`;
}

function projectPathLabel(task: AtlasTaskCard, projectIndex: number) {
  const project = task.move_context?.projects?.[projectIndex];
  if (!project) return "";
  return project.path.map((node) => node.title).join(" → ");
}

function whyMoveMatters(task: AtlasTaskCard) {
  const context = task.move_context;
  const primary = context?.projects?.[0];
  if (!primary) return "This task has no project outcome attached yet.";
  if (context.unlocks.length) {
    const noun = context.unlocks.length === 1 ? "downstream move" : "downstream moves";
    return `Finish this and ${context.unlocks.length} ${noun} can move.`;
  }
  if (context.waitingOn.length) return `This advances ${primary.title}, but another move has to land first.`;
  return `This is a concrete move toward ${primary.title}.`;
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
  const timeLine = overdue ? overdueWorkerLine(task, task.due_date ? todayIso() : "", zone) : statusLine;
  const moveContext = task.move_context;
  const projectMove = Boolean(moveContext?.projects?.length);
  const primaryProject = moveContext?.projects?.[0] ?? null;
  const unlockLabel = unlockSummary(task);
  const advancesLabel = advancesSummary(task);
  const familyLabel = projectMove && primaryProject ? `Project move · ${shortProjectTitle(primaryProject.title)}` : family;

  const summaryContent = (
    <>
      {!complete ? <small className="atlas-day-task-family">{routeState === "current" ? `Current · ${familyLabel}` : familyLabel}</small> : null}
      <strong>{display.title}</strong>
      <span>{complete ? "Complete" : timeLine}</span>
      {display.detail ? <em>{display.detail}</em> : null}
      {!complete && projectMove ? (
        <span className="atlas-day-project-impact">
          {unlockLabel ? <i>{unlockLabel}</i> : null}
          {advancesLabel ? <i>{advancesLabel}</i> : null}
        </span>
      ) : !complete && cues.length ? <span className="atlas-day-task-cues">{cues.map((cue) => <i key={cue}>{cue}</i>)}</span> : null}
    </>
  );

  const card = expandable ? (
    <details id={onNodePress ? undefined : taskAnchorId(task)} className={`${className} atlas-journal-task-row${projectMove ? " atlas-project-move-card" : ""}`} aria-current={routeState === "current" ? "step" : undefined}>
      <summary>{summaryContent}<b className="atlas-journal-row-caret" aria-hidden="true">⌄</b></summary>
      <div className="atlas-journal-task-detail">
        {projectMove && moveContext ? (
          <div className="atlas-project-move-context">
            <section className="atlas-project-move-block atlas-project-move-why">
              <small>Why this move matters</small>
              <strong>{whyMoveMatters(task)}</strong>
            </section>

            {moveContext.unlocks.length ? (
              <section className="atlas-project-move-block">
                <small>Unlocks</small>
                <div className="atlas-project-move-list">
                  {moveContext.unlocks.map((item) => (
                    <div className="atlas-project-move-row" key={item.taskId}>
                      <b>{item.assigneeName} →</b><span>{item.title}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="atlas-project-move-block">
              <small>Advances</small>
              <div className="atlas-project-move-list">
                {moveContext.projects.map((project, index) => (
                  <Link className="atlas-project-move-path" href={`/project/${encodeURIComponent(project.projectId)}`} key={project.projectId}>
                    <span>{projectPathLabel(task, index)}</span>
                    {project.portfolioType === "event" && project.targetDate ? <em>{prettyShortDate(project.targetDate)}</em> : <em>{project.portfolioType.replaceAll("_", " ")}</em>}
                  </Link>
                ))}
              </div>
            </section>

            <section className="atlas-project-move-block">
              <small>Waiting on</small>
              {moveContext.waitingOn.length ? (
                <div className="atlas-project-move-list">
                  {moveContext.waitingOn.map((item) => (
                    <div className="atlas-project-move-row is-waiting" key={item.taskId}>
                      <b>{item.assigneeName} →</b><span>{item.title}</span>
                    </div>
                  ))}
                </div>
              ) : <strong>Nothing. This is your move.</strong>}
            </section>
          </div>
        ) : (
          <dl>
            <div><dt>Place</dt><dd>{task.objects.length ? task.objects.map((object) => object.object_label).join(" · ") : zone}</dd></div>
            <div><dt>Time</dt><dd>{task.due_date ? prettyDate(task.due_date) : "No date recorded"}</dd></div>
            <div><dt>Evidence</dt><dd>{latestEvidence(task)}</dd></div>
            <div><dt>Effect</dt><dd>{task.unlock_text || task.blocker_text || "No secondary effect is recorded."}</dd></div>
          </dl>
        )}
        <Link href={taskHref(task, returnTo)}>Open full task <span aria-hidden="true">→</span></Link>
      </div>
    </details>
  ) : (
    <Link id={onNodePress ? undefined : taskAnchorId(task)} className={className} href={taskHref(task, returnTo)} aria-current={routeState === "current" ? "step" : undefined}>
      {summaryContent}
    </Link>
  );

  if (!onNodePress) return card;
  return (
    <div id={taskAnchorId(task)} className={`atlas-day-task-entry${complete ? " atlas-day-complete-entry" : ""}${overdue ? " atlas-day-overdue-entry" : ""}${routeClass ? ` ${routeClass}` : ""}`}>
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
    <div id={taskAnchorId(task)} className="atlas-day-completion-echo" data-completed-task-id={task.task_id}>
      <button type="button" className={saving ? "is-saving" : ""} aria-label={`Uncomplete ${label}`} aria-pressed="true" disabled={saving} onClick={() => onPress(task)}><span aria-hidden="true" /></button>
      <details className="atlas-journal-completion-echo-copy">
        <summary><strong>{label}</strong><span>{effect.replaceAll("_", " ")}</span><b aria-hidden="true">⌄</b></summary>
        <div><span>{event ? `Journal · ${event.sourceEvent.replaceAll("_", " ")}` : "Canonical task result"}</span><Link href={taskHref(task, returnTo)}>Open result <span aria-hidden="true">→</span></Link></div>
      </details>
    </div>
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
  const calendarToday = todayIso();
  const isFutureDay = dateIso > calendarToday;
  const requestedRoute = searchParams.get("route");
  const requestedView = searchParams.get("view");
  const routeFilter = requestedRoute && routeOrder.includes(requestedRoute as RouteKey) ? requestedRoute as RouteKey : null;
  const { taskCards: tasks, loading, error: runtimeError } = useAtlasWorkerDayProjection(dateIso);
  const [livingDay, setLivingDay] = useState<AtlasLivingDay | null>(null);
  const [livingLoading, setLivingLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [livingError, setLivingError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [viewMode, setViewMode] = useState<DayViewMode>("work_order");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [localHour, setLocalHour] = useState<number | null>(null);
  const livingRequestSequence = useRef(0);
  const error = taskError ?? runtimeError;

  useEffect(() => {
    if (requestedView === "zone" || requestedView === "area") setViewMode("zone");
    else setViewMode("work_order");
  }, [requestedView, dateIso]);

  useEffect(() => {
    setTaskError(null);
  }, [dateIso]);

  useEffect(() => {
    const update = () => setLocalHour(new Date().getHours());
    update();
    const timer = window.setInterval(update, 300_000);
    return () => window.clearInterval(timer);
  }, []);

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

  useEffect(() => {
    if (loading) return;
    void loadLivingDay(true);
  }, [loading, loadLivingDay]);

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

  const allDayTasks = useMemo(() => tasks.filter(isWorkTask), [tasks]);
  const dayTasks = useMemo(() => tasks.filter(isDashboardWork), [tasks]);
  const requiredTasks = useMemo(() => dayTasks.filter((task) => !isExtraCredit(task)), [dayTasks]);
  const extraCreditTasks = useMemo(() => dayTasks.filter(isExtraCredit), [dayTasks]);
  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask).filter((task) => !isExtraCredit(task)), [allDayTasks]);
  const partnerPlan = useMemo(() => buildDayPartnerPlan(allDayTasks.filter((task) => !isExtraCredit(task))), [allDayTasks]);
  const overdueTasks = useMemo(() => {
    if (dateIso !== calendarToday) return [];
    return dayTasks
      .filter((task) => Boolean(task.due_date && task.due_date < dateIso))
      .filter((task) => !isExtraCredit(task))
      .sort((a, b) => mixedDaySortValue(a, dateIso, partnerPlan).localeCompare(mixedDaySortValue(b, dateIso, partnerPlan)));
  }, [calendarToday, dateIso, dayTasks, partnerPlan]);
  const mixedOpenTasks = useMemo(() => uniqueTasks(requiredTasks), [requiredTasks]);
  const timelineTasks = useMemo(() => uniqueTasks([...mixedOpenTasks, ...doneDayTasks]).sort((a, b) => mixedDaySortValue(a, dateIso, partnerPlan).localeCompare(mixedDaySortValue(b, dateIso, partnerPlan))), [dateIso, doneDayTasks, mixedOpenTasks, partnerPlan]);
  const filteredTimelineTasks = useMemo(() => routeFilter ? timelineTasks.filter((task) => atlasRouteKeyForTask(task) === routeFilter) : timelineTasks, [routeFilter, timelineTasks]);
  const filteredTasks = useMemo(() => routeFilter ? mixedOpenTasks.filter((task) => atlasRouteKeyForTask(task) === routeFilter) : mixedOpenTasks, [mixedOpenTasks, routeFilter]);
  const progressTasks = timelineTasks;
  const finishedProgressTasks = useMemo(() => progressTasks.filter(isDoneTask), [progressTasks]);
  const blockedProgressTasks = useMemo(() => progressTasks.filter((task) => task.status === "blocked" && !isDoneTask(task)), [progressTasks]);
  const currentTask = useMemo(() => dateIso === calendarToday ? nextTaskForCurrentWindow(filteredTimelineTasks, localHour, dateIso, partnerPlan) : null, [calendarToday, dateIso, filteredTimelineTasks, localHour, partnerPlan]);
  const nextRecoveryTask = useMemo(() => nextTaskForCurrentWindow(overdueTasks, localHour, dateIso, partnerPlan), [dateIso, localHour, overdueTasks, partnerPlan]);
  const nextRecoveryWindow = nextRecoveryTask ? dayWindowDefinition(resolvedDayWindowForTask(nextRecoveryTask, dateIso, partnerPlan)) : null;
  const openRequiredCount = mixedOpenTasks.length;
  const zones = useMemo(() => Array.from(new Set(filteredTasks.map(collectionZone))).sort((a, b) => a.localeCompare(b)), [filteredTasks]);
  const recoveryGroups = useMemo(() => dayWindows.map((window) => ({
    ...window,
    tasks: overdueTasks.filter((task) => resolvedDayWindowForTask(task, dateIso, partnerPlan) === window.key),
  })).filter((window) => window.tasks.length), [dateIso, overdueTasks, partnerPlan]);
  const timelineGroups = useMemo<RenderTimelineGroup[]>(() => dayWindows.map((window) => ({
    ...window,
    tasks: filteredTimelineTasks.filter((task) => resolvedDayWindowForTask(task, dateIso, partnerPlan) === window.key),
  })).filter((window) => window.tasks.length), [dateIso, filteredTimelineTasks, partnerPlan]);
  const visibleTimelineGroups = timelineGroups;

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

    const transition = complete ? "reopened" : "done";
    setSavingTaskId(task.task_id);
    setTaskError(null);
    try {
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: complete ? { completion_source: "day_timeline_completion_echo" } : { completion_source: "day_timeline_quick_complete", objectStateBefore: objectStateBefore(task) },
      });
      await loadLivingDay(false);
    } catch (transitionError) {
      const message = transitionError instanceof Error ? transitionError.message : "Task update failed.";
      setTaskError(message);
      if (complete) window.location.assign(taskResultHref(task, returnTo, true));
    } finally { setSavingTaskId(null); }
  }

  function timelineRow(task: AtlasTaskCard) {
    if (isDoneTask(task)) {
      return <CompletionEcho key={`echo:${task.task_id}`} task={task} event={completionEventByTask.get(task.task_id)} saving={savingTaskId === task.task_id} returnTo={returnTo} onPress={(row) => void toggleTaskCompletion(row)} />;
    }
    const overdue = isOverdueTask(task, dateIso);
    return <TaskCard key={task.task_id} task={task} overdue={overdue} expandable routeState={atlasDayRouteState(task, currentTask?.task_id ?? null)} returnTo={returnTo} onNodePress={(row) => void toggleTaskCompletion(row)} nodeSaving={savingTaskId === task.task_id} />;
  }

  function windowedTimeline(groups: RenderTimelineGroup[]) {
    return groups.map((group) => {
      const isCurrentWindow = dateIso === calendarToday && group.key === currentDayWindow(localHour);
      return (
        <Fragment key={group.key}>
          <div className="atlas-day-window-marker" data-day-window={group.key} data-current-window={isCurrentWindow ? "true" : "false"}>
            <span>{group.label}</span><em>{group.tasks.filter((task) => !isDoneTask(task)).length} remaining{isCurrentWindow ? " · current window" : ""}</em>
          </div>
          {group.tasks.map(timelineRow)}
        </Fragment>
      );
    });
  }

  return (
    <>
      <style>{`
        .atlas-day-project-impact { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
        .atlas-day-project-impact i {
          display: inline-flex;
          align-items: center;
          min-height: 20px;
          padding: 3px 7px;
          border: 1px solid rgba(85, 90, 134, .16);
          border-radius: 999px;
          background: rgba(174, 179, 212, .13);
          color: #5f6282;
          font-size: 9px;
          line-height: 1.1;
          font-style: normal;
          font-weight: 900;
        }
        .atlas-project-move-card > summary { background: linear-gradient(90deg, rgba(174,179,212,.055), transparent 62%); }
        .atlas-project-move-context { display: grid; gap: 0; }
        .atlas-project-move-block { display: grid; gap: 7px; padding: 11px 0; border-top: 1px solid rgba(88,87,111,.1); }
        .atlas-project-move-block:first-child { padding-top: 1px; border-top: 0; }
        .atlas-project-move-block > small {
          color: #8881b7;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .atlas-project-move-block > strong { color: #303243; font-size: 12px; line-height: 1.4; }
        .atlas-project-move-list { display: grid; gap: 6px; }
        .atlas-project-move-row {
          display: grid;
          grid-template-columns: auto minmax(0,1fr);
          gap: 5px;
          align-items: baseline;
          padding: 7px 9px;
          border-radius: 10px;
          background: rgba(216,220,151,.17);
          color: #4f514c;
          font-size: 10px;
          line-height: 1.3;
        }
        .atlas-project-move-row.is-waiting { background: rgba(213,200,212,.18); }
        .atlas-project-move-row b { color: #5f6282; white-space: nowrap; }
        .atlas-project-move-path {
          display: flex !important;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 9px !important;
          border: 1px solid rgba(88,87,111,.1);
          border-radius: 10px;
          color: #303243 !important;
          text-decoration: none;
          font-size: 10px !important;
          font-weight: 800;
        }
        .atlas-project-move-path span { min-width: 0; line-height: 1.3; }
        .atlas-project-move-path em { color: #8881b7; font-size: 8px; font-style: normal; text-transform: uppercase; white-space: nowrap; }
      `}</style>
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
                <div className="atlas-day-browse-title-row"><span>{routeFilter ? routeLabels[routeFilter] : dayOnly(dateIso)}</span><strong>{loading ? "Loading" : isFutureDay ? `${openRequiredCount} scheduled · ${doneDayTasks.length} done` : `${openRequiredCount} open · ${overdueTasks.length} carried · ${doneDayTasks.length} done`}</strong></div>
                <p>{loading ? "Loading farm work" : routeFilter ? `${filteredTasks.length} ${filteredTasks.length === 1 ? "task" : "tasks"} in this collection` : isFutureDay ? `${openRequiredCount} tasks scheduled for this day` : `${openRequiredCount} unfinished tasks in the real day`}</p>
              </div>

              {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
              {livingError ? <div className="atlas-journal-read-error">Journal view unavailable. Today’s tasks remain usable.</div> : null}

              {!routeFilter ? (
                <article className={`atlas-day-command-header${overdueTasks.length ? " atlas-day-command-header-with-recovery" : ""}`} data-day-denominator={`${finishedProgressTasks.length}/${progressTasks.length}`}>
                  <div className="atlas-day-command-topline">
                    <div className="atlas-day-command-date"><strong>{prettyDate(dateIso)}</strong><span>{loading ? "Loading" : `${openRequiredCount} ${isFutureDay ? "scheduled" : "still in today"}${blockedProgressTasks.length ? ` · ${blockedProgressTasks.length} blocked` : ""}`}</span></div>
                    <ViewToggle viewMode={viewMode} onChange={setViewMode} />
                  </div>
                  <DayTrailSummary compact loading={loading} completed={finishedProgressTasks.length} total={progressTasks.length} blocked={blockedProgressTasks.length} />
                  {overdueTasks.length ? (
                    <details className="atlas-day-overview-drawer atlas-day-command-overview atlas-day-recovery-overview">
                      <summary>
                        <span className="atlas-day-recovery-count" aria-label={`${overdueTasks.length} carried tasks`}>{overdueTasks.length}</span>
                        <div className="atlas-day-recovery-summary-copy">
                          <span>Carried work</span>
                          <strong>{nextRecoveryTask ? `Next carried move · ${atlasTaskDisplay(nextRecoveryTask).title}` : "Carried work is waiting"}</strong>
                          <em>{nextRecoveryTask && nextRecoveryWindow ? `${nextRecoveryWindow.recoveryLabel} · due ${prettyShortDate(nextRecoveryTask.due_date)}` : "Open carried work"}</em>
                        </div>
                        <b aria-hidden="true">⌄</b>
                      </summary>
                      <div className="atlas-day-command-overview-body atlas-day-recovery-overview-body">
                        <p>Unfinished work from earlier days is still real. Atlas places it where it best fits today.</p>
                        {recoveryGroups.map((group) => (
                          <section className="atlas-day-recovery-window" data-recovery-window={group.key} key={group.key}>
                            <header><strong>{group.recoveryLabel}</strong><span>{group.tasks.length}</span></header>
                            <div className="atlas-day-recovery-chip-list">
                              {group.tasks.map((task) => (
                                <a href={`#${taskAnchorId(task)}`} key={task.task_id}>
                                  <strong>{atlasTaskDisplay(task).title}</strong>
                                  <span>{overdueAgeDays(task, dateIso)}d · due {prettyShortDate(task.due_date)}</span>
                                </a>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              ) : null}

              {!routeFilter && !isFutureDay && livingDay ? <LivingDayCarried rhythms={livingDay.carriedRhythms} decisions={livingDay.ownerDecisions} returnTo={returnTo} /> : null}

              <div className="atlas-day-task-groups">
                {routeFilter ? (
                  <article className="atlas-day-route-group atlas-day-work-order-group"><h3>{routeLabels[routeFilter]}</h3><div className="atlas-day-work-order-list atlas-day-route-spine atlas-day-mixed-timeline">{windowedTimeline(visibleTimelineGroups)}{!loading && !filteredTimelineTasks.length ? <div className="atlas-day-route-empty">No open tasks in this collection.</div> : null}</div></article>
                ) : viewMode === "work_order" ? (
                  <article className="atlas-day-route-group atlas-day-work-order-group atlas-day-timeline-group"><h3>Work the day</h3><div className="atlas-day-work-order-list atlas-day-route-spine atlas-day-mixed-timeline">{windowedTimeline(visibleTimelineGroups)}{!loading && !timelineTasks.length ? <div className="atlas-day-route-empty">No open farm tasks planned for this day.</div> : null}</div></article>
                ) : (
                  <>{zones.map((zone) => <article className="atlas-day-route-group" key={zone}><h3>{zone}</h3><div className="atlas-day-zone-group">{filteredTasks.filter((task) => collectionZone(task) === zone).sort((a, b) => mixedDaySortValue(a, dateIso, partnerPlan).localeCompare(mixedDaySortValue(b, dateIso, partnerPlan))).map((task) => <TaskCard task={task} overdue={isOverdueTask(task, dateIso)} key={task.task_id} returnTo={returnTo} />)}</div></article>)}</>
                )}

                {!routeFilter && livingDay ? <LivingDayGoals goals={livingDay.goals} returnTo={returnTo} /> : null}
                {!routeFilter && livingDay ? <LivingDayJournal events={standaloneJournalEvents} /> : null}
                {!routeFilter && livingDay ? <LivingDayUnlocked unlocks={livingDay.unlockedToday} returnTo={returnTo} /> : null}
                {!routeFilter && pageResolved && livingDay ? <LivingDayCompletionSummary summary={livingDay.completionSummary} /> : null}
                {!routeFilter && livingLoading ? <div className="atlas-journal-loading">Loading Journal and goals…</div> : null}

                {!routeFilter && extraCreditTasks.length ? <article className="atlas-day-route-group atlas-day-extra-credit-group"><h3>Extra Credit</h3><div className="atlas-day-zone-group">{extraCreditTasks.map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}</div></article> : null}
              </div>

              {!routeFilter ? <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days"><Link href={dayHref(previousDate)} aria-label="Open yesterday"><span aria-hidden="true">←</span><em>Yesterday</em></Link><Link href={dayHref(nextDate)} aria-label="Open tomorrow"><em>Tomorrow</em><span aria-hidden="true">→</span></Link></nav> : null}
            </section>
          </div>
        </section>
      </main>
    </>
  );
}

function DayPageFallback() {
  return <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell"><section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone"><div className="atlas-task-page-body"><section className="atlas-task-page-section atlas-route-collection atlas-day-browse"><div className="atlas-day-route-empty">Loading farm tasks.</div></section></div></section></main>;
}

export default function AtlasDayPage() {
  return <Suspense fallback={<DayPageFallback />}><AtlasDayPageContent /></Suspense>;
}
