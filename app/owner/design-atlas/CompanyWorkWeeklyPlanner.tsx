"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addDays,
  parseLocalDateKey,
  toLocalDateKey,
  type CompanyWorkPlanningOrganization,
  type CompanyWorkPlanningQueueItem,
  type CompanyWorkPlanningQueueSuccess,
} from "@/lib/atlas/company-work-planning";

import styles from "./company-work-weekly-planner.module.css";

type PlannerProps = {
  organization: CompanyWorkPlanningOrganization;
  initialWeekStart: string;
};

type DraftDates = Record<string, string>;

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const RANGE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatBoundary(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  }).format(date);
}

function WorkCard({
  item,
  days,
  draftDate,
  disabled,
  onDraft,
  onClear,
}: {
  item: CompanyWorkPlanningQueueItem;
  days: string[];
  draftDate: string | undefined;
  disabled: boolean;
  onDraft: (workItemId: string, date: string) => void;
  onClear: (workItemId: string) => void;
}) {
  const selected = draftDate ?? item.planned_service_date ?? "";
  const carried =
    item.planned_service_date &&
    item.exposure_service_date &&
    item.planned_service_date !== item.exposure_service_date;
  const deadline = formatBoundary(item.hard_finish_at ?? item.next_target_at);

  return (
    <article className={styles.card} data-attention={item.attention_state}>
      <div className={styles.cardTopline}>
        <span className={styles.workMark} aria-hidden="true">
          {item.attention_state === "worker_exception" || item.attention_state === "needs_replan" ? "!" : "○"}
        </span>
        <h3>{item.title}</h3>
      </div>

      <div className={styles.meta}>
        {item.operation_class ? <span>{item.operation_class.replaceAll("_", " ")}</span> : null}
        <span>{item.responsibility_state === "assigned" ? "responsibility set" : "owner responsibility required"}</span>
        {deadline ? <span>edge {deadline}</span> : null}
        {item.open_conflicts > 0 ? <span>{item.open_conflicts} open conflict{item.open_conflicts === 1 ? "" : "s"}</span> : null}
      </div>

      {carried ? (
        <p className={styles.carryNote}>
          Planned {item.planned_service_date}; Worker Day exposure carried to {item.exposure_service_date}
          {item.rollover_count ? ` · ${item.rollover_count} rollover${item.rollover_count === 1 ? "" : "s"}` : ""}.
        </p>
      ) : null}

      {item.latest_result_kind === "blocked" || item.latest_result_kind === "unable" ? (
        <p className={styles.exceptionNote}>
          Worker reported {item.latest_result_kind}{item.latest_result_at ? ` · ${formatBoundary(item.latest_result_at)}` : ""}.
        </p>
      ) : null}

      {item.responsibility_state === "unassigned" ? (
        <p className={styles.boundaryNote}>The organization owner must establish Responsibility before management can put this Work on a Worker Day.</p>
      ) : (
        <div className={styles.actions}>
          <label>
            <span>Plan</span>
            <select
              value={selected}
              disabled={disabled}
              onChange={(event) => onDraft(item.work_item_id, event.target.value)}
            >
              <option value="">Choose day</option>
              {days.map((day) => (
                <option key={day} value={day}>
                  {DATE_FORMAT.format(parseLocalDateKey(day))}
                </option>
              ))}
            </select>
          </label>
          {item.planned_service_date ? (
            <button type="button" className={styles.clearButton} disabled={disabled} onClick={() => onClear(item.work_item_id)}>
              Clear
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}

export default function CompanyWorkWeeklyPlanner({ organization, initialWeekStart }: PlannerProps) {
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [items, setItems] = useState<CompanyWorkPlanningQueueItem[]>([]);
  const [draftDates, setDraftDates] = useState<DraftDates>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekStartDate = useMemo(() => parseLocalDateKey(weekStart), [weekStart]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => toLocalDateKey(addDays(weekStartDate, index))),
    [weekStartDate],
  );
  const weekEnd = days[6];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/atlas/company-work/planning?organizationId=${encodeURIComponent(organization.id)}&weekStart=${encodeURIComponent(weekStart)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as CompanyWorkPlanningQueueSuccess & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Company Work planning could not be loaded.");
      setItems(body.companyWork);
      setDraftDates({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Company Work planning could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organization.id, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduledByDay = useMemo(() => {
    const grouped = Object.fromEntries(days.map((day) => [day, [] as CompanyWorkPlanningQueueItem[]]));
    for (const item of items) {
      if (item.planning_state !== "scheduled" || !item.planned_service_date) continue;
      if (grouped[item.planned_service_date]) grouped[item.planned_service_date].push(item);
    }
    return grouped;
  }, [days, items]);

  const managementPool = useMemo(
    () =>
      items.filter(
        (item) =>
          item.responsibility_state === "unassigned" ||
          item.planning_state === "assigned_unscheduled" ||
          item.planning_state === "needs_replan" ||
          item.attention_state === "worker_exception",
      ),
    [items],
  );

  const outsideWeek = useMemo(
    () =>
      items.filter(
        (item) =>
          item.planning_state === "scheduled" &&
          item.planned_service_date &&
          !days.includes(item.planned_service_date),
      ),
    [days, items],
  );

  const changedPlans = useMemo(
    () =>
      Object.entries(draftDates)
        .filter(([, date]) => Boolean(date))
        .filter(([workItemId, date]) => items.find((item) => item.work_item_id === workItemId)?.planned_service_date !== date)
        .map(([workItemId, serviceDate]) => ({ workItemId, serviceDate })),
    [draftDates, items],
  );

  async function saveWeek() {
    if (!changedPlans.length) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/atlas/company-work/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "plan_week",
          organizationId: organization.id,
          weekStart,
          plans: changedPlans,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "The weekly plan could not be saved.");
      setMessage(`${changedPlans.length} ${changedPlans.length === 1 ? "plan" : "plans"} saved.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The weekly plan could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function clearPlan(workItemId: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/atlas/company-work/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear_plan",
          organizationId: organization.id,
          workItemId,
          reason: "Cleared from Company Work weekly planning surface.",
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "The plan could not be cleared.");
      setMessage("Plan cleared. Responsibility remains unchanged.");
      await load();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "The plan could not be cleared.");
    } finally {
      setSaving(false);
    }
  }

  function moveWeek(delta: number) {
    setWeekStart(toLocalDateKey(addDays(weekStartDate, delta * 7)));
  }

  const rangeLabel = `${RANGE_FORMAT.format(weekStartDate)}–${RANGE_FORMAT.format(parseLocalDateKey(weekEnd))}`;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>COMPANY WORK · WEEK</span>
          <h1>{organization.name ?? "Organization"}</h1>
          <p>The organization owner establishes who holds Responsibility. Management decides when already-assigned Work should be executed.</p>
        </div>
        <nav className={styles.weekNav} aria-label="Week navigation">
          <button type="button" onClick={() => moveWeek(-1)} aria-label="Previous week">←</button>
          <strong>{rangeLabel}</strong>
          <button type="button" onClick={() => moveWeek(1)} aria-label="Next week">→</button>
        </nav>
      </header>

      <section className={styles.truthStrip} aria-label="Planning contract">
        <span>owner sets Responsibility</span>
        <span>management sets plan date</span>
        <span>plan date ≠ Worker Day exposure</span>
        <span>placement ≠ execution authority</span>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.message}>{message}</p> : null}

      <div className={styles.toolbar}>
        <span>{items.length} open Company Work items represented</span>
        <button type="button" className={styles.saveButton} disabled={saving || !changedPlans.length} onClick={() => void saveWeek()}>
          {saving ? "Saving…" : changedPlans.length ? `Save ${changedPlans.length}` : "Week saved"}
        </button>
      </div>

      {loading ? <p className={styles.loading}>Loading Company Work…</p> : null}

      {!loading ? (
        <div className={styles.workspace}>
          <aside className={styles.pool}>
            <header>
              <div>
                <span>MANAGEMENT</span>
                <h2>Needs placement</h2>
              </div>
              <strong>{managementPool.length}</strong>
            </header>
            <p className={styles.poolIntro}>Unassigned Work waits on the owner for Responsibility. Once assigned, management can place it into the week.</p>
            <div className={styles.poolList}>
              {managementPool.map((item) => (
                <WorkCard
                  key={item.work_item_id}
                  item={item}
                  days={days}
                  draftDate={draftDates[item.work_item_id]}
                  disabled={saving}
                  onDraft={(workItemId, date) => setDraftDates((current) => ({ ...current, [workItemId]: date }))}
                  onClear={(workItemId) => void clearPlan(workItemId)}
                />
              ))}
              {!managementPool.length ? <p className={styles.empty}>Nothing is waiting on management for this queue.</p> : null}
            </div>
          </aside>

          <section className={styles.week} aria-label="Weekly Company Work plan">
            {days.map((day) => {
              const date = parseLocalDateKey(day);
              const rows = scheduledByDay[day] ?? [];
              return (
                <section className={styles.day} key={day}>
                  <header className={styles.dayHeader}>
                    <div>
                      <span>{new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date)}</span>
                      <strong>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)}</strong>
                    </div>
                    <b>{rows.length || ""}</b>
                  </header>
                  <div className={styles.dayList}>
                    {rows.map((item) => (
                      <WorkCard
                        key={item.work_item_id}
                        item={item}
                        days={days}
                        draftDate={draftDates[item.work_item_id]}
                        disabled={saving}
                        onDraft={(workItemId, plannedDate) => setDraftDates((current) => ({ ...current, [workItemId]: plannedDate }))}
                        onClear={(workItemId) => void clearPlan(workItemId)}
                      />
                    ))}
                    {!rows.length ? <span className={styles.openDay}>○</span> : null}
                  </div>
                </section>
              );
            })}
          </section>
        </div>
      ) : null}

      {!loading && outsideWeek.length ? (
        <details className={styles.otherDates}>
          <summary>{outsideWeek.length} planned outside this week</summary>
          <div>
            {outsideWeek.map((item) => (
              <WorkCard
                key={item.work_item_id}
                item={item}
                days={days}
                draftDate={draftDates[item.work_item_id]}
                disabled={saving}
                onDraft={(workItemId, date) => setDraftDates((current) => ({ ...current, [workItemId]: date }))}
                onClear={(workItemId) => void clearPlan(workItemId)}
              />
            ))}
          </div>
        </details>
      ) : null}

      <footer className={styles.footer}>
        <p><strong>Management can change the week without changing who owns the Work.</strong> Only the organization owner establishes Responsibility; rollover may change Worker Day exposure without rewriting the manager’s original planned date.</p>
      </footer>
    </main>
  );
}
