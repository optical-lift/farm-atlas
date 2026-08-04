import Link from "next/link";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { requireAtlasRole } from "@/lib/atlas/role-access";
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
  const access = await requireAtlasRole(["owner", "manager"]);
  const params = await searchParams;
  const requestedDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const dateIso = validDateIso(requestedDate) ? requestedDate : centralDateIso();
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("farm_day_task_cards_v1", {
    p_farm_id: access.membership.farmId,
    p_work_date: dateIso,
  });
  const tasks = error ? [] : ((data ?? []) as AtlasTaskCard[]).sort(taskSort);

  const groups = new Map<string, { label: string; tasks: AtlasTaskCard[] }>();
  for (const task of tasks) {
    const executor = taskExecutor(task);
    const group = groups.get(executor.key) ?? { label: executor.label, tasks: [] };
    group.tasks.push(task);
    groups.set(executor.key, group);
  }
  const people = [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
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
            <p className={styles.eyebrow}>Farm day</p>
            <h1 id="farm-day-title">{access.membership.farmName}</h1>
            <p>Every person’s assigned work for this farm, kept separate from your personal Work feed.</p>
          </div>
          <Link className={styles.close} href="/more" aria-label="Close farm day">×</Link>
        </header>

        <nav className={styles.tabs} aria-label="Work view">
          <Link href={`/day?date=${encodeURIComponent(dateIso)}&view=work_order`}>My work</Link>
          <Link href={returnTo} aria-current="page">Big picture</Link>
        </nav>

        <section className={styles.dateBar} aria-label="Choose farm day">
          <Link href={`/manage/day?date=${previousDate}`} aria-label="Previous day">‹</Link>
          <div><strong>{prettyDate(dateIso)}</strong><span>{people.length} {people.length === 1 ? "person" : "people"} with assigned work</span></div>
          <Link href={`/manage/day?date=${nextDate}`} aria-label="Next day">›</Link>
        </section>

        <section className={styles.summary} aria-label="Farm day totals">
          <article><strong>{counts.total}</strong><span>Total</span></article>
          <article><strong>{counts.open}</strong><span>Open</span></article>
          <article><strong>{counts.blocked}</strong><span>Blocked</span></article>
          <article><strong>{counts.done}</strong><span>Done</span></article>
        </section>

        {error ? <p className={styles.error}>The farm-wide day could not be loaded.</p> : null}
        {!error && !people.length ? <p className={styles.empty}>No assigned farm work is due or carried into this day.</p> : null}

        <div className={styles.groups}>
          {people.map((person) => (
            <section className={styles.group} key={person.label} aria-label={`${person.label}'s work`}>
              <header className={styles.groupHeader}>
                <div><span>Assigned to</span><h2>{person.label}</h2></div>
                <b>{person.tasks.length}</b>
              </header>
              <div className={styles.list}>
                {person.tasks.map((task) => {
                  const display = atlasTaskDisplay(task);
                  const statusLabel = taskStatusLabel(task, dateIso);
                  return (
                    <Link
                      className={styles.card}
                      data-status={task.status}
                      href={`/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`}
                      key={task.task_id}
                    >
                      <strong>{display.title}</strong>
                      <span className={styles.cardStatus}>{statusLabel}</span>
                      <span className={styles.cardMeta}>{taskLocation(task)}{task.due_date && task.due_date < dateIso ? ` · due ${task.due_date}` : ""}</span>
                      {display.detail ? <p className={styles.cardDetail}>{display.detail}</p> : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}