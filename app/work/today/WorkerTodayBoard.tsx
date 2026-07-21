"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  postAtlasTaskTransition,
  type AtlasTaskTransition,
  type AtlasTaskTransitionResponse,
} from "@/lib/atlas/task-transition-client";
import styles from "./work.module.css";

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
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<AtlasTaskTransition | null>(null);
  const [error, setError] = useState("");
  const href = taskHref(task);

  async function apply(transition: "done" | "blocked" | "note") {
    if (!task.taskId) return;
    if ((transition === "blocked" || transition === "note") && !note.trim()) {
      setError(transition === "blocked" ? "Describe what is blocking this task." : "Write the note before saving it.");
      return;
    }

    setWorking(transition);
    setError("");

    try {
      const result = await postAtlasTaskTransition({
        taskId: task.taskId,
        transition,
        note: note.trim() || null,
        reason: transition === "blocked" ? note.trim() : null,
        payload: { source: "worker_today" },
      });
      setNote("");
      onResult(task.taskId, transition, result);
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "Atlas could not save that task update.");
    } finally {
      setWorking(null);
    }
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
          <button
            className={styles.doneButton}
            type="button"
            disabled={working !== null}
            onClick={() => void apply("done")}
          >
            {working === "done" ? "Completing…" : "Done"}
          </button>
          <details className={styles.moreActions}>
            <summary>Add note or blocker</summary>
            <div className={styles.moreActionsBody}>
              <textarea
                aria-label={`Note or blocker for ${task.title}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="What changed, or what is blocking the work?"
              />
              <div className={styles.secondaryActions}>
                <button type="button" disabled={working !== null || !note.trim()} onClick={() => void apply("blocked")}>
                  {working === "blocked" ? "Saving…" : "Mark blocked"}
                </button>
                <button type="button" disabled={working !== null || !note.trim()} onClick={() => void apply("note")}>
                  {working === "note" ? "Saving…" : "Save note"}
                </button>
              </div>
            </div>
          </details>
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
  const [announcement, setAnnouncement] = useState("");

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
    if (transition === "done") {
      setHiddenTaskIds((current) => new Set(current).add(taskId));
      setAnnouncement(result.nextTaskId ? "Completed. The next rotation was created." : "Completed.");
    } else if (transition === "blocked") {
      setAnnouncement("Blocker saved.");
    } else {
      setAnnouncement("Note saved.");
    }
    router.refresh();
  }

  const visibleOpenCount = Math.max(0, summary.todayOpen - hiddenTaskIds.size);

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
          <article><strong>{summary.carryover}</strong><span>carryover</span></article>
          <article><strong>{summary.blocked}</strong><span>blocked</span></article>
          <article><strong>{summary.done + hiddenTaskIds.size}</strong><span>done</span></article>
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
