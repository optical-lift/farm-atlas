"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
} from "react";

import styles from "./active-outcome-studies.module.css";
import smartStyles from "./smart-day-study.module.css";

type Actor = "You" | "Anna" | "Marshall";
type DayView = "clock" | "day";
type FeedScope = "mine" | "team";
type FocusTier = "focus" | "near" | "context";
type SignalKind = "progress" | "readiness" | "consequence" | "context";

type TaskHealth = {
  done: number;
  total: number;
  noun: string;
};

type OccupiedTime = {
  label: string;
  timeRange: string;
  actor: Actor | "All";
};

type TaskIntelligence = {
  taskHealth?: TaskHealth;
  workContext: string;
  lifecycleState?: string;
  operatingCondition?: string;
  readiness?: string;
  migrationOrigin?: string;
  unlockPath?: string[];
  consequencePriority?: number;
};

type TaskDatum = {
  id: string;
  family: string;
  title: string;
  place: string;
  amount: string;
  time: string;
  minuteOfDay: number;
  durationMinutes: number;
  placementSource: "fixed" | "atlas-fit";
  actor: Actor;
  railPosition: number;
  occupiedBefore?: OccupiedTime;
  intelligence: TaskIntelligence;
};

type ProgressiveSignal = {
  kind: SignalKind;
  compact: string;
  detail: string;
  priority: number;
};

type CloseoutFixture = {
  taskId: string;
  disposition: string;
  detail: string;
  priority: number;
};

