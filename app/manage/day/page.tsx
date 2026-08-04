import Link from "next/link";

import {
  atlasDayRouteState,
  atlasDayTaskCues,
  atlasDayTaskFamily,
} from "@/lib/atlas/day-route";
import { requireAtlasEffectiveManagementAccess } from "@/lib/atlas/effective-management-access";
import { resolveTaskAssignee } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { atlasWorkOrderLabel } from "@/lib/atlas/work-order";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type FarmDayPageProps = {
  searchParams: Promise<{ date?: string | string[] }>;
};

type Executor = {
  key: string;
  label: string;
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
    month: "short",
    day: "numeric",
  });
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function taskExecutor(task: AtlasTaskCard): Executor {
  const metadata = task.metadata ?? {};
  const canonical = resolveTaskAssignee(task);
  const label = typeof metadata.executor_label === "string" ? metadata.executor_label.trim() : "";
  const workerKey = typeof metadata.executor_worker_key === "string" ? metadata.executor_worker_key.trim().toLowerCase() : "";
  return {
    key: workerKey || canonical.key,
    label: label || (workerKey ? titleCase(workerKey) : canonical.label),
  };
}

function ManagerAssigneeBadge({ executor }: { executor: Executor }) {
  return <span className="atlas-manager-assignee-badge" data-assignee-key={executor.key}>{executor.label}</span>;
}

function taskLocation(task: AtlasTaskCard) {
  if (task.zone_label) return task.zone_label;
  if (task.objects.length) return task.objects.map((object) => object.object_label).join(" · ");
  return "Elm Farm";
}

function latestEvidence(task: AtlasTaskCard) {
  const outcome = task.task_outcomes?.[0];
  if (outcome) return outcome.note || outcome.blocker_reason || outcome.outcome.replaceAll("_", " ");
  const transition = task.task_transitions?.[0];
  if (transition) return transition.note || transition.reason || transition.transition.replaceAll("_", " ");
  return "No result has been recorded yet.";
}

function taskSort(left: AtlasTaskCard, right: AtlasTaskCard) {
  const statusRank = (status: string) => status === "blocked" ? 0 : status === "open" ? 1 : status === "done" ? 2 : 3;
  return statusRank(left.status) - statusRank(right.status)
    || (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31")
    || left.priority.localeCompare(right.priority)
    || left.title.localeCompare(right.title);
}

function ManagerTimelineTask({
  task,
  currentTaskId,
  returnTo,
}: {
  task: AtlasTaskCard;
  currentTaskId: string | null;
  returnTo: string;
}) {
  const display = atlasTaskDisplay(task);
  const executor = taskExecutor(task);
  const family = atlasDayTaskFamily(task);
  const cues = atlasDayTaskCues(task);
  const routeState = atlasDayRouteState(task, currentTaskId);
  const routeClass = `atlas-day-route-${routeState}`;
  const taskUrl = `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div
      className={`atlas-day-task-entry ${routeClass}`}
      data-atlas-assignee-key={executor.key}
      data-status={task.status}
    >
      <span className="atlas-day-task-node" aria-hidden="true"><span /></span>
      <details className={`atlas-day-task-card atlas-journal-task-row ${routeClass}`} aria-current={routeState === "current" ? "step" : undefined}>
        <summary className="atlas-manager-assignee-host" data-atlas-assignee-key={executor.key}>
          <small className="atlas-day-task-family">{routeState === "current" ? `Current · ${family}` : family}</small>
          <strong>{display.title}</strong>
          <span>{atlasWorkOrderLabel(task)} · {taskLocation(task)}</span>
          {display.detail ? <em>{display.detail}</em> : null}
          {cues.length ? <span className="atlas-day-task-cues">{cues.map((cue) => <i key={cue}>{cue}</i>)}</span> : null}
          <ManagerAssigneeBadge executor={executor} />
          <b className="atlas-journal-row-caret" aria-hidden="true">⌄</b>
        </summary>
        <div className="atlas-journal-task-detail">
          <dl>
            <div><dt>Assigned to</dt><dd>{executor.label}</dd></div>
            <div><dt>Place</dt><dd>{task.objects.length ? task.objects.map((object) => object.object_label).join(" · ") : taskLocation(task)}</dd></div>
            <div><dt>Time</dt><dd>{task.due_date ? prettyDate(task.due_date) : "No date recorded"}</dd></div>
            <div><dt>Evidence</dt><dd>{latestEvidence(task)}</dd></div>
            <div><dt>Effect</dt><dd>{task.unlock_text || task.blocker_text || "No secondary effect is recorded."}</dd></div>
          </dl>
          <Link prefetch={false} href={taskUrl}>Open full task <span aria-hidden="true">→</span></Link>
        </div>
      </details>
    </div>
  );
}

function ManagerOverdueTask({ task, returnTo }: { task: AtlasTaskCard; returnTo: string }) {
  const display = atlasTaskDisplay(task);
  const executor = taskExecutor(task);
  const taskUrl = `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <Link
      prefetch={false}
      className="atlas-day-task-card atlas-day-overdue-task-card atlas-manager-assignee-host"
      data-atlas-assignee-key={executor.key}
      data-status={task.status}
      href={taskUrl}
    >
      <b className="atlas-day-overdue-badge">Overdue</b>
      <strong>{display.title}</strong>
      <span>Due {prettyDate(task.due_date ?? "")}</span>
      {display.detail ? <em>{display.detail}</em> : null}
      <ManagerAssigneeBadge executor={executor} />
    </Link>
  );
}

