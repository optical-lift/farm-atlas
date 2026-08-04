"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import styles from "./GuestReadinessFocus.module.css";

export type GuestReadinessRoom = {
  objectId: string;
  label: string;
  currentStatus: string;
  lastObservedAt: string | null;
  currentNote: string | null;
};

export type GuestReadinessTask = {
  id: string;
  title: string;
  dueDate: string | null;
  zoneLabel: string;
  rooms: GuestReadinessRoom[];
  canCloseRooms: boolean;
  initialAcceptance: boolean;
  returnTo?: string | null;
};

type Outcome = "ready" | "small_reset_needed" | "not_guest_ready" | "event_damage_or_problem" | "closed_not_in_use";
type RoomDraft = { outcome: Outcome | ""; note: string };

const baseOptions: Array<{ value: Outcome; label: string }> = [
  { value: "ready", label: "Ready" },
  { value: "small_reset_needed", label: "Small reset needed" },
  { value: "not_guest_ready", label: "Not guest-ready" },
  { value: "event_damage_or_problem", label: "Damage or problem" },
];

function prettyDate(value: string | null) {
  if (!value) return "Not yet observed";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusLabel(value: string) {
  if (value === "small_reset_needed") return "Small reset needed";
  if (value === "not_guest_ready") return "Not guest-ready";
  if (value === "problem") return "Problem recorded";
  if (value === "closed") return "Closed";
  if (value === "ready") return "Ready at last observation";
  return "Unassessed";
}

function needsNote(outcome: Outcome | "") {
  return outcome === "small_reset_needed" || outcome === "not_guest_ready" || outcome === "event_damage_or_problem";
}

export default function GuestReadinessFocusPage({ task }: { task: GuestReadinessTask }) {
  const [drafts, setDrafts] = useState<Record<string, RoomDraft>>(() => Object.fromEntries(
    task.rooms.map((room) => [room.objectId, { outcome: "", note: "" }]),
  ));
  const [roundNote, setRoundNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");
  const options = useMemo(
    () => task.canCloseRooms ? [...baseOptions, { value: "closed_not_in_use" as Outcome, label: "Closed / not in use" }] : baseOptions,
    [task.canCloseRooms],
  );

  const answeredRooms = task.rooms.filter((room) => Boolean(drafts[room.objectId]?.outcome)).length;
  const complete = task.rooms.every((room) => {
    const draft = drafts[room.objectId];
    return Boolean(draft?.outcome) && (!needsNote(draft.outcome) || Boolean(draft.note.trim()));
  });

  function updateRoom(objectId: string, patch: Partial<RoomDraft>) {
    setDrafts((current) => ({
      ...current,
      [objectId]: { ...current[objectId], ...patch },
    }));
  }

  async function submit() {
    if (!complete) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/guest-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          results: task.rooms.map((room) => ({
            objectId: room.objectId,
            outcome: drafts[room.objectId].outcome,
            note: drafts[room.objectId].note.trim() || null,
          })),
          note: roundNote.trim() || null,
          idempotencyKey: `guest-readiness:${task.id}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; aggregateOutcome?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Guest Readiness round failed.");

      if (data.aggregateOutcome === "ready") {
        setMessage("Every active room is guest-ready. The venue rhythm is renewed.");
      } else if (data.aggregateOutcome === "small_reset_needed") {
        setMessage("The observation is recorded. This round stays open until the small resets are finished and the rooms are checked again.");
      } else if (data.aggregateOutcome === "closed") {
        setMessage("The venue is recorded as closed. Its Guest Readiness Clock is paused.");
      } else {
        setMessage("The venue is not guest-ready. Atlas preserved the room evidence and returned the round for Owner attention.");
      }
      window.setTimeout(() => window.location.assign(returnTo), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Guest Readiness round failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Elm Farm</span>
          </Link>
          <span className="atlas-weather-line">Guest Readiness</span>
          <Link href="/" className="atlas-note-plus" aria-label="Back to Atlas home">+</Link>
        </header>

        <div className="atlas-task-page-body">
          <section className={`atlas-task-page-section ${styles.page}`}>
            <div className={styles.pageHead}>
              <Link href={returnTo}>← Work</Link>
              <span>{prettyDate(task.dueDate)}</span>
            </div>

            <article className={styles.taskCard}>
              <small>{task.initialAcceptance ? "Initial acceptance" : "Room walk"}</small>
              <h1>{task.title}</h1>
              <p>{task.zoneLabel}</p>
              <div className={styles.taskFacts}>
                <span>{task.rooms.length} rooms</span>
                <span>Every active room ready</span>
              </div>
            </article>

            <section className={styles.instructions}>
              <small>What to do</small>
              <h2>Walk every room and record its real condition.</h2>
              <p>Time opened this check; it does not claim a room is dirty. Look at the room first, then choose the result that is physically true.</p>
            </section>

            <div className={styles.progress} aria-live="polite">
              <strong>{answeredRooms} of {task.rooms.length} rooms recorded</strong>
              <span>{complete ? "Ready to submit" : "Complete each room below"}</span>
            </div>

            <section className={styles.roomList} aria-label="Venue rooms">
              {task.rooms.map((room, index) => {
                const draft = drafts[room.objectId];
                return (
                  <article className={styles.roomCard} key={room.objectId}>
                    <header className={styles.roomHead}>
                      <div><small>Room {index + 1}</small><h3>{room.label}</h3></div>
                      <span data-status={room.currentStatus}>{statusLabel(room.currentStatus)}</span>
                    </header>
                    {(room.lastObservedAt || room.currentNote) ? <p className={styles.roomHistory}>{prettyDate(room.lastObservedAt)}{room.currentNote ? ` · ${room.currentNote}` : ""}</p> : null}
                    <label className={styles.roomField}>
                      <span>Current condition</span>
                      <select value={draft.outcome} onChange={(event) => updateRoom(room.objectId, { outcome: event.target.value as Outcome | "" })}>
                        <option value="">Choose after looking</option>
                        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    {needsNote(draft.outcome) ? (
                      <label className={styles.roomField}>
                        <span>What does this room need?</span>
                        <textarea rows={2} value={draft.note} onChange={(event) => updateRoom(room.objectId, { note: event.target.value })} placeholder="Record the visible reset, blocker, or damage." />
                      </label>
                    ) : null}
                  </article>
                );
              })}
            </section>

            <section className={styles.form}>
              <label><span>Whole-round note (optional)</span><textarea rows={3} value={roundNote} onChange={(event) => setRoundNote(event.target.value)} placeholder="Anything that applies across the venue." /></label>
              <button type="button" className={styles.submit} disabled={saving || !complete} onClick={() => void submit()}>{saving ? "Recording…" : "Record room walk"}</button>
              {!complete ? <p className={styles.message}>Choose a result for all {task.rooms.length} rooms. Rooms needing work also need a short note.</p> : null}
              {message ? <p className={styles.message}>{message}</p> : null}
            </section>
          </section>
        </div>
      </section>
    </main>
  );
}
