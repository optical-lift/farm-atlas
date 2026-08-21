"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type RoundMember = AtlasTaskCard & {
  routeStop: string;
  routeOrder: number;
  memberOrder: number;
  displayLabel: string;
  displayDetail: string | null;
  issueOptions: string[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 999) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function isDone(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function asMember(task: AtlasTaskCard): RoundMember {
  return Object.assign(task, {
    routeStop: text(task.metadata?.farm_round_route_stop_label) || "Elm Farm",
    routeOrder: number(task.metadata?.farm_round_route_order),
    memberOrder: number(task.metadata?.farm_round_member_order),
    displayLabel: text(task.metadata?.farm_round_display_label) || task.title,
    displayDetail: text(task.metadata?.farm_round_display_detail) || null,
    issueOptions: stringArray(task.metadata?.farm_round_issue_options),
  });
}

function returnPath(assignee: AtlasAssigneeConfig) {
  if (typeof window === "undefined") return assignee.listPath;
  const requested = new URLSearchParams(window.location.search).get("returnTo");
  return requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : assignee.listPath;
}

export default function FarmRoundTaskDetail({ task, childTasks, assignee }: Props) {
  const [members, setMembers] = useState<RoundMember[]>(() => childTasks.map(asMember));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [issueOpenId, setIssueOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...members].sort((left, right) => left.routeOrder - right.routeOrder || left.memberOrder - right.memberOrder || left.displayLabel.localeCompare(right.displayLabel)),
    [members],
  );
  const stops = useMemo(() => {
    const grouped = new Map<string, RoundMember[]>();
    for (const member of ordered) grouped.set(member.routeStop, [...(grouped.get(member.routeStop) ?? []), member]);
    return Array.from(grouped.entries());
  }, [ordered]);
  const remaining = ordered.filter((member) => !isDone(member)).length;

  async function toggle(member: RoundMember) {
    const done = isDone(member);
    try {
      setSavingId(member.task_id);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: member.task_id,
        transition: done ? "reopened" : "done",
        note: done ? "Reopened from Farm Round." : "Completed from Farm Round.",
        payload: { farmRoundParentTaskId: task.task_id, farmRoundMember: true },
      });
      const nextMembers = members.map((candidate) => candidate.task_id === member.task_id
        ? { ...candidate, status: done ? "open" : "done" }
        : candidate);
      setMembers(nextMembers);
      if (!done && nextMembers.every((candidate) => isDone(candidate))) {
        window.setTimeout(() => window.location.assign(returnPath(assignee)), 120);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not update this Farm Round item.");
    } finally {
      setSavingId(null);
    }
  }

  async function reportIssue(member: RoundMember, issue: string) {
    try {
      setSavingId(member.task_id);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: member.task_id,
        transition: "note",
        note: `Farm Round issue: ${issue}`,
        payload: { farmRoundParentTaskId: task.task_id, farmRoundMember: true, farmRoundIssue: issue },
      });
      setIssueOpenId(null);
      setMessage(`${member.displayLabel}: ${issue} logged.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not log this Farm Round issue.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main data-atlas-farm-round="v1" style={{ maxWidth: 760, margin: "0 auto", padding: "18px 14px 40px" }}>
      <style>{`
        .atlas-farm-round-key{display:flex;gap:14px;padding:0 28px 13px;color:#9a959e;font-size:.68rem;font-weight:760}.atlas-farm-round-stops{display:grid;gap:13px;padding:0 28px 26px}.atlas-farm-round-stop{border:1px solid rgba(66,62,79,.12);border-radius:15px;background:#fffdf8;overflow:visible}.atlas-farm-round-stop>header{padding:12px 14px 8px}.atlas-farm-round-stop>header h3{margin:0;color:#2f2e42;font-size:1rem}.atlas-farm-round-row{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:50px;padding:7px 12px;border-top:1px solid rgba(66,62,79,.08)}.atlas-farm-round-row button{font:inherit}.atlas-farm-round-check{width:22px;height:22px;border:1.5px solid #aaa5ae;border-radius:50%;background:#fff;color:#65713f;font-size:.75rem;font-weight:950}.atlas-farm-round-row[data-done=true] .atlas-farm-round-check{border-color:#87945f;background:#e2e9c8}.atlas-farm-round-copy strong{display:block;color:#3d3a48;font-size:.91rem;line-height:1.16}.atlas-farm-round-copy small{display:block;margin-top:3px;color:#918d94;font-size:.72rem}.atlas-farm-round-row[data-done=true] .atlas-farm-round-copy{opacity:.58;text-decoration:line-through}.atlas-farm-round-issue{border:0;background:transparent;color:#7772ad;font-size:1.45rem;font-weight:500;line-height:1}.atlas-farm-round-issues{grid-column:2 / 4;display:flex;flex-wrap:wrap;gap:6px;padding:0 0 9px}.atlas-farm-round-issues button{border:1px solid rgba(119,114,173,.18);border-radius:999px;background:#f2eff8;color:#625c91;padding:7px 10px;font-size:.72rem;font-weight:760}.atlas-farm-round-message{margin:0 28px 22px;color:#665f72;font-size:.8rem}.atlas-farm-round-empty{padding:0 28px 24px;color:#85818a}.atlas-farm-round-row button:disabled{opacity:.55}@media(max-width:560px){.atlas-farm-round-key,.atlas-farm-round-stops,.atlas-farm-round-message,.atlas-farm-round-empty{margin-left:0;margin-right:0;padding-left:21px;padding-right:21px}}
      `}</style>
      <AtlasTaskCardFrame
        family="Stewardship"
        familyDetail="recurring round"
        title="Farm Round"
        subtitle="Elm Farm"
        timing={remaining === 0 ? "Round complete" : `${remaining} ${remaining === 1 ? "item" : "items"} due`}
        completion={false}
      >
        <div className="atlas-farm-round-key" aria-label="Farm Round controls"><span>tap to cross off</span><span>+ report issue</span></div>
        {stops.length ? (
          <div className="atlas-farm-round-stops" aria-label="Farm Round walking route">
            {stops.map(([stop, items]) => (
              <section className="atlas-farm-round-stop" key={stop}>
                <header><h3>{stop}</h3></header>
                {items.map((member) => {
                  const done = isDone(member);
                  const busy = savingId === member.task_id;
                  return (
                    <div className="atlas-farm-round-row" data-done={done ? "true" : "false"} key={member.task_id}>
                      <button type="button" className="atlas-farm-round-check" disabled={Boolean(savingId)} aria-pressed={done} aria-label={done ? `Reopen ${member.displayLabel}` : `Complete ${member.displayLabel}`} onClick={() => void toggle(member)}>{done ? "✓" : ""}</button>
                      <div className="atlas-farm-round-copy"><strong>{member.displayLabel}</strong>{member.displayDetail ? <small>{member.displayDetail}</small> : null}</div>
                      {member.issueOptions.length ? <button type="button" className="atlas-farm-round-issue" disabled={Boolean(savingId)} aria-expanded={issueOpenId === member.task_id} aria-label={`Report an issue with ${member.displayLabel}`} onClick={() => setIssueOpenId((current) => current === member.task_id ? null : member.task_id)}>+</button> : <span />}
                      {issueOpenId === member.task_id ? (
                        <div className="atlas-farm-round-issues">
                          {member.issueOptions.map((issue) => <button type="button" key={issue} disabled={busy} onClick={() => void reportIssue(member, issue)}>{issue}</button>)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : <p className="atlas-farm-round-empty">No stewardship rows are due in this round.</p>}
        {message ? <p className="atlas-farm-round-message">{message}</p> : null}
      </AtlasTaskCardFrame>
    </main>
  );
}