function ManagerCompleteTask({ task, returnTo }: { task: AtlasTaskCard; returnTo: string }) {
  const display = atlasTaskDisplay(task);
  const executor = taskExecutor(task);
  const taskUrl = `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="atlas-day-task-entry atlas-day-complete-entry" data-atlas-assignee-key={executor.key}>
      <span className="atlas-day-task-node is-complete" aria-hidden="true"><span /></span>
      <Link
        prefetch={false}
        className="atlas-day-task-card complete atlas-manager-assignee-host"
        data-atlas-assignee-key={executor.key}
        href={taskUrl}
      >
        <strong>{display.title}</strong>
        <span>Complete</span>
        <ManagerAssigneeBadge executor={executor} />
      </Link>
    </div>
  );
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
  const carriedTasks = tasks.filter((task) => task.status !== "done" && Boolean(task.due_date && task.due_date < dateIso));
  const todayTasks = tasks.filter((task) => task.status !== "done" && !carriedTasks.some((carried) => carried.task_id === task.task_id));
  const doneTasks = tasks.filter((task) => task.status === "done");
  const currentTask = carriedTasks[0] ?? todayTasks[0] ?? null;

  const people = new Map<string, { label: string; count: number }>();
  for (const task of tasks) {
    const executor = taskExecutor(task);
    const existing = people.get(executor.key) ?? { label: executor.label, count: 0 };
    existing.count += 1;
    people.set(executor.key, existing);
  }
  const peopleList = [...people.entries()].map(([key, person]) => ({ key, ...person })).sort((left, right) => left.label.localeCompare(right.label));
  const peopleCount = peopleList.length;
  const counts = {
    total: tasks.length,
    open: tasks.filter((task) => task.status === "open").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    done: doneTasks.length,
  };

  const previousDate = shiftDate(dateIso, -1);
  const nextDate = shiftDate(dateIso, 1);
  const returnTo = `/manage/day?date=${encodeURIComponent(dateIso)}`;
  const currentExecutor = currentTask ? taskExecutor(currentTask) : null;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <style>{`
        .atlas-manager-assignee-host {
          position: relative !important;
          padding-right: 86px !important;
        }

        .atlas-manager-assignee-badge {
          position: absolute;
          top: 2px;
          right: 22px;
          z-index: 3;
          display: block;
          max-width: 74px;
          overflow: hidden;
          border: 1px solid rgba(85, 90, 134, 0.18);
          border-radius: 999px;
          background: rgba(174, 179, 212, 0.18);
          color: #555a86;
          padding: 4px 7px 3px;
          font-size: 8px;
          line-height: 1;
          font-style: normal;
          font-weight: 950;
          letter-spacing: 0.07em;
          text-overflow: ellipsis;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .atlas-manager-assignee-badge[data-assignee-key="anna"] {
          border-color: rgba(113, 125, 87, 0.22);
          background: rgba(207, 214, 175, 0.36);
          color: #626d4e;
        }

        .atlas-manager-assignee-badge[data-assignee-key="marshall"] {
          border-color: rgba(85, 90, 134, 0.24);
          background: rgba(188, 196, 220, 0.32);
          color: #4f567f;
        }

        .atlas-manager-assignee-badge[data-assignee-key="owner"] {
          border-color: rgba(102, 83, 105, 0.22);
          background: rgba(213, 200, 212, 0.34);
          color: #665369;
        }

        @media (max-width: 360px) {
          .atlas-manager-assignee-host {
            padding-right: 74px !important;
          }

          .atlas-manager-assignee-badge {
            right: 18px;
            max-width: 62px;
            padding-inline: 6px;
          }
        }
      `}</style>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone" aria-labelledby="farm-day-title">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Manager</span>
            <span className="atlas-phone-title" id="farm-day-title">{access.farmName}</span>
          </Link>
          <span className="atlas-weather-line">All assigned work</span>
          <Link href="/" className="atlas-note-plus" aria-label="Back to today">+</Link>
        </header>

        <div className="atlas-task-page-body">
          <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
            <div className="atlas-day-browse-head">
              <Link href="/" className="atlas-route-back atlas-day-back">← Home</Link>
              <div className="atlas-day-browse-title-row">
                <span>Manager</span>
                <strong>{counts.open} open · {counts.blocked} blocked · {counts.done} done</strong>
              </div>
              <p>{counts.total} tasks across {peopleCount} {peopleCount === 1 ? "person" : "people"}</p>
            </div>

            <article className="atlas-day-command-header">
              <div className="atlas-day-command-topline">
                <div className="atlas-day-command-date">
                  <strong>{prettyDate(dateIso)}</strong>
                  <span>{carriedTasks.length ? `${carriedTasks.length} carry forward · ` : ""}{todayTasks.length} today</span>
                </div>
              </div>
              <details className="atlas-day-overview-drawer atlas-day-command-overview">
                <summary>
                  <span className="atlas-day-next-label">Next</span>
                  <div className="atlas-day-next-copy">
                    <strong>{currentTask ? atlasTaskDisplay(currentTask).title : "The day is clear"}</strong>
                    <em>{currentTask && currentExecutor ? `${currentExecutor.label} · ${taskLocation(currentTask)}` : "No open assigned work"}</em>
                  </div>
                  <b aria-hidden="true">⌄</b>
                </summary>
                <div className="atlas-day-command-overview-body">
                  {currentTask ? (
                    <Link
                      prefetch={false}
                      className="atlas-day-open-current"
                      href={`/task-focus/${encodeURIComponent(currentTask.task_id)}?returnTo=${encodeURIComponent(returnTo)}`}
                    >Open current task <span aria-hidden="true">→</span></Link>
                  ) : null}
                  <div className="atlas-day-overview-pills" aria-label="Work by assignee">
                    {peopleList.map((person) => <span key={person.key}>{person.label} {person.count}</span>)}
                  </div>
                  <div className="atlas-day-route-grid">
                    <div className="atlas-day-route-box"><strong>Open</strong><span>{counts.open} tasks</span><em>Still active</em></div>
                    <div className="atlas-day-route-box"><strong>Carry forward</strong><span>{carriedTasks.length} tasks</span><em>Unfinished earlier work</em></div>
                    <div className="atlas-day-route-box"><strong>Blocked</strong><span>{counts.blocked} tasks</span><em>Needs a decision or dependency</em></div>
                    <div className="atlas-day-route-box"><strong>Complete</strong><span>{counts.done} tasks</span><em>Recorded for this day</em></div>
                  </div>
                </div>
              </details>
            </article>

            {error ? <div className="atlas-task-page-empty error">The farm-wide day could not be loaded.</div> : null}
            {!error && !tasks.length ? <div className="atlas-day-route-empty">No assigned farm work is due or carried into this day.</div> : null}

            {!error && carriedTasks.length ? (
              <article className="atlas-day-route-group atlas-day-overdue-group" aria-label="Overdue carry-forward work">
                <div className="atlas-day-overdue-group-head"><div><span>Carry forward</span><h3>Overdue</h3></div><b>{carriedTasks.length}</b></div>
                <p>These unfinished tasks remain ahead of this day’s regular work.</p>
                <div className="atlas-day-work-order-list">{carriedTasks.map((task) => <ManagerOverdueTask key={task.task_id} task={task} returnTo={returnTo} />)}</div>
              </article>
            ) : null}

            {!error && todayTasks.length ? (
              <div className="atlas-day-task-groups">
                <article className="atlas-day-route-group atlas-day-work-order-group atlas-day-timeline-group">
                  <h3>Today</h3>
                  <div className="atlas-day-work-order-list atlas-day-route-spine">
                    {todayTasks.map((task) => <ManagerTimelineTask key={task.task_id} task={task} currentTaskId={currentTask?.task_id ?? null} returnTo={returnTo} />)}
                  </div>
                </article>
              </div>
            ) : null}

            {!error && doneTasks.length ? (
              <details className="atlas-day-overview-drawer atlas-day-complete-drawer">
                <summary><span className="atlas-day-complete-label">Complete</span><span className="atlas-day-complete-count">{doneTasks.length} {doneTasks.length === 1 ? "task" : "tasks"}</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-day-complete-body atlas-day-zone-group">{doneTasks.map((task) => <ManagerCompleteTask key={task.task_id} task={task} returnTo={returnTo} />)}</div>
              </details>
            ) : null}

            <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent farm days">
              <Link href={`/manage/day?date=${previousDate}`} aria-label="Open previous farm day"><span aria-hidden="true">←</span><em>Previous</em></Link>
              <Link href={`/manage/day?date=${nextDate}`} aria-label="Open next farm day"><em>Next</em><span aria-hidden="true">→</span></Link>
            </nav>
          </section>
        </div>
      </section>
    </main>
  );
}
