"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import styles from "./rhythms.module.css";

export type BiologicalRhythmItem = {
  stateId: string;
  bindingId: string;
  ruleId: string;
  rhythmKey: "grow_room_care" | "germination_watch" | "harvest_watch" | "guest_readiness" | "mowing" | "project_review" | "seed_inventory_freshness" | string;
  ruleKey: string;
  ruleLabel: string;
  ruleVersion: number;
  subjectKind: string;
  subjectId: string;
  subjectLabel: string;
  state: string;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  currentTaskId: string | null;
  bindingActive: boolean;
  validitySeconds: number;
  warningSeconds: number;
  graceSeconds: number;
  why: string;
  controls: { pauseAppliesToRule?: boolean; canExtendState?: boolean; canForgiveState?: boolean; canReviseRule?: boolean };
};

export type BiologicalRhythmDashboard = {
  contractVersion: "biological_rhythm_dashboard_v1";
  farmId: string;
  items: BiologicalRhythmItem[];
};

type ControlAction = "extend" | "forgive" | "pause_rule" | "resume_rule" | "revise";
type Draft = { reason: string; validityDays: string; warningHours: string; graceHours: string };

function titleForRhythm(key: string) {
  if (key === "grow_room_care") return "Grow Room care";
  if (key === "germination_watch") return "Germination watches";
  if (key === "harvest_watch") return "Harvest watches";
  if (key === "guest_readiness") return "Guest readiness";
  if (key === "mowing") return "Mowing routes";
  if (key === "project_review") return "Project reviews";
  if (key === "seed_inventory_freshness") return "Seed inventory freshness";
  return key.replaceAll("_", " ");
}

function stateLabel(state: string) {
  if (state === "resting") return "In rhythm";
  if (state === "coming_due") return "Coming due";
  if (state === "due") return "Due";
  if (state === "fallen_out_of_rhythm") return "Fallen out of rhythm";
  if (state === "recovering") return "Recovering";
  if (state === "paused") return "Paused";
  return "Waiting for first evidence";
}

function stateTone(state: string) {
  if (state === "fallen_out_of_rhythm") return "fallen";
  if (state === "due") return "due";
  if (state === "coming_due") return "warning";
  if (state === "paused") return "paused";
  if (state === "recovering") return "recovering";
  return "resting";
}

