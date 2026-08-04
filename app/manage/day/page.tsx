import Link from "next/link";

import { requireAtlasEffectiveManagementAccess } from "@/lib/atlas/effective-management-access";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { atlasWorkOrderLabel } from "@/lib/atlas/work-order";
import { createAtlasServerClient } from "@/lib/supabase/server";
import styles from "./farm-day.module.css";

export const dynamic = "force-dynamic";

type FarmDayPageProps = {
  searchParams: Promise<{ date?: string | string[] }>;
};

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDateIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function shiftDate(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function taskExecutor(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const label = typeof metadata.executor_label === "string" ? metadata.executor_label.trim() : "";
  const workerKey = typeof metadata.executor_worker_key === "string" ? metadata.executor_worker_key.trim() : "";
  return {
    key: workerKey || label.toLowerCase().replaceAll(" ", "_") || "assigned_work",
    label: label || (workerKey ? workerKey.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Assigned work"),
  };
}

function taskLocation(task: AtlasTaskCard) {
  if (task.zone_label) return task.zone_label;
  if (task.objects.length) return task.objects.map((object) => object.object_label).join(" · ");
  return "Elm Farm";
}

function taskStatusLabel(task: AtlasTaskCard, dateIso: string) {
  if (task.status === "done") return "Done";
  if (task.status === "blocked") return "Blocked";
  if (task.due_date && task.due_date < dateIso) return "Carry forward";
  return "Open";
}

function taskSort(left: AtlasTaskCard, right: AtlasTaskCard) {
  const statusRank = (status: string) => status === "blocked" ? 0 : status === "open" ? 1 : status === "done" ? 2 : 3;
  return statusRank(left.status) - statusRank(right.status)
    || (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31")
    || left.priority.localeCompare(right.priority)
    || left.title.localeCompare(right.title);
}

export default async function FarmDayPage({ searchParams }: FarmDayPageProps) {
  const access = await requireAtlasEffectiveManagementAccess();
  const params = await searchParams;
  const requestedDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const dateIso = validDateIso(requestedDate) ? requestedDate : centralDateIso();
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("farm_day_task_cards_v1", {
    p_farm_id: access.farmId,
    p_work_date: dateIso,
  });
  const tasks = error ? [] : ((data ?? []) as AtlasTaskCard[]).sort(taskSort);
  const peopleCount = new Set(tasks.map((task) => taskExecutor(task).key)).size;
  const counts = {
    total: tasks.length,
    open: tasks.filter((task) => task.status === "open").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    done: tasks.filter((task) => task.status === "done").length,
  };
  const previousDate = shiftDate(dateIso, -1);
  const nextDate = shiftDate(dateIso, 1);
  const returnTo = `/manage/day?date=${encodeURIComponent(dateIso)}`;

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="farm-day-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Manager</p>
            <h1 id="farm-day-title">{access.farmName}</h1>
            <p>Every person’s assigned work for this farm, kept separate from {access.displayName}’s personal Work feed.</p>
          </div>
          <Link className={styles.close} href="/" aria-label="Close Manager">×</Link>
        </header>

        <section className={styles.dayControls} aria-label="Farm day overview">
          <div className={styles.dateBar}>
            <Link href={`/manage/day?date=${previousDate}`} aria-label="Previous day">‹</Link>
            <div><strong>{prettyDate(dateIso)}</strong><span>{peopleCount} {peopleCount === 1 ? "person" : "people"} with assigned work</span></div>
            <Link href={`/manage/day?date=${nextDate}`} aria-label="Next day">›</Link>
          </div>

          <section className={styles.summary} aria-label="Farm day totals">
            <span><b>{counts.total}</b> total</span>
            <span><b>{counts.open}</b> open</span>
            <span><b>{counts.blocked}</b> blocked</span>
            <span><b>{counts.done}</b> done</span>
          </section>
        </section>

        {error ? <p className={styles.error}>The farm-wide day could not be loaded.</p> : null}
        {!error && !tasks.length ? <p className={styles.empty}>No assigned farm work is due or carried into this day.</p> : null}

        {!error && tasks.length ? (
          <section className={styles.feed} aria-label="Every person's assigned work" data-operator-mode={access.operatorMode ? "true" : "false"}>
            <header className={styles.feedHeader}>
              <span>Farm work</span>
              <strong>{counts.total} tasks across {peopleCount} {peopleCount === 1 ? "person" : "people"}</strong>
            </header>
            <div className={`${styles.list} atlas-day-route-spine`}>
              {tasks.map((task) => {
                const display = atlasTaskDisplay(task);
                const executor = taskExecutor(task);
                const statusLabel = taskStatusLabel(task, dateIso);
                const carried = Boolean(task.due_date && task.due_date < dateIso);
                const statusLine = `${atlasWorkOrderLabel(task)} · ${taskLocation(task)}${carried ? ` · due ${prettyDate(task.due_date as string)}` : ""}`;
                const blockedClass = task.status === "blocked" ? " atlas-day-route-blocked" : "";
                const completeClass = task.status === "done" ? " atlas-day-complete-entry" : "";
                return (
                  <div
                    className={`${styles.entry} atlas-day-task-entry${blockedClass}${completeClass}`}
                    data-atlas-assignee-key={executor.key}
                    data-status={task.status}
                    key={task.task_id}
                  >
                    <span className={`atlas-day-task-node${task.status === "done" ? " is-complete" : ""}`} aria-hidden="true"><span /></span>
                    <Link
                      className={`${styles.card} atlas-day-task-card`}
                      data-atlas-assignee-label={executor.label}
                      data-atlas-assignee-key={executor.key}
                      data-status={task.status}
                      href={`/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`}
                    >
                      <small className="atlas-day-task-family">{statusLabel}</small>
                      <strong>{display.title}</strong>
                      <span>{statusLine}</span>
                      {display.detail ? <em>{display.detail}</em> : null}
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
