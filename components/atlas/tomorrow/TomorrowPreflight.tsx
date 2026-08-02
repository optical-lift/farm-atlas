"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type {
  AtlasPresentedWorkEntry,
  AtlasPresentedWorkPacket,
  AtlasReservoirDecision,
  AtlasReservoirDecisionAction,
  AtlasTomorrowPreflight,
} from "@/lib/atlas/tomorrow-preflight-contract";

const LANE_LABELS: Record<string, string> = {
  required: "Required",
  process_continuation: "Process",
  rhythm: "Rhythm",
  discretionary: "Flexible",
};

const REASON_LABELS: Record<string, string> = {
  required_obligation: "Must happen",
  ready_continuation: "Ready continuation",
  current_rhythm_serving: "Current serving",
  within_day_budget: "Fits the day",
  blocked: "Blocked",
  owner_review: "Owner decision",
  future: "Future reservoir work",
  superseded_rhythm_serving: "Older rhythm serving",
  held_for_day_budget: "Held for capacity",
};

function number(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function dateLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function taskDate(value: string | null) {
  if (!value) return "No fixed date";
  const parsed = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function laneClass(lane: string) {
  return `tomorrow-lane tomorrow-lane--${lane.replace(/[^a-z_]/g, "")}`;
}

function TaskRow({ entry }: { entry: AtlasPresentedWorkEntry }) {
  const { task } = entry;
  return (
    <article className={`tomorrow-task${task.status === "blocked" ? " tomorrow-task--blocked" : ""}`}>
      <div className="tomorrow-task__topline">
        <span className={laneClass(task.work_lane)}>{LANE_LABELS[task.work_lane] ?? task.work_lane}</span>
        <span>{number(Number(task.effort_units ?? 1))} unit{Number(task.effort_units ?? 1) === 1 ? "" : "s"}</span>
        <span>{taskDate(task.due_date)}</span>
      </div>
      <h4>{task.title}</h4>
      <p className="tomorrow-task__reason">{REASON_LABELS[entry.presentationReason] ?? entry.presentationReason}</p>
      {task.blocker_text ? <p className="tomorrow-task__blocker">Blocked by: {task.blocker_text}</p> : null}
      {task.note ? <p>{task.note}</p> : null}
      <div className="tomorrow-task__footer">
        {task.zone_label ? <span>{task.zone_label}</span> : <span>Farm-wide</span>}
        {task.commitment_kind === "hard_date" ? (
          <span className={entry.notificationPlanned ? "tomorrow-notification" : "tomorrow-notification tomorrow-notification--missing"}>
            {entry.notificationPlanned ? "Notification covered" : "Notification missing"}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function WorkList({
  title,
  entries,
  empty,
}: {
  title: string;
  entries: AtlasPresentedWorkEntry[];
  empty: string;
}) {
  return (
    <section className="tomorrow-work-list">
      <div className="tomorrow-work-list__header">
        <h3>{title}</h3>
        <span>{entries.length}</span>
      </div>
      {entries.length ? entries.map((entry) => <TaskRow key={entry.task.task_id} entry={entry} />) : <p className="tomorrow-empty">{empty}</p>}
    </section>
  );
}

function MemberCard({ packet }: { packet: AtlasPresentedWorkPacket }) {
  const loadPercent = packet.summary.budgetUnits > 0
    ? Math.min(100, (packet.summary.presentedUnits / packet.summary.budgetUnits) * 100)
    : 0;

  return (
    <article className={`tomorrow-member${packet.summary.overloadUnits > 0 ? " tomorrow-member--overload" : ""}`}>
      <header className="tomorrow-member__header">
        <div>
          <p className="tomorrow-eyebrow">{packet.member.role.replace("_", " ")}</p>
          <h2>{packet.member.displayName}</h2>
        </div>
        <div className="tomorrow-member__load">
          <strong>{number(packet.summary.presentedUnits)} / {number(packet.summary.budgetUnits)}</strong>
          <span>day units</span>
        </div>
      </header>

      <div className="tomorrow-load-track" aria-label={`${packet.member.displayName} workload`}>
        <span style={{ width: `${loadPercent}%` }} />
      </div>

      <div className="tomorrow-member__facts">
        <span>{number(packet.summary.mandatoryUnits)} mandatory</span>
        <span>{packet.summary.presentedCount} in the day</span>
        <span>{packet.summary.heldCount} held back</span>
      </div>

      {packet.summary.overloadUnits > 0 ? (
        <p className="tomorrow-warning">
          Required work exceeds this person&apos;s normal day by {number(packet.summary.overloadUnits)} units. Atlas is still presenting it because obligation outranks capacity.
        </p>
      ) : null}
      {packet.summary.hardDateMissingNotificationCount > 0 ? (
        <p className="tomorrow-warning tomorrow-warning--danger">
          {packet.summary.hardDateMissingNotificationCount} hard-date task{packet.summary.hardDateMissingNotificationCount === 1 ? " is" : "s are"} missing notification coverage.
        </p>
      ) : null}

      <div className="tomorrow-member__columns">
        <WorkList title="In the day" entries={packet.presented} empty="Nothing is being placed into this day." />
        <WorkList title="Needs attention" entries={packet.attention} empty="No blockers or management decisions are attached to this person." />
      </div>

      <details className="tomorrow-held">
        <summary>Held in the reservoir <span>{packet.held.length}</span></summary>
        <div className="tomorrow-held__list">
          {packet.held.map((entry) => <TaskRow key={entry.task.task_id} entry={entry} />)}
        </div>
      </details>
    </article>
  );
}

function DecisionCard({
  decision,
  workDate,
  pending,
  onResolve,
}: {
  decision: AtlasReservoirDecision;
  workDate: string;
  pending: boolean;
  onResolve: (decision: AtlasReservoirDecision, action: AtlasReservoirDecisionAction, targetDate?: string) => void;
}) {
  const [targetDate, setTargetDate] = useState(workDate);

  return (
    <article className="tomorrow-decision">
      <div>
        <p className="tomorrow-eyebrow">Untouched flexible work</p>
        <h3>{decision.title}</h3>
        <p>{decision.reason}</p>
        <div className="tomorrow-decision__meta">
          <span>Current date: {taskDate(decision.dueDate)}</span>
          <span>{number(Number(decision.effortUnits ?? 1))} unit{Number(decision.effortUnits ?? 1) === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="tomorrow-decision__actions">
        <button type="button" disabled={pending} onClick={() => onResolve(decision, "keep_now")}>Keep in Work</button>
        <label>
          <span>Choose a real date</span>
          <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </label>
        <button type="button" disabled={pending || !targetDate} onClick={() => onResolve(decision, "choose_date", targetDate)}>Move to date</button>
        <button type="button" disabled={pending} onClick={() => onResolve(decision, "return_to_reservoir")}>Return to reservoir</button>
        <button
          className="tomorrow-danger-button"
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Archive “${decision.title}”? This removes it from active and planned work.`)) {
              onResolve(decision, "archive");
            }
          }}
        >
          Archive
        </button>
      </div>
    </article>
  );
}

export default function TomorrowPreflight({
  initialPreflight,
  farmName,
}: {
  initialPreflight: AtlasTomorrowPreflight;
  farmName: string;
}) {
  const [preflight, setPreflight] = useState(initialPreflight);
  const [error, setError] = useState<string | null>(null);
  const [pendingDecisionId, setPendingDecisionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dateHref = useMemo(() => `/tomorrow?date=${preflight.workDate}`, [preflight.workDate]);

  function moveDate(nextDate: string) {
    if (!nextDate) return;
    window.location.assign(`/tomorrow?date=${nextDate}`);
  }

  function resolveDecision(
    decision: AtlasReservoirDecision,
    action: AtlasReservoirDecisionAction,
    targetDate?: string,
  ) {
    setError(null);
    setPendingDecisionId(decision.decisionId);
    startTransition(async () => {
      try {
        const response = await fetch("/api/atlas/tomorrow-preflight", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-atlas-intent": "tomorrow-preflight-decision-v1",
          },
          body: JSON.stringify({
            decisionId: decision.decisionId,
            action,
            targetDate: targetDate ?? null,
            workDate: preflight.workDate,
          }),
        });
        const payload = await response.json() as { ok?: boolean; error?: string; message?: string; preflight?: AtlasTomorrowPreflight };
        if (!response.ok || !payload.preflight) {
          throw new Error(payload.message || payload.error || "Atlas could not save that decision.");
        }
        setPreflight(payload.preflight);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Atlas could not save that decision.");
      } finally {
        setPendingDecisionId(null);
      }
    });
  }

  return (
    <main className="tomorrow-shell">
      <header className="tomorrow-hero">
        <div>
          <p className="tomorrow-eyebrow">{farmName} · management</p>
          <h1>Tomorrow Preflight</h1>
          <p>What Atlas has promised each person, what it is holding back, and what still needs a human decision.</p>
        </div>
        <div className="tomorrow-hero__controls">
          <label>
            <span>Farm day</span>
            <input type="date" value={preflight.workDate} onChange={(event) => moveDate(event.target.value)} />
          </label>
          <Link href="/">Back to Atlas</Link>
        </div>
      </header>

      <section className="tomorrow-date-banner">
        <div>
          <p className="tomorrow-eyebrow">Execution window</p>
          <h2>{dateLabel(preflight.workDate)}</h2>
        </div>
        <Link href={dateHref}>Refresh this preflight</Link>
      </section>

      <section className="tomorrow-summary" aria-label="Preflight summary">
        <div><strong>{preflight.summary.presentedCount}</strong><span>presented</span></div>
        <div><strong>{preflight.summary.attentionCount}</strong><span>attention</span></div>
        <div><strong>{preflight.summary.heldCount}</strong><span>held back</span></div>
        <div className={preflight.summary.overloadedMemberCount ? "tomorrow-summary__warn" : ""}><strong>{preflight.summary.overloadedMemberCount}</strong><span>overloaded people</span></div>
        <div className={preflight.summary.hardDateMissingNotificationCount ? "tomorrow-summary__danger" : ""}><strong>{preflight.summary.hardDateMissingNotificationCount}</strong><span>notification gaps</span></div>
      </section>

      {error ? <p className="tomorrow-error" role="alert">{error}</p> : null}

      <section className="tomorrow-decisions">
        <div className="tomorrow-section-heading">
          <div>
            <p className="tomorrow-eyebrow">Owner queue</p>
            <h2>Still real, choose a date, or let it go</h2>
          </div>
          <span>{preflight.decisions.length} open</span>
        </div>
        {preflight.decisions.length ? preflight.decisions.map((decision) => (
          <DecisionCard
            key={decision.decisionId}
            decision={decision}
            workDate={preflight.workDate}
            pending={isPending && pendingDecisionId === decision.decisionId}
            onResolve={resolveDecision}
          />
        )) : <p className="tomorrow-empty tomorrow-empty--large">The reservoir decision queue is clear.</p>}
      </section>

      <section className="tomorrow-members">
        <div className="tomorrow-section-heading">
          <div>
            <p className="tomorrow-eyebrow">People</p>
            <h2>The day Atlas will actually present</h2>
          </div>
          <span>{preflight.members.length} active</span>
        </div>
        {preflight.members.map((packet) => <MemberCard key={packet.membershipId} packet={packet} />)}
      </section>
    </main>
  );
}