const TASKS: TaskDatum[] = [
  {
    id: "farm-round",
    family: "STEWARDSHIP",
    title: "Farm Round · Elm Farm",
    place: "Elm Farm",
    amount: "45 min",
    time: "8:00 AM",
    minuteOfDay: 8 * 60,
    durationMinutes: 45,
    placementSource: "atlas-fit",
    actor: "Anna",
    railPosition: 7,
    intelligence: {
      taskHealth: { done: 5, total: 6, noun: "stops" },
      workContext: "Elm Farm route",
    },
  },
  {
    id: "marshfield-outreach",
    family: "OUTREACH",
    title: "Call Marshfield businesses",
    place: "Office",
    amount: "8 calls",
    time: "8:50 AM",
    minuteOfDay: 8 * 60 + 50,
    durationMinutes: 35,
    placementSource: "atlas-fit",
    actor: "You",
    railPosition: 15,
    intelligence: {
      taskHealth: { done: 3, total: 8, noun: "calls" },
      workContext: "Marshfield outreach",
      lifecycleState: "FOLLOW-UP DUE",
      operatingCondition: "BUSINESS HOURS",
      unlockPath: ["Qualified lead follow-up · Thu"],
      consequencePriority: 60,
    },
  },
  {
    id: "mg11-weed",
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
    time: "10:15 AM",
    minuteOfDay: 10 * 60 + 15,
    durationMinutes: 30,
    placementSource: "atlas-fit",
    actor: "Anna",
    railPosition: 25,
    occupiedBefore: {
      label: "Supplier delivery window",
      timeRange: "9:40–10:00",
      actor: "All",
    },
    intelligence: {
      workContext: "Field route",
      lifecycleState: "WEED CHECK DUE",
      operatingCondition: "COOL WINDOW",
      migrationOrigin: "Tue",
    },
  },
  {
    id: "upick-string",
    family: "SETUP",
    title: "String U-Pick arches",
    place: "U-Pick",
    amount: "8 beds",
    time: "11:00 AM",
    minuteOfDay: 11 * 60,
    durationMinutes: 40,
    placementSource: "atlas-fit",
    actor: "Anna",
    railPosition: 33,
    intelligence: {
      taskHealth: { done: 6, total: 8, noun: "beds" },
      workContext: "Field route",
    },
  },
  {
    id: "weekly-harvest",
    family: "HARVEST",
    title: "Weekly stems",
    place: "Field + Barn Beds",
    amount: "5 zones",
    time: "12:20 PM",
    minuteOfDay: 12 * 60 + 20,
    durationMinutes: 45,
    placementSource: "atlas-fit",
    actor: "Anna",
    railPosition: 43,
    occupiedBefore: {
      label: "Mary pickup",
      timeRange: "11:50–12:10",
      actor: "Anna",
    },
    intelligence: {
      taskHealth: { done: 3, total: 5, noun: "zones" },
      workContext: "Field route",
      lifecycleState: "HARVEST WINDOW",
    },
  },
  {
    id: "farmhouse-tidy",
    family: "TIDY",
    title: "Farmhouse",
    place: "Interior",
    amount: "30 min · Event prep",
    time: "1:30 PM",
    minuteOfDay: 13 * 60 + 30,
    durationMinutes: 30,
    placementSource: "atlas-fit",
    actor: "Anna",
    railPosition: 53,
    intelligence: {
      taskHealth: { done: 3, total: 5, noun: "areas" },
      workContext: "Venue prep",
      lifecycleState: "EVENT TOMORROW",
      unlockPath: ["Thursday Ticketed Night · Aug 27", "Venue ready"],
      consequencePriority: 100,
    },
  },
  {
    id: "ticket-counts",
    family: "ADMIN",
    title: "Confirm Thursday ticket counts",
    place: "Office",
    amount: "25 min",
    time: "3:10 PM",
    minuteOfDay: 15 * 60 + 10,
    durationMinutes: 25,
    placementSource: "atlas-fit",
    actor: "You",
    railPosition: 62,
    occupiedBefore: {
      label: "Vendor call",
      timeRange: "2:30–3:00",
      actor: "You",
    },
    intelligence: {
      workContext: "Venue prep",
      lifecycleState: "EVENT TOMORROW",
    },
  },
  {
    id: "sweet-william-pot-up",
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    time: "4:06 PM",
    minuteOfDay: 16 * 60 + 6,
    durationMinutes: 50,
    placementSource: "atlas-fit",
    actor: "Anna",
    railPosition: 69,
    intelligence: {
      taskHealth: { done: 2, total: 3, noun: "trays" },
      workContext: "Grow Room",
      lifecycleState: "POT-UP WINDOW",
    },
  },
  {
    id: "north-lawn-mow",
    family: "MOW",
    title: "North Lawn",
    place: "North Grounds",
    amount: "35 min",
    time: "5:25 PM",
    minuteOfDay: 17 * 60 + 25,
    durationMinutes: 35,
    placementSource: "atlas-fit",
    actor: "Marshall",
    railPosition: 81,
    intelligence: {
      workContext: "Grounds",
      readiness: "BATTERY READY",
    },
  },
  {
    id: "bb10-spray",
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    time: "7:00 PM",
    minuteOfDay: 19 * 60,
    durationMinutes: 20,
    placementSource: "fixed",
    actor: "Anna",
    railPosition: 94,
    intelligence: {
      workContext: "Field route",
      lifecycleState: "PASS 1 DUE",
      operatingCondition: "LOW WIND",
      unlockPath: ["Bermuda Pass 2", "Choose Overwintering Crop · Sep 15"],
      consequencePriority: 75,
    },
  },
];

const CLOSEOUT_FIXTURES: CloseoutFixture[] = [
  {
    taskId: "farmhouse-tidy",
    disposition: "NEEDS MANAGER",
    detail: "3/5 · unlocks event tomorrow",
    priority: 100,
  },
  {
    taskId: "mg11-weed",
    disposition: "REVIEW CARRY",
    detail: "↳ Tue · second carry",
    priority: 90,
  },
  {
    taskId: "marshfield-outreach",
    disposition: "→ THU",
    detail: "3/8 · follow-up remains valid",
    priority: 70,
  },
];

const NOW_TASK_ID = "sweet-william-pot-up";
const NOW_MINUTE = 16 * 60 + 6;
const NOW_LABEL = "4:06 PM";

// Fixture-only geometry for the compact smart rail. Production derives the
// layers independently from governed Clock and result truth.
const SMART_PROGRESS_FRONTIER = 43;
const CURRENT_TIME_POSITION = 69;

function tasksForScope(scope: FeedScope) {
  return scope === "team" ? TASKS : TASKS.filter((task) => task.actor === "You");
}

function occupiedTimeVisible(occupied: OccupiedTime, scope: FeedScope) {
  return scope === "team" || occupied.actor === "All" || occupied.actor === "You";
}