function dateLabel(value: string | null, prefix: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((targetDay.getTime() - todayDay.getTime()) / 86400000);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${prefix} ${when}`;
}

function secondsToDays(value: number) { return Math.max(1, Math.round(value / 86400)); }
function secondsToHours(value: number) { return Math.max(0, Math.round(value / 3600)); }
function defaultDraft(item: BiologicalRhythmItem): Draft {
  return { reason: "", validityDays: String(secondsToDays(item.validitySeconds)), warningHours: String(secondsToHours(item.warningSeconds)), graceHours: String(secondsToHours(item.graceSeconds)) };
}

function scopeNote(item: BiologicalRhythmItem) {
  if (item.rhythmKey === "germination_watch") return "Pause or cadence revision applies to this germination-stage rule, not only this one crop. Extend and forgive apply only to this crop’s current watch.";
  if (item.rhythmKey === "harvest_watch") return "Pause or cadence revision applies to the Harvest Watch stage rule. Extend and forgive apply only to this crop’s current observation lease.";
  if (item.rhythmKey === "guest_readiness") return "Pause or cadence revision applies to the indoor venue’s Guest Readiness rule. Extend and forgive apply only to the current room-walk lease.";
  if (item.rhythmKey === "mowing") return "Pause or cadence revision applies only to this permanent mowing route. Extend and forgive apply to this route’s current observation lease without claiming anything about grass condition.";
  if (item.rhythmKey === "project_review") return "Pause or cadence revision applies only to this farm project. Extend and forgive alter the current review lease; they do not claim that the project is healthy, moving, blocked, or complete.";
  if (item.rhythmKey === "seed_inventory_freshness") return "Pause or cadence revision applies only to this seed lot’s count-freshness rule. Extend and forgive change the count lease; they never change the physical quantity or create receipt, consumption, loss, or damage evidence.";
  return "Pause or cadence revision applies to the Grow Room care rule. Extend and forgive apply only to the current care lease.";
}

function RhythmCard({ item }: { item: BiologicalRhythmItem }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => defaultDraft(item));
  const [revising, setRevising] = useState(false);
  const [pending, setPending] = useState<ControlAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const boundaries = [dateLabel(item.warningAt, "Warning"), dateLabel(item.dueAt, "Due"), dateLabel(item.failureAt, "Failure")].filter(Boolean) as string[];

  async function control(action: ControlAction) {
    const reason = draft.reason.trim();
    if (!reason) { setMessage("Record the Owner reason first."); return; }
    try {
      setPending(action); setMessage(null);
      const body: Record<string, unknown> = { stateId: item.stateId, action, reason, idempotencyKey: `biological:${action}:${item.stateId}:${Date.now()}` };
      if (action === "extend") body.extensionSeconds = 86400;
      if (action === "revise") {
        const validityDays = Number(draft.validityDays); const warningHours = Number(draft.warningHours); const graceHours = Number(draft.graceHours);
        if (!Number.isFinite(validityDays) || validityDays <= 0 || !Number.isFinite(warningHours) || warningHours < 0 || !Number.isFinite(graceHours) || graceHours < 0) throw new Error("Enter valid cadence values.");
        body.validitySeconds = Math.round(validityDays * 86400); body.warningSeconds = Math.round(warningHours * 3600); body.graceSeconds = Math.round(graceHours * 3600);
      }
      const response = await fetch("/api/atlas/rhythms/control", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { ok?: boolean; error?: string; details?: string };
      if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Rulebook update failed.");
      setMessage(action === "revise" ? "New Rulebook version activated." : "Rhythm updated.");
      setDraft((current) => ({ ...current, reason: "" })); setRevising(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Rulebook update failed."); }
    finally { setPending(null); }
  }

  return (
    <article className={styles.rhythmCard} data-state={stateTone(item.state)}>
      <header className={styles.cardHead}><div><small>{item.ruleLabel} · v{item.ruleVersion}</small><h3>{item.subjectLabel}</h3></div><span>{stateLabel(item.state)}</span></header>
      <p className={styles.why}>{item.why}</p>
      <div className={styles.boundaries} aria-label="Clock boundaries">{boundaries.length ? boundaries.map((boundary) => <span key={boundary}>{boundary}</span>) : <span>Waiting for first qualifying evidence</span>}</div>
      {item.currentTaskId ? <p className={styles.workNote}>A canonical work card is already attached to this rhythm.</p> : null}
      <details className={styles.controls}>
        <summary>Owner controls</summary>
        <div className={styles.controlBody}>
          <label><span>Reason</span><textarea rows={3} value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is this rhythm changing?" /></label>
          <div className={styles.controlButtons}>
            <button type="button" disabled={Boolean(pending)} onClick={() => void control("extend")}>Extend 1 day</button>
            <button type="button" disabled={Boolean(pending)} onClick={() => void control("forgive")}>Forgive + restart</button>
            <button type="button" disabled={Boolean(pending)} onClick={() => void control(item.bindingActive ? "pause_rule" : "resume_rule")}>{item.bindingActive ? "Pause this rule" : "Resume this rule"}</button>
            <button type="button" disabled={Boolean(pending)} onClick={() => setRevising((value) => !value)}>Revise cadence</button>
          </div>
          {revising ? <div className={styles.revision}>
            <label><span>Valid for days</span><input inputMode="decimal" value={draft.validityDays} onChange={(event) => setDraft((current) => ({ ...current, validityDays: event.target.value }))} /></label>
            <label><span>Warning hours</span><input inputMode="numeric" value={draft.warningHours} onChange={(event) => setDraft((current) => ({ ...current, warningHours: event.target.value }))} /></label>
            <label><span>Grace hours</span><input inputMode="numeric" value={draft.graceHours} onChange={(event) => setDraft((current) => ({ ...current, graceHours: event.target.value }))} /></label>
            <button type="button" disabled={Boolean(pending)} onClick={() => void control("revise")}>{pending === "revise" ? "Saving…" : "Activate new version"}</button>
          </div> : null}
          <p className={styles.scopeNote}>{scopeNote(item)}</p>
          {message ? <p className={styles.message}>{message}</p> : null}
        </div>
      </details>
    </article>
  );
}

export default function BiologicalRhythmManager({ dashboard }: { dashboard: BiologicalRhythmDashboard }) {
  const groups = useMemo(() => {
    const result = new Map<string, BiologicalRhythmItem[]>();
    dashboard.items.forEach((item) => { const current = result.get(item.rhythmKey) ?? []; current.push(item); result.set(item.rhythmKey, current); });
    return [...result.entries()];
  }, [dashboard.items]);

  if (!groups.length) return <p className={styles.empty}>No farm rhythms are enrolled for this farm yet.</p>;
  return <div className={styles.groups}>{groups.map(([key, items]) => <section className={styles.group} key={key} aria-labelledby={`rhythm-${key}`}><header className={styles.groupHead}><h2 id={`rhythm-${key}`}>{titleForRhythm(key)}</h2><span>{items.length}</span></header><div className={styles.cards}>{items.map((item) => <RhythmCard key={item.stateId} item={item} />)}</div></section>)}</div>;
}
