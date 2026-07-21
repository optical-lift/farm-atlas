"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  postAtlasTaskTransition,
  type AtlasTaskTransition,
  type AtlasTaskTransitionResponse,
} from "@/lib/atlas/task-transition-client";
import styles from "./work.module.css";
import unfinishedStyles from "./unfinished.module.css";

export type WorkerTodayTask = {
  taskId: string | null;
  title: string;
  taskType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  instruction: string | null;
  blocker: string | null;
  zone: {
    label: string | null;
    key: string | null;
  };
  object: {
    label: string | null;
    key: string | null;
  };
  totalSteps: number;
  completedSteps: number;
  canAct: boolean;
};

export type WorkerCollectionCard = {
  key: "mow" | "weed";
  label: string;
  href: string;
  todayCount: number;
  carryoverCount: number;
  blockedCount: number;
  preview: string;
};

type WorkerTodayBoardProps = {
  farmName: string;
  workerName: string;
  viewerName: string;
  forDate: string;
  canAct: boolean;
  collections: WorkerCollectionCard[];
  todayTasks: WorkerTodayTask[];
  blockedTasks: WorkerTodayTask[];
  carryoverTasks: WorkerTodayTask[];
  summary: {
    todayOpen: number;
    carryover: number;
    blocked: number;
    done: number;
  };
};

type WorkerActionOptions = {
  note?: string | null;
  reason?: string | null;
  targetDate?: string | null;
};

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null) {
  if (!dateIso) return "No due date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function taskLocation(task: WorkerTodayTask) {
  return task.object.label || task.zone.label || task.object.key || task.zone.key || "Elm Farm";
}

function taskHref(task: WorkerTodayTask) {
  return task.taskId ? `/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent("/work/today")}` : null;
}

function WorkerTaskCard({
  task,
  canAct,
  onResult,
}: {
  task: WorkerTodayTask;
  canAct: boolean;
  onResult: (taskId: string, transition: AtlasTaskTransition, result: AtlasTaskTransitionResponse) => void;
}) {
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [working, setWorking] = useState<AtlasTaskTransition | null>(null);
  const [error, setError] = useState("");
  const href = taskHref(task);

  async function apply(
    transition: AtlasTaskTransition,
    options: WorkerActionOptions = {},
  ) {
    if (!task.taskId) return;

    setWorking(transition);
    setError("");

    try {
      const result = await postAtlasTaskTransition({
        taskId: task.taskId,
        transition,
        targetDate: options.targetDate ?? null,
        note: options.note ?? null,
        reason: options.reason ?? options.note ?? null,
        payload: { source: "worker_today" },
      });
      setUnfinishedOpen(false);
      onResult(task.taskId, transition, result);
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "Atlas could not save that task update.");
    } finally {
      setWorking(null);
    }
  }

  function partlyDone() {
    const note = window.prompt("What is left?", "")?.trim() || "Partly done";
    void apply("partial", { note, reason: note });
  }

  function markBlocked() {
    const note = window.prompt("What blocked it?", "")?.trim() || "Blocked";
    void apply("blocked", { note, reason: note });
  }

  function moveTomorrow() {
    void apply("rescheduled", {
      targetDate: addDays(todayIso(), 1),
      reason: "Moved to next Elm Farm calendar day from worker Today",
    });
  }

  function moveNextWeek() {
    void apply("rescheduled", {
      targetDate: addDays(todayIso(), 7),
      reason: "Moved to next week from worker Today",
    });
  }

  function pickDate() {
    const date = window.prompt("Pick a date (YYYY-MM-DD)", task.dueDate || todayIso())?.trim();
    if (date) {
      void apply("rescheduled", {
        targetDate: date,
        reason: "Rescheduled from worker Today",
      });
    }
  }

  function changedPlan() {
    const note = window.prompt("What changed?", "")?.trim() || "Plan changed";
    void apply("changed_plan", { note, reason: note });
  }

  function notRelevant() {
    const note = window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant";
    void apply("not_relevant", { note, reason: note });
  }

  return (
    <article className={`${styles.task} ${task.status === "blocked" ? styles.blocked : ""}`}>
      <div className={styles.taskTop}>
        <div>
          {href ? <Link className={styles.taskLink} href={href}>{task.title}</Link> : <h3>{task.title}</h3>}
          <p className={styles.location}>{taskLocation(task)}</p>
        </div>
        <span className={styles.date}>{prettyDate(task.dueDate)}</span>
      </div>

      {task.blocker ? <p className={styles.blocker}>Blocked: {task.blocker}</p> : null}
      {task.instruction ? <p className={styles.instruction}>{task.instruction}</p> : null}
      {task.totalSteps ? (
        <p className={styles.progress}>{task.completedSteps}/{task.totalSteps} checklist steps complete</p>
      ) : null}

      {canAct && task.canAct && task.taskId ? (
        <div className={styles.quickActions}>
          <div className={unfinishedStyles.primaryActions}>
            <button
              className={unfinishedStyles.doneButton}
              type="button"
              disabled={working !== null}
              onClick={() => void apply("done")}
            >
              {working === "done" ? "Finishing" : "Done"}
            </button>
            <button
              className={unfinishedStyles.unfinishedButton}
              type="button"
              disabled={working !== null}
              onClick={() => setUnfinishedOpen((open) => !open)}
            >
              {unfinishedOpen ? "Close" : "Unfinished"}
            </button>
          </div>

          {unfinishedOpen ? (
            <section className={unfinishedStyles.panel}>
              <strong>What happened?</strong>
              <div className={unfinishedStyles.twoColumnGrid}>
                <button type="button" disabled={working !== null} onClick={partlyDone}>Partly done</button>
                <button type="button" className={unfinishedStyles.blockedButton} disabled={working !== null} onClick={markBlocked}>Blocked</button>
              </div>

              <span>Reschedule</span>
              <div className={unfinishedStyles.threeColumnGrid}>
                <button type="button" disabled={working !== null} onClick={moveTomorrow}>Tomorrow</button>
                <button type="button" disabled={working !== null} onClick={moveNextWeek}>Next week</button>
                <button type="button" disabled={working !== null} onClick={pickDate}>Pick a date</button>
              </div>

              <span>Close without doing it</span>
              <div className={unfinishedStyles.twoColumnGrid}>
                <button type="button" disabled={working !== null} onClick={changedPlan}>Changed plan</button>
                <button type="button" disabled={working !== null} onClick={notRelevant}>Not relevant</button>
              </div>
            </section>
          ) : null}

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function TaskSection({
  title,
  subtitle,
  tasks,
  canAct,
  onResult,
  compact = false,
}: {
  title: string;
  subtitle: string;
  tasks: WorkerTodayTask[];
  canAct: boolean;
  onResult: (taskId: string, transition: AtlasTaskTransition, result: AtlasTaskTransitionResponse) => void;
  compact?: boolean;
}) {
  if (!tasks.length) return null;

  return (
    <section className={`${styles.section} ${compact ? styles.compactSection : ""}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span>{tasks.length}</span>
      </div>
      <div className={styles.list}>
        {tasks.map((task) => (
          <WorkerTaskCard
            key={task.taskId ?? `${task.title}-${task.dueDate ?? "undated"}`}
            task={task}
            canAct={canAct}
            onResult={onResult}
          />
        ))}
      </div>
    </section>
  );
}

export default function WorkerTodayBoard({
  farmName,
  workerName,
  viewerName,
  forDate,
  canAct,
  collections,
  todayTasks,
  blockedTasks,
  carryoverTasks,
  summary,
}: WorkerTodayBoardProps) {
  const router = useRouter();
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(() => new Set());
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");

  const sourceTaskIds = useMemo(
    () => new Set(
      [...todayTasks, ...blockedTasks, ...carryoverTasks]
        .map((task) => task.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    ),
    [blockedTasks, carryoverTasks, todayTasks],
  );

  useEffect(() => {
    setHiddenTaskIds((current) => new Set([...current].filter((taskId) => sourceTaskIds.has(taskId))));
    setCompletedTaskIds((current) => new Set([...current].filter((taskId) => sourceTaskIds.has(taskId))));
  }, [sourceTaskIds]);

  const visibleToday = useMemo(
    () => todayTasks.filter((task) => !task.taskId || !hiddenTaskIds.has(task.taskId)),
    [hiddenTaskIds, todayTasks],
  );
  const visibleBlocked = useMemo(
    () => blockedTasks.filter((task) => !task.taskId || !hiddenTaskIds.has(task.taskId)),
    [blockedTasks, hiddenTaskIds],
  );
  const visibleCarryover = useMemo(
    () => carryoverTasks.filter((task) => !task.taskId || !hiddenTaskIds.has(task.taskId)),
    [carryoverTasks, hiddenTaskIds],
  );

  function handleResult(taskId: string, transition: AtlasTaskTransition, result: AtlasTaskTransitionResponse) {
    if (["done", "rescheduled", "unfinished", "changed_plan", "not_relevant"].includes(transition)) {
      setHiddenTaskIds((current) => new Set(current).add(taskId));
    }
    if (transition === "done") {
      setCompletedTaskIds((current) => new Set(current).add(taskId));
      setAnnouncement(result.nextTaskId ? "Completed. The next rotation was created." : "Completed.");
    } else if (transition === "partial") {
      setAnnouncement("Partly done saved.");
    } else if (transition === "blocked") {
      setAnnouncement("Blocker saved.");
    } else if (transition === "rescheduled" || transition === "unfinished") {
      setAnnouncement("Task moved.");
    } else if (transition === "changed_plan") {
      setAnnouncement("Changed plan saved.");
    } else if (transition === "not_relevant") {
      setAnnouncement("Task closed as not relevant.");
    } else {
      setAnnouncement("Saved.");
    }
    router.refresh();
  }

  const hiddenTodayCount = [...todayTasks, ...blockedTasks.filter((task) => task.dueDate === forDate)]
    .filter((task) => task.taskId && hiddenTaskIds.has(task.taskId)).length;
  const hiddenCarryoverCount = [...carryoverTasks, ...blockedTasks.filter((task) => task.dueDate !== forDate)]
    .filter((task) => task.taskId && hiddenTaskIds.has(task.taskId)).length;
  const hiddenBlockedCount = blockedTasks
    .filter((task) => task.taskId && hiddenTaskIds.has(task.taskId)).length;
  const visibleOpenCount = Math.max(0, summary.todayOpen - hiddenTodayCount);
  const visibleCarryoverCount = Math.max(0, summary.carryover - hiddenCarryoverCount);
  const visibleBlockedCount = Math.max(0, summary.blocked - hiddenBlockedCount);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="worker-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{farmName} · {prettyDate(forDate)}</p>
            <h1 id="worker-title">{workerName}</h1>
            {viewerName !== workerName ? <p className={styles.identity}>Viewing as {viewerName}</p> : null}
          </div>
          <Link className={styles.back} href="/">Farm home</Link>
        </header>

        {!canAct ? <p className={styles.inspect}>Read-only view. Only the assigned Farm Hand can complete this work here.</p> : null}
        {announcement ? <p className={styles.success} role="status">{announcement}</p> : null}

        <section className={styles.summary} aria-label="Today work summary">
          <article><strong>{visibleOpenCount}</strong><span>today</span></article>
          <article><strong>{visibleCarryoverCount}</strong><span>carryover</span></article>
          <article><strong>{visibleBlockedCount}</strong><span>blocked</span></article>
          <article><strong>{summary.done + completedTaskIds.size}</strong><span>done</span></article>
        </section>

        {collections.length ? (
          <section className={styles.collectionGrid} aria-label="Maintenance collections">
            {collections.map((collection) => (
              <Link className={styles.collectionCard} href={collection.href} key={collection.key}>
                <div>
                  <span>{collection.label}</span>
                  <strong>{collection.todayCount} due</strong>
                </div>
                <p>{collection.preview}</p>
                <small>
                  {collection.carryoverCount ? `${collection.carryoverCount} carryover` : "No carryover"}
                  {collection.blockedCount ? ` · ${collection.blockedCount} blocked` : ""}
                </small>
              </Link>
            ))}
          </section>
        ) : null}

        <TaskSection
          title="Today"
          subtitle="Work assigned for this date"
          tasks={visibleToday}
          canAct={canAct}
          onResult={handleResult}
        />
        <TaskSection
          title="Blocked"
          subtitle="Needs a decision, material, or changed condition"
          tasks={visibleBlocked}
          canAct={canAct}
          onResult={handleResult}
        />
        <TaskSection
          title="Carryover"
          subtitle="Older work still open; not part of today’s completion count"
          tasks={visibleCarryover}
          canAct={canAct}
          onResult={handleResult}
          compact
        />

        {!collections.length && !visibleToday.length && !visibleBlocked.length && !visibleCarryover.length ? (
          <section className={styles.emptyState}>
            <h2>No work is ready</h2>
            <p>There are no assigned or farm-shared tasks ready for this worker today.</p>
          </section>
        ) : null}
      </section>
    </main>
  );
}