function closestTaskToMinute(tasks: TaskDatum[], minute: number) {
  return tasks.reduce((closest, task) => (
    Math.abs(task.minuteOfDay - minute) < Math.abs(closest.minuteOfDay - minute) ? task : closest
  ));
}

function defaultFocusForScope(scope: FeedScope) {
  const tasks = tasksForScope(scope);
  return tasks.find((task) => task.id === NOW_TASK_ID) ?? closestTaskToMinute(tasks, NOW_MINUTE);
}

function progressiveSignals(task: TaskDatum): ProgressiveSignal[] {
  const signals: ProgressiveSignal[] = [];
  const intelligence = task.intelligence;

  if (intelligence.taskHealth) {
    const health = intelligence.taskHealth;
    signals.push({
      kind: "progress",
      compact: `${health.done}/${health.total}`,
      detail: `${health.done} of ${health.total} ${health.noun}`,
      priority: 100,
    });
  }

  if (intelligence.readiness) {
    signals.push({
      kind: "readiness",
      compact: intelligence.readiness,
      detail: intelligence.readiness,
      priority: 92,
    });
  }

  if (intelligence.unlockPath?.length) {
    signals.push({
      kind: "consequence",
      compact: "↳",
      detail: `UNLOCKS ${intelligence.unlockPath[0]}`,
      priority: 88,
    });
  }

  if (intelligence.migrationOrigin) {
    signals.push({
      kind: "context",
      compact: `↳ ${intelligence.migrationOrigin}`,
      detail: `Carried from ${intelligence.migrationOrigin}`,
      priority: 84,
    });
  }

  if (intelligence.operatingCondition) {
    signals.push({
      kind: "context",
      compact: intelligence.operatingCondition,
      detail: intelligence.operatingCondition,
      priority: 80,
    });
  }

  if (intelligence.lifecycleState) {
    signals.push({
      kind: "context",
      compact: intelligence.lifecycleState,
      detail: intelligence.lifecycleState,
      priority: 70,
    });
  }

  signals.push({
    kind: "context",
    compact: intelligence.workContext,
    detail: intelligence.workContext,
    priority: 40,
  });

  return signals.sort((a, b) => b.priority - a.priority);
}

function signalsForTier(task: TaskDatum, tier: FocusTier) {
  const ranked = progressiveSignals(task);

  if (tier === "context") {
    const tiny = ranked.find((signal) => signal.kind === "progress" || signal.kind === "readiness");
    return tiny ? [tiny] : [];
  }

  if (tier === "near") return ranked.slice(0, 1);

  const withoutDuplicatedConsequence = task.intelligence.unlockPath?.length
    ? ranked.filter((signal) => signal.kind !== "consequence")
    : ranked;
  return withoutDuplicatedConsequence.slice(0, 2);
}

function consequentialTaskForScope(scope: FeedScope) {
  return tasksForScope(scope)
    .filter((task) => task.intelligence.unlockPath?.length)
    .sort((a, b) => (b.intelligence.consequencePriority ?? 0) - (a.intelligence.consequencePriority ?? 0))[0] ?? null;
}

// Chronicle-style focus + context geometry. Every visible task keeps a share of
// the bounded viewport. Focus earns detail; distant context never disappears.
function chronicleFocusWeight(distance: number) {
  if (distance === 0) return 4.2;
  if (distance === 1) return 2.15;
  if (distance === 2) return 1.25;
  return 0.78;
}

function focusDistanceTier(distance: number): FocusTier {
  if (distance === 0) return "focus";
  if (distance === 1) return "near";
  return "context";
}

function AppHeader() {
  return (
    <header className={styles.appHeader}>
      <div><span>ATLAS</span><strong>Elm Farm</strong></div>
      <span>clear · 93°</span>
      <button type="button" disabled aria-label="Fixture exit to parent">×</button>
    </header>
  );
}

function ViewToggle({ view, onChange }: { view: DayView; onChange: (view: DayView) => void }) {
  return (
    <div className={smartStyles.viewToggle} role="group" aria-label="Clock or day task-feed view">
      <button type="button" data-active={view === "clock" ? "true" : "false"} onClick={() => onChange("clock")}>Clock</button>
      <button type="button" data-active={view === "day" ? "true" : "false"} onClick={() => onChange("day")}>Day</button>
    </div>
  );
}

