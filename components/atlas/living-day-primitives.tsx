import Link from "next/link";

import type {
  AtlasLivingDayCarriedRhythm,
  AtlasLivingDayCompletionSummary,
  AtlasLivingDayGoal,
  AtlasLivingDayOwnerDecision,
} from "@/lib/atlas/living-day-contract";
import type { AtlasJournalEvent, AtlasJournalUnlock } from "@/lib/atlas/journal-contract";

function taskHref(taskId: string, returnTo: string) {
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function dateTimeLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function goalStateLabel(goal: AtlasLivingDayGoal) {
  if (goal.state === "realized") return "Realized";
  if (goal.state === "in_production") return "In production";
  if (goal.state === "nearly_unlocked") return "Nearly unlocked";
  if (goal.state === "tracking") return "Waiting on biology";
  return "Locked";
}

export function LivingDayCarried({
  rhythms,
  decisions,
  returnTo,
}: {
  rhythms: AtlasLivingDayCarriedRhythm[];
  decisions: AtlasLivingDayOwnerDecision[];
  returnTo: string;
}) {
  const entries = [...rhythms, ...decisions];
  if (!entries.length) return null;

  return (
    <article className="atlas-journal-section atlas-journal-carried" aria-label="Carried into today">
      <div className="atlas-journal-section-head">
        <div><span>Carried into today</span><h3>Unresolved consequences</h3></div>
        <b>{entries.length}</b>
      </div>
      <p>These remain visible across dates and stay outside today’s bounded denominator.</p>
      <div className="atlas-journal-spine">
        {rhythms.map((entry) => (
          <details className={`atlas-journal-entry atlas-journal-entry-${entry.state}`} key={entry.entryKey}>
            <summary>
              <span className="atlas-journal-dot" aria-hidden="true" />
              <div><strong>{entry.title}</strong><em>{entry.state === "recovering" ? "Recovering" : "Failed rhythm"}</em></div>
              <b aria-hidden="true">⌄</b>
            </summary>
            <div className="atlas-journal-entry-body">
              <p>{entry.detail}</p>
              {entry.failureAt ? <span>Failed {dateTimeLabel(entry.failureAt)}</span> : null}
              <span>Physical condition is not inferred from elapsed time.</span>
              {entry.currentTask ? <Link href={taskHref(entry.currentTask.taskId, returnTo)}>Open restoration task <span aria-hidden="true">→</span></Link> : null}
            </div>
          </details>
        ))}
        {decisions.map((entry) => (
          <details className="atlas-journal-entry atlas-journal-entry-decision" key={entry.entryKey}>
            <summary>
              <span className="atlas-journal-dot" aria-hidden="true" />
              <div><strong>{entry.title}</strong><em>Owner decision</em></div>
              <b aria-hidden="true">⌄</b>
            </summary>
            <div className="atlas-journal-entry-body">
              <p>{entry.detail}</p>
              {entry.dueDate ? <span>Due {entry.dueDate}</span> : null}
              <Link href={taskHref(entry.taskId, returnTo)}>Open decision <span aria-hidden="true">→</span></Link>
            </div>
          </details>
        ))}
      </div>
    </article>
  );
}

export function LivingDayGoals({ goals, returnTo }: { goals: AtlasLivingDayGoal[]; returnTo: string }) {
  if (!goals.length) return null;
  return (
    <article className="atlas-journal-section atlas-journal-goals" aria-label="Goals in motion">
      <div className="atlas-journal-section-head">
        <div><span>Ghost goals</span><h3>Goals in motion</h3></div>
        <b>{goals.length}</b>
      </div>
      <p>Visible now, but only existing canonical work is playable.</p>
      <div className="atlas-journal-spine">
        {goals.map((goal) => (
          <details className={`atlas-ghost-goal atlas-ghost-goal-${goal.state}`} key={goal.goalKey} data-goal-key={goal.goalKey}>
            <summary>
              <span className="atlas-journal-dot" aria-hidden="true" />
              <div className="atlas-ghost-goal-copy">
                <small>{goalStateLabel(goal)}</small>
                <strong>{goal.title}</strong>
                <em>{goal.progress.label}</em>
              </div>
              <span className="atlas-ghost-goal-progress" aria-label={`${goal.progress.satisfied} of ${goal.progress.total} requirements satisfied`}>
                {goal.progress.satisfied}/{goal.progress.total}
              </span>
            </summary>
            <div className="atlas-ghost-goal-body">
              <p>{goal.summary}</p>
              <div className="atlas-ghost-requirements">
                {goal.requirements.map((requirement) => (
                  <div className={`atlas-ghost-requirement is-${requirement.state}`} key={requirement.requirementKey}>
                    <span aria-hidden="true" />
                    <div><strong>{requirement.label}</strong>{requirement.detail ? <em>{requirement.detail}</em> : null}</div>
                  </div>
                ))}
              </div>
              {goal.blocker ? <p className="atlas-ghost-blocker">{goal.blocker}</p> : null}
              {goal.window?.start ? <span className="atlas-ghost-window">{goal.window.kind === "germination" ? "Germination" : "Harvest"} window · {goal.window.start}{goal.window.end ? `–${goal.window.end}` : " onward"}</span> : null}
              {goal.nextMove ? <Link className="atlas-ghost-next-move" href={taskHref(goal.nextMove.taskId, returnTo)}>Open next existing move <span aria-hidden="true">→</span></Link> : <span className="atlas-ghost-waiting">No new task is released by this goal.</span>}
            </div>
          </details>
        ))}
      </div>
    </article>
  );
}

export function LivingDayJournal({ events }: { events: AtlasJournalEvent[] }) {
  if (!events.length) return null;
  return (
    <article className="atlas-journal-section atlas-journal-events" aria-label="Journal events today">
      <div className="atlas-journal-section-head">
        <div><span>Journal</span><h3>What changed today</h3></div>
        <b>{events.length}</b>
      </div>
      <div className="atlas-journal-spine">
        {events.map((event) => (
          <details className={`atlas-journal-entry atlas-journal-event-${event.importance}`} key={event.eventId}>
            <summary>
              <span className="atlas-journal-dot" aria-hidden="true" />
              <div><strong>{event.title}</strong><em>{event.sourceEvent.replaceAll("_", " ")}</em></div>
              <b aria-hidden="true">⌄</b>
            </summary>
            <div className="atlas-journal-entry-body">
              {event.detail ? <p>{event.detail}</p> : null}
              <span>{dateTimeLabel(event.occurredAt)}</span>
              <span>Source · {event.provenance.source_table}</span>
            </div>
          </details>
        ))}
      </div>
    </article>
  );
}

export function LivingDayUnlocked({ unlocks, returnTo }: { unlocks: AtlasJournalUnlock[]; returnTo: string }) {
  if (!unlocks.length) return null;
  return (
    <article className="atlas-journal-section atlas-journal-unlocked" aria-label="Unlocked today">
      <div className="atlas-journal-section-head">
        <div><span>Unlocked today</span><h3>New valid moves</h3></div>
        <b>{unlocks.length}</b>
      </div>
      <p>These became valid today and are not added to the bounded denominator automatically.</p>
      <div className="atlas-journal-unlock-list">
        {unlocks.map((unlock) => unlock.taskId
          ? <Link href={taskHref(unlock.taskId, returnTo)} key={unlock.eventId}><strong>{unlock.title}</strong><span>Open move →</span></Link>
          : <div key={unlock.eventId}><strong>{unlock.title}</strong><span>{dateTimeLabel(unlock.occurredAt)}</span></div>)}
      </div>
    </article>
  );
}

export function LivingDayCompletionSummary({ summary }: { summary: AtlasLivingDayCompletionSummary }) {
  const rows = [
    ["Completed", summary.completed],
    ["Partial", summary.partial],
    ["Migrated", summary.migrated],
    ["Blocked", summary.blocked],
    ["Restored", summary.restored],
    ["Advanced", summary.advanced],
    ["Unlocked", summary.unlocked],
  ] as const;
  return (
    <article className="atlas-journal-completion-summary" aria-label="Day completion summary">
      <span>Page resolved</span>
      <h3>What the day changed</h3>
      <div>{rows.filter(([, count]) => count > 0).map(([label, count]) => <p key={label}><strong>{count}</strong><em>{label}</em></p>)}</div>
      {!rows.some(([, count]) => count > 0) ? <p className="atlas-journal-no-change">No canonical state changes were recorded.</p> : null}
    </article>
  );
}
