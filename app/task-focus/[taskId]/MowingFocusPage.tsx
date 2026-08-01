"use client";

import Link from "next/link";
import { useState } from "react";

import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import styles from "./HarvestFocus.module.css";

export type MowingFocusTask = {
  id: string;
  title: string;
  dueDate: string | null;
  routeLabel: string;
  zoneLabel: string;
  equipmentGroup: string | null;
  targetCutHeightInches: number | null;
  rhythmState: string;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  areaStatus: string;
  lastMowedAt: string | null;
  lastObservedAt: string | null;
  nextCheckDate: string | null;
  currentNote: string | null;
  canCloseRoute: boolean;
  returnTo?: string | null;
};

type Outcome = "mowed_full" | "mowed_partial" | "acceptable_no_cut" | "too_wet" | "equipment_or_area_problem" | "closed_not_mowable";

const choices: Array<{ value: Outcome; title: string; detail: string; tone?: string }> = [
  { value: "mowed_full", title: "Mowed fully", detail: "The whole route is cut", tone: "ready" },
  { value: "mowed_partial", title: "Mowed partly", detail: "Record what remains" },
  { value: "acceptable_no_cut", title: "Still acceptable", detail: "Observed; no cut needed" },
  { value: "too_wet", title: "Too wet to mow", detail: "Keep the route and choose a return date" },
  { value: "equipment_or_area_problem", title: "Equipment or area problem", detail: "Return the route for Owner attention", tone: "problem" },
];

function prettyDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function tomorrowIso(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function stateLabel(value: string) {
  if (value === "fallen_out_of_rhythm") return "Fallen out of rhythm";
  if (value === "coming_due") return "Coming due";
  if (value === "recovering") return "Recovering";
  if (value === "resting") return "In rhythm";
  if (value === "paused") return "Paused";
  if (value === "due") return "Due";
  return "Waiting for evidence";
}

export default function MowingFocusPage({ task }: { task: MowingFocusTask }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [completionPercent, setCompletionPercent] = useState("50");
  const [recheckDate, setRecheckDate] = useState(tomorrowIso(1));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || "/collections/mowing";
  const options = task.canCloseRoute
    ? [...choices, { value: "closed_not_mowable" as Outcome, title: "Close this route", detail: "Owner or manager decision only", tone: "problem" }]
    : choices;
  const needsPercent = outcome === "mowed_partial";
  const needsRecheck = outcome === "acceptable_no_cut" || outcome === "too_wet";
  const needsNote = outcome === "mowed_partial" || outcome === "equipment_or_area_problem";
  const validPercent = Number.isInteger(Number(completionPercent)) && Number(completionPercent) >= 1 && Number(completionPercent) <= 99;
  const complete = Boolean(outcome)
    && (!needsPercent || validPercent)
    && (!needsRecheck || Boolean(recheckDate))
    && (!needsNote || Boolean(note.trim()));

  async function submit() {
    if (!outcome || !complete) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/mowing", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          outcome,
          completionPercent: needsPercent ? Number(completionPercent) : outcome === "mowed_full" ? 100 : null,
          recheckDate: needsRecheck ? recheckDate : null,
          note: note.trim() || null,
          idempotencyKey: `mowing:${task.id}:${outcome}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; outcome?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Mowing result failed.");

      if (outcome === "mowed_full") setMessage("Full mow recorded. This route is back in rhythm.");
      else if (outcome === "mowed_partial") setMessage("Partial mow recorded. The same route stays open with what remains.");
      else if (outcome === "acceptable_no_cut") setMessage(`Observed as acceptable. Atlas will return the route ${prettyDate(recheckDate)}.`);
      else if (outcome === "too_wet") setMessage(`Wet-ground delay recorded. The same route returns ${prettyDate(recheckDate)}.`);
      else if (outcome === "closed_not_mowable") setMessage("Route closed and its mowing Clock paused.");
      else setMessage("Problem recorded and returned for Owner attention.");
      window.setTimeout(() => window.location.assign(returnTo), 1100);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mowing result failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Mowing</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close mowing result">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div className={styles.kicker}><span>{stateLabel(task.rhythmState)}</span><span>{prettyDate(task.dueDate)}</span></div>
            <h1>{task.routeLabel}</h1>
            <p>{task.zoneLabel}</p>
          </section>

          <MaintenanceDirectiveStrip taskId={task.id} />

          <section className={styles.facts} aria-label="Mowing route facts">
            <div className={`${styles.fact} ${styles.factWide}`}><small>What time means</small><strong>This route has returned for attention. Time does not claim the grass is long, dry, or safe to mow.</strong></div>
            <div className={styles.fact}><small>Equipment</small><strong>{task.equipmentGroup || "Observe before choosing"}</strong></div>
            <div className={styles.fact}><small>Target height</small><strong>{task.targetCutHeightInches ? `${task.targetCutHeightInches} in` : "Use route standard"}</strong></div>
            <div className={styles.fact}><small>Last full mow</small><strong>{prettyDate(task.lastMowedAt)}</strong></div>
            <div className={styles.fact}><small>Last condition</small><strong>{task.areaStatus.replaceAll("_", " ")}</strong></div>
          </section>

          <section className={styles.prompt}>
            <small>What is physically true?</small>
            <h2>Look at the route, then record the real result.</h2>
            <p>A full mow renews the cadence. A partial result keeps this card open. “Still acceptable” records an observation without pretending a mow happened.</p>
          </section>

          <div className={styles.choices}>
            {options.map((choice) => (
              <button key={choice.value} type="button" className={styles.choice} data-active={outcome === choice.value} data-tone={choice.tone} onClick={() => setOutcome(choice.value)}>
                <strong>{choice.title}</strong><span>{choice.detail}</span>
              </button>
            ))}
          </div>

          {outcome ? (
            <section className={styles.form}>
              {needsPercent ? <label><span>Percent of route finished</span><input inputMode="numeric" min="1" max="99" value={completionPercent} onChange={(event) => setCompletionPercent(event.target.value)} /></label> : null}
              {needsRecheck ? <label><span>Check again</span><input type="date" min={tomorrowIso(1)} value={recheckDate} onChange={(event) => setRecheckDate(event.target.value)} /></label> : null}
              <label><span>{needsNote ? "What remains or what is wrong?" : "Note (optional)"}</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={outcome === "too_wet" ? "What did the ground look like?" : "Anything the next person should know."} /></label>
              <button type="button" className={styles.submit} disabled={saving || !complete} onClick={() => void submit()}>{saving ? "Recording…" : "Record mowing result"}</button>
              {!complete ? <p className={styles.message}>Complete the required result details before recording.</p> : null}
              {task.currentNote ? <p className={styles.message}>Previous note: {task.currentNote}</p> : null}
              {message ? <p className={styles.message}>{message}</p> : null}
            </section>
          ) : null}
        </article>
      </div>
    </main>
  );
}