function DayHeader({ view, onChange }: { view: DayView; onChange: (view: DayView) => void }) {
  return (
    <section className={styles.dayHeader}>
      <div className={styles.dayHeaderTop}>
        <div className={styles.dayIdentity}>
          <span>WEDNESDAY</span>
          <strong>Aug 26</strong>
        </div>
        <ViewToggle view={view} onChange={onChange} />
      </div>
    </section>
  );
}

function DayNavigation({ position }: { position: "top" | "bottom" }) {
  return (
    <nav className={smartStyles.dayNavigation} data-position={position} aria-label={`${position} adjacent day navigation fixture`}>
      <button type="button">‹ Tue 25</button>
      <span>TODAY</span>
      <button type="button">Thu 27 ›</button>
    </nav>
  );
}

function ManagerScopeToggle({ scope, onChange }: { scope: FeedScope; onChange: (scope: FeedScope) => void }) {
  return (
    <div className={smartStyles.managerScopeLine}>
      <span>MANAGER FEED</span>
      <div role="group" aria-label="Manager feed scope">
        <button type="button" data-active={scope === "mine" ? "true" : "false"} onClick={() => onChange("mine")}>Mine</button>
        <button type="button" data-active={scope === "team" ? "true" : "false"} onClick={() => onChange("team")}>Team</button>
      </div>
    </div>
  );
}

function SmartDayRail({ scope }: { scope: FeedScope }) {
  return (
    <div
      className={smartStyles.smartRail}
      aria-label="Fixture smart day rail: earned chronological progress, current time, and visible task placements"
    >
      <i className={smartStyles.smartRailBase} aria-hidden="true" />
      <i
        className={smartStyles.smartRailProgress}
        style={{ width: `${SMART_PROGRESS_FRONTIER}%` }}
        aria-hidden="true"
      />
      {tasksForScope(scope).map((task) => (
        <i
          className={smartStyles.smartRailTaskDot}
          style={{ left: `${task.railPosition}%` }}
          aria-hidden="true"
          key={task.id}
        />
      ))}
      <b
        className={smartStyles.smartRailNowDot}
        style={{ left: `${CURRENT_TIME_POSITION}%` }}
        aria-hidden="true"
      />
      <small
        className={smartStyles.smartRailNowLabel}
        style={{ left: `${CURRENT_TIME_POSITION}%` }}
      >{NOW_LABEL}</small>
    </div>
  );
}

function ConsequenceRow({ task }: { task: TaskDatum | null }) {
  if (!task?.intelligence.unlockPath?.length) return null;
  const [first, ...rest] = task.intelligence.unlockPath;

  return (
    <section className={smartStyles.consequenceRow} aria-label="Most consequential unresolved unlock fixture">
      <div className={smartStyles.consequenceSource}>
        <span>STILL OPEN</span>
        <strong>{task.family} · {task.title}</strong>
      </div>
      <div className={smartStyles.consequenceUnlock}>
        <i aria-hidden="true" />
        <div>
          <span>UNLOCKS</span>
          <strong>{first}</strong>
          {rest.length ? <small>{rest.map((target) => `→ ${target}`).join("   ")}</small> : null}
        </div>
      </div>
    </section>
  );
}

