"use client";

import { useMemo, useState } from "react";

import roundStyles from "@/components/atlas/farm-round-task-detail.module.css";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type RoundMember = AtlasTaskCard & { routeStop: string; routeOrder: number; memberOrder: number; displayLabel: string; displayDetail: string | null; issueOptions: string[] };

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown, fallback = 999) { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : []; }
function isDone(task: AtlasTaskCard) { return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done"; }
function asMember(task: AtlasTaskCard): RoundMember { return Object.assign(task, { routeStop: text(task.metadata?.farm_round_route_stop_label) || "Elm Farm", routeOrder: number(task.metadata?.farm_round_route_order), memberOrder: number(task.metadata?.farm_round_member_order), displayLabel: text(task.metadata?.farm_round_display_label) || task.title, displayDetail: text(task.metadata?.farm_round_display_detail) || null, issueOptions: stringArray(task.metadata?.farm_round_issue_options) }); }
function returnPath(assignee: AtlasAssigneeConfig) { if (typeof window === "undefined") return assignee.listPath; const requested = new URLSearchParams(window.location.search).get("returnTo"); return requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : assignee.listPath; }

export default function FarmRoundTaskDetail({ task, childTasks, assignee }: Props) {
  const [members, setMembers] = useState<RoundMember[]>(() => childTasks.map(asMember));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingRound, setSavingRound] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ordered = useMemo(() => [...members].sort((left, right) => left.routeOrder - right.routeOrder || left.memberOrder - right.memberOrder || left.displayLabel.localeCompare(right.displayLabel)), [members]);
  const stops = useMemo(() => { const grouped = new Map<string, RoundMember[]>(); for (const member of ordered) grouped.set(member.routeStop, [...(grouped.get(member.routeStop) ?? []), member]); return Array.from(grouped.entries()); }, [ordered]);
  const remaining = ordered.filter((member) => !isDone(member)).length;
  const completionBusy = Boolean(savingId) || savingRound;

  async function toggle(member: RoundMember) {
    const done = isDone(member);
    try {
      setSavingId(member.task_id); setMessage(null);
      await postAtlasTaskTransition({ taskId: member.task_id, transition: done ? "reopened" : "done", note: done ? "Reopened from Farm Round." : "Completed from Farm Round.", payload: { farmRoundParentTaskId: task.task_id, farmRoundMember: true } });
      const nextMembers = members.map((candidate) => candidate.task_id === member.task_id ? { ...candidate, status: done ? "open" : "done" } : candidate);
      setMembers(nextMembers);
      if (!done && nextMembers.every((candidate) => isDone(candidate))) window.setTimeout(() => window.location.assign(returnPath(assignee)), 120);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Atlas could not update this Farm Round item."); }
    finally { setSavingId(null); }
  }

  async function completeRound() {
    const pending = ordered.filter((member) => !isDone(member));
    if (!pending.length) { window.location.assign(returnPath(assignee)); return; }
    setSavingRound(true); setMessage(null); let nextMembers = members;
    try {
      for (const member of pending) {
        await postAtlasTaskTransition({ taskId: member.task_id, transition: "done", note: "Completed from Farm Round Done action.", payload: { farmRoundParentTaskId: task.task_id, farmRoundMember: true, farmRoundTerminalAction: true } });
        nextMembers = nextMembers.map((candidate) => candidate.task_id === member.task_id ? { ...candidate, status: "done" } : candidate); setMembers(nextMembers);
      }
      window.location.assign(returnPath(assignee));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Atlas could not complete this Farm Round."); }
    finally { setSavingRound(false); }
  }

  function leaveUnfinished() { window.location.assign(returnPath(assignee)); }
  async function reportIssue(member: RoundMember, issue: string) {
    try { setSavingId(member.task_id); setMessage(null); await postAtlasTaskTransition({ taskId: member.task_id, transition: "note", note: `Farm Round issue: ${issue}`, payload: { farmRoundParentTaskId: task.task_id, farmRoundMember: true, farmRoundIssue: issue } }); setMessage(`${member.displayLabel}: ${issue} logged.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Atlas could not log this Farm Round issue."); }
    finally { setSavingId(null); }
  }

  return (
    <main className={roundStyles.shell} data-atlas-farm-round="canonical-card-geometry-v1">
      <AtlasTaskCardFrame family="Stewardship" familyDetail="recurring round" title="Farm Round" subtitle="Elm Farm" timing={remaining === 0 ? "Round complete" : `${remaining} ${remaining === 1 ? "item" : "items"} due`} onDone={() => void completeRound()} onUnfinished={leaveUnfinished} completionDisabled={completionBusy}>
        <div className={roundStyles.key} aria-label="Farm Round controls"><span>Tap a row to cross it off</span><span>Use + to report an issue</span></div>
        {stops.length ? <div className={roundStyles.route} aria-label="Farm Round walking route">
          {stops.map(([stop, items], stopIndex) => <section className={roundStyles.stop} key={stop}>
            <header className={roundStyles.stopHeader}><small>Stop {stopIndex + 1}</small><h3>{stop}</h3><span>{items.filter((item) => !isDone(item)).length} remaining</span></header>
            <div className={roundStyles.items}>{items.map((member) => {
              const done = isDone(member); const busy = savingId === member.task_id;
              return <div className={roundStyles.item} data-done={done ? "true" : "false"} key={member.task_id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={done ? `Reopen ${member.displayLabel}` : `Complete ${member.displayLabel}`}
                  className={roundStyles.itemToggle}
                  disabled={completionBusy}
                  onClick={() => void toggle(member)}
                >
                  <span className={roundStyles.check} aria-hidden="true"><span /></span>
                  <span className={roundStyles.itemCopy}><strong>{member.displayLabel}</strong>{member.displayDetail ? <small>{member.displayDetail}</small> : null}</span>
                </button>
                {member.issueOptions.length ? <details className={roundStyles.issueDrawer}><summary aria-label={`Report an issue with ${member.displayLabel}`}>+</summary><div className={roundStyles.issuePanel}>{member.issueOptions.map((issue) => <button type="button" key={issue} disabled={busy || savingRound} onClick={() => void reportIssue(member, issue)}>{issue}</button>)}</div></details> : null}
              </div>;
            })}</div>
          </section>)}
        </div> : <p className={roundStyles.empty}>No stewardship rows are due in this round.</p>}
        {message ? <p className={roundStyles.message}>{message}</p> : null}
      </AtlasTaskCardFrame>
    </main>
  );
}