function DaySummaryPanel({
  scope,
  onScopeChange,
}: {
  scope: FeedScope;
  onScopeChange: (scope: FeedScope) => void;
}) {
  const consequenceTask = consequentialTaskForScope(scope);

  return (
    <section className={smartStyles.daySummaryPanel} aria-label="Atlas day summary fixture">
      <ManagerScopeToggle scope={scope} onChange={onScopeChange} />
      <SmartDayRail scope={scope} />
      {consequenceTask ? <div className={smartStyles.daySummaryDivider} aria-hidden="true" /> : null}
      <ConsequenceRow task={consequenceTask} />
    </section>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.phone} ${smartStyles.boundedPhone}`}>
      <AppHeader />
      {children}
      <footer className={styles.nav}>
        <span>Home</span><span>Work</span><strong>Clock</strong><span>Manager</span><span>More</span>
      </footer>
    </div>
  );
}

function TaskSignalLine({ task, tier }: { task: TaskDatum; tier: FocusTier }) {
  const signals = signalsForTier(task, tier);
  if (!signals.length) return null;

  return (
    <div className={smartStyles.clockSignalLine} data-focus-tier={tier}>
      {signals.map((signal) => (
        <span data-signal-kind={signal.kind} key={`${signal.kind}-${signal.detail}`}>
          {tier === "context" ? signal.compact : signal.detail}
        </span>
      ))}
    </div>
  );
}

function TaskIdentity({ task, scope }: { task: TaskDatum; scope: FeedScope }) {
  const signal = progressiveSignals(task).find((candidate) => candidate.kind !== "consequence") ?? progressiveSignals(task)[0];

  return (
    <div className={styles.taskIdentity}>
      <span>{task.family}{scope === "team" ? ` · ${task.actor}` : ""}</span>
      <strong>{task.title}</strong>
      <small>{task.place} · {task.amount}</small>
      {signal ? <em className={smartStyles.dayTaskSignal}>{signal.detail}</em> : null}
    </div>
  );
}

function UnlockBranch({ path }: { path: string[] }) {
  return (
    <div className={styles.unlockBranch}>
      <i aria-hidden="true" />
      <div><span>UNLOCKS</span><strong>{path.join(" → ")}</strong></div>
    </div>
  );
}

function OccupiedLensRow({ occupied }: { occupied: OccupiedTime }) {
  return (
    <div className={smartStyles.occupiedLensRow} style={{ flexGrow: 0.52 }} aria-label={`${occupied.timeRange}, occupied time, ${occupied.label}`}>
      <span>{occupied.timeRange}</span>
      <i aria-hidden="true" />
      <strong>{occupied.label}</strong>
    </div>
  );
}

function OccupiedDayRow({ occupied }: { occupied: OccupiedTime }) {
  return (
    <article className={smartStyles.occupiedDayRow} aria-label={`${occupied.timeRange}, occupied time, ${occupied.label}`}>
      <span>{occupied.timeRange}</span>
      <div><small>OCCUPIED TIME</small><strong>{occupied.label}</strong></div>
    </article>
  );
}

function CloseoutMoment({ scope }: { scope: FeedScope }) {
  const visibleIds = new Set(tasksForScope(scope).map((task) => task.id));
  const rows = CLOSEOUT_FIXTURES
    .filter((row) => visibleIds.has(row.taskId))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 2);

  if (!rows.length) return null;

  return (
    <section className={smartStyles.closeoutMoment} aria-label="End-of-day migration preview fixture">
      <header><span>END-OF-DAY PREVIEW</span><strong>{rows.length} unresolved</strong></header>
      {rows.map((row) => {
        const task = TASKS.find((candidate) => candidate.id === row.taskId);
        if (!task) return null;
        return (
          <div className={smartStyles.closeoutRow} key={row.taskId}>
            <div><strong>{task.title}</strong><small>{row.detail}</small></div>
            <b>{row.disposition}</b>
          </div>
        );
      })}
    </section>
  );
}

function CalendarClockView({
  scope,
  inspectedTaskId,
  onInspect,
}: {
  scope: FeedScope;
  inspectedTaskId: string;
  onInspect: (taskId: string) => void;
}) {
  const wheelDebt = useRef(0);
  const touchY = useRef<number | null>(null);
  const tasks = tasksForScope(scope);
  const resolvedTask = tasks.find((task) => task.id === inspectedTaskId) ?? defaultFocusForScope(scope);
  const inspectedIndex = tasks.findIndex((task) => task.id === resolvedTask.id);
  const inspectingNow = resolvedTask.id === NOW_TASK_ID;
  const showCloseout = inspectedIndex === tasks.length - 1;

  function settleOn(index: number) {
    const bounded = Math.max(0, Math.min(tasks.length - 1, index));
    onInspect(tasks[bounded].id);
  }

  function scrubBy(direction: -1 | 1) {
    settleOn(inspectedIndex + direction);
  }

  function returnToNow() {
    onInspect(defaultFocusForScope(scope).id);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    wheelDebt.current += event.deltaY;
    if (Math.abs(wheelDebt.current) < 24) return;
    scrubBy(wheelDebt.current > 0 ? 1 : -1);
    wheelDebt.current = 0;
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchY.current = event.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    const previous = touchY.current;
    const current = event.touches[0]?.clientY;
    if (previous === null || current === undefined) return;
    const delta = previous - current;
    if (Math.abs(delta) < 22) return;
    event.preventDefault();
    scrubBy(delta > 0 ? 1 : -1);
    touchY.current = current;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrubBy(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scrubBy(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      settleOn(0);
    } else if (event.key === "End") {
      event.preventDefault();
      settleOn(tasks.length - 1);
    }
  }

  return (
    <section className={smartStyles.clockView} data-closeout={showCloseout ? "true" : "false"} aria-label="Bounded focus-and-context day-timer Clock fixture">
      <header className={smartStyles.clockViewHeader}>
        <div>
          <span>DAY TIMER · NOW {NOW_LABEL}</span>
          <strong>{inspectingNow ? `NOW · ${resolvedTask.title}` : `INSPECTING · ${resolvedTask.time}`}</strong>
        </div>
        <button type="button" disabled={inspectingNow} onClick={returnToNow}>Return to now</button>
      </header>

      <div
        className={smartStyles.clockLensViewport}
        role="slider"
        tabIndex={0}
        aria-label="Clock task scrubber"
        aria-valuemin={1}
        aria-valuemax={tasks.length}
        aria-valuenow={inspectedIndex + 1}
        aria-valuetext={`${resolvedTask.time}, ${resolvedTask.title}`}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onKeyDown={handleKeyDown}
      >
        <div className={smartStyles.clockLensSpine} aria-hidden="true" />
        {tasks.map((task, index) => {
          const distance = Math.abs(index - inspectedIndex);
          const isNow = task.id === NOW_TASK_ID;
          const isInspected = task.id === resolvedTask.id;
          const tier = focusDistanceTier(distance);
          const weight = chronicleFocusWeight(distance);
          const occupied = task.occupiedBefore && occupiedTimeVisible(task.occupiedBefore, scope)
            ? task.occupiedBefore
            : null;
          return (
            <div className={smartStyles.clockLensSequence} key={task.id}>
              {occupied ? <OccupiedLensRow occupied={occupied} /> : null}
              <div
                className={smartStyles.clockLensRow}
                data-focus-tier={tier}
                data-now={isNow ? "true" : "false"}
                style={{ flexGrow: weight }}
              >
                <span className={smartStyles.clockLensTime}>{task.time}</span>
                <i className={smartStyles.clockLensDot} aria-hidden="true" />
                <button
                  className={smartStyles.calendarTaskBlock}
                  data-inspected={isInspected ? "true" : "false"}
                  data-now={isNow ? "true" : "false"}
                  data-placement-source={task.placementSource}
                  data-focus-tier={tier}
                  type="button"
                  onClick={() => onInspect(task.id)}
                  aria-label={`Inspect ${task.time}, ${task.family}, ${task.title}`}
                >
                  <span>{task.family}<em className={smartStyles.taskActor}>{scope === "team" ? ` · ${task.actor}` : ""}</em>{task.intelligence.unlockPath?.length ? <b className={smartStyles.consequenceMark}> ↳</b> : null}</span>
                  <strong>{task.title}</strong>
                  <TaskSignalLine task={task} tier={tier} />
                  <small>{task.place} · {task.amount}</small>
                  {tier === "focus" && task.intelligence.unlockPath?.length
                    ? <div className={smartStyles.focusUnlockPath}><span>UNLOCKS</span><strong>{task.intelligence.unlockPath.join(" → ")}</strong></div>
                    : null}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {showCloseout ? <CloseoutMoment scope={scope} /> : null}
    </section>
  );
}

function OrderedTaskRail({
  scope,
  inspectedTaskId,
}: {
  scope: FeedScope;
  inspectedTaskId: string;
}) {
  const tasks = tasksForScope(scope);
  const resolvedTask = tasks.find((task) => task.id === inspectedTaskId) ?? defaultFocusForScope(scope);

  return (
    <div className={styles.cleanRail} aria-label="Ordered task rail fixture synchronized to Clock inspection">
      {tasks.map((task) => {
        const isNow = task.id === NOW_TASK_ID;
        const isInspected = task.id === resolvedTask.id;
        const stateClass = isNow
          ? smartStyles.feedNow
          : isInspected
            ? smartStyles.feedInspected
            : "";
        const occupied = task.occupiedBefore && occupiedTimeVisible(task.occupiedBefore, scope)
          ? task.occupiedBefore
          : null;
        return (
          <div key={task.id}>
            {occupied ? <OccupiedDayRow occupied={occupied} /> : null}
            <article
              className={`${styles.cleanNode} ${stateClass}`}
              data-active={isNow ? "true" : "false"}
              data-inspected={isInspected ? "true" : "false"}
            >
              <i className={styles.railDot} aria-hidden="true" />
              <TaskIdentity task={task} scope={scope} />
              {isInspected && !isNow
                ? <span className={smartStyles.inspectFlag}>INSPECTING {task.time}</span>
                : null}
              {task.intelligence.unlockPath?.length ? <UnlockBranch path={task.intelligence.unlockPath} /> : null}
            </article>
          </div>
        );
      })}
    </div>
  );
}

function SmartRailDaySurface() {
  const [view, setView] = useState<DayView>("clock");
  const [scope, setScope] = useState<FeedScope>("team");
  const [inspectedTaskId, setInspectedTaskId] = useState(NOW_TASK_ID);

  function changeScope(nextScope: FeedScope) {
    setScope(nextScope);
    if (!tasksForScope(nextScope).some((task) => task.id === inspectedTaskId)) {
      setInspectedTaskId(defaultFocusForScope(nextScope).id);
    }
  }

  return (
    <section
      className={`${styles.daySurface} ${smartStyles.boundedDaySurface}`}
      data-view={view}
      aria-label="Atlas Clock-first day with secondary ordered task rail fixture"
    >
      <DayHeader view={view} onChange={setView} />
      <DayNavigation position="top" />
      <DaySummaryPanel scope={scope} onScopeChange={changeScope} />
      {view === "clock"
        ? <CalendarClockView scope={scope} inspectedTaskId={inspectedTaskId} onInspect={setInspectedTaskId} />
        : <OrderedTaskRail scope={scope} inspectedTaskId={inspectedTaskId} />}
      <DayNavigation position="bottom" />
    </section>
  );
}

function Study({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <section className={styles.study}>
      <header className={styles.studyLabel}><strong>{label}</strong><span>{note}</span></header>
      <Phone>{children}</Phone>
    </section>
  );
}

export default function ActiveOutcomeStudies() {
  return (
    <section
      className={styles.section}
      data-atlas-active-outcome-studies="fixture-only"
      data-live-task-binding="none"
      data-task-transition-capability="none"
      aria-labelledby="active-outcome-studies-heading"
    >
      <header className={styles.sectionHeader}>
        <span>CLOCK + DAYBOOK STUDY 14 · SILENT INTELLIGENCE STRESS TEST</span>
        <h2 id="active-outcome-studies-heading">More Atlas underneath. Less Atlas on the screen.</h2>
        <p>This fixture gives the bounded Clock a deliberately crowded day with hidden task-health, consequence, work-context, lifecycle, operating-condition, team-scope, occupied-time, and migration outputs. Clock admits only the smallest ranked signal that changes understanding. The goal is to prove the day can get smarter without turning into a dashboard.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>Nothing here is wired to live Worker state. The intelligence packet is specimen data used to test presentation contracts only. Occupied Time is not a task; Mine and Team are projections of the same task identities; closeout rows are specimen adjudication outputs; focus changes visual resolution only.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Silent-intelligence Clock + synchronized Day rail"
          note="Default Team view stress-tests ten scheduled tasks, occupied-time spans, task health, lifecycle/condition cues, consequence paths, and multiple actors. Switch to Mine to remove team tasks without copying or mutating them. Scrub to the final visible task to preview end-of-day migration."
        >
          <SmartRailDaySurface />
        </Study>
      </div>
    </section>
  );
}
