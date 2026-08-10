"use client";

import { useState } from "react";

import type { TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";
import styles from "./HarvestFocus.module.css";

export type SeedInventoryDependency = {
  label: string;
  plannedSowDate: string | null;
  outstandingQuantity: number;
  covered: boolean;
};

export type SeedInventoryFocusTask = {
  id: string;
  title: string;
  dueDate: string | null;
  lotLabel: string;
  cropLabel: string;
  variety: string | null;
  storageLocation: string | null;
  quantityUnit: string;
  recordedReceiptQuantity: number;
  expectedQuantity: number;
  verifiedOnHandQuantity: number | null;
  lastVerifiedAt: string | null;
  outstandingReservedQuantity: number;
  observationStatus: string;
  currentNote: string | null;
  dependencies: SeedInventoryDependency[];
  canRetire: boolean;
  returnTo?: string | null;
};

type Outcome = "count_confirmed" | "count_corrected" | "restocked" | "depleted" | "unable_to_verify" | "problem_found" | "retired";
type ProblemKind = "damaged" | "mislabeled" | "missing" | "contaminated" | "storage_problem" | "other";

const choices: Array<{ value: Outcome; title: string; detail: string; tone?: string }> = [
  { value: "count_confirmed", title: "Count confirmed", detail: "Physical count matches Atlas", tone: "ready" },
  { value: "count_corrected", title: "Count corrected", detail: "Physical quantity differs" },
  { value: "restocked", title: "Received or restocked", detail: "Record the addition and new total" },
  { value: "depleted", title: "Depleted", detail: "Physically verified at zero" },
  { value: "unable_to_verify", title: "Unable to verify", detail: "Keep this count unresolved and return later" },
  { value: "problem_found", title: "Problem found", detail: "Damage, label, storage, or missing seed", tone: "problem" },
];

const problemOptions: Array<{ value: ProblemKind; label: string }> = [
  { value: "damaged", label: "Damaged" },
  { value: "mislabeled", label: "Mislabeled" },
  { value: "missing", label: "Missing" },
  { value: "contaminated", label: "Contaminated" },
  { value: "storage_problem", label: "Storage problem" },
  { value: "other", label: "Other" },
];

function prettyDate(value: string | null) {
  if (!value) return "Never physically counted";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function quantityLabel(value: number | null, unit: string) {
  return value === null ? "Unknown" : `${value.toLocaleString()} ${unit}`;
}

export function SeedInventoryContextInstrument({ task }: { task: SeedInventoryFocusTask }) {
  return (
    <div data-atlas-method-instrument="seed-inventory">
      <section className={styles.hero}>
        <div className={styles.kicker}><span>Physical recount</span><span>{prettyDate(task.dueDate)}</span></div>
        <h1>{task.lotLabel}</h1>
        <p>{task.storageLocation || `${task.cropLabel}${task.variety ? ` · ${task.variety}` : ""}`}</p>
      </section>

      <section className={styles.facts} aria-label="Seed inventory facts">
        <div className={`${styles.fact} ${styles.factWide}`}><small>What time means</small><strong>The last count is missing or stale. Time does not claim any seed was received, consumed, lost, or damaged.</strong></div>
        <div className={styles.fact}><small>Atlas expects</small><strong>{quantityLabel(task.expectedQuantity, task.quantityUnit)}</strong></div>
        <div className={styles.fact}><small>Recorded receipt</small><strong>{quantityLabel(task.recordedReceiptQuantity, task.quantityUnit)}</strong></div>
        <div className={styles.fact}><small>Last verified</small><strong>{prettyDate(task.lastVerifiedAt)}</strong></div>
        <div className={styles.fact}><small>Committed</small><strong>{quantityLabel(task.outstandingReservedQuantity, task.quantityUnit)}</strong></div>
      </section>

      <section className={styles.prompt}>
        <small>What is physically true?</small>
        <h2>Find the seed lot and count what is actually on hand.</h2>
        <p>Confirming or correcting establishes a dated stock observation. Reservations remain crop commitments; they are not treated as physical consumption.</p>
      </section>

      {task.dependencies.length ? (
        <section className={styles.form}>
          <strong>Committed production</strong>
          {task.dependencies.map((dependency) => (
            <p className={styles.message} key={`${dependency.label}-${dependency.plannedSowDate}`}>
              {dependency.label} · {quantityLabel(dependency.outstandingQuantity, task.quantityUnit)} · sow {prettyDate(dependency.plannedSowDate)}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function SeedInventoryResultInstrument({
  task,
  assembly,
  busy,
  returnHref,
}: {
  task: SeedInventoryFocusTask;
  assembly: TaskMoveAssembly | null;
  busy: boolean;
  returnHref: string;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [observedQuantity, setObservedQuantity] = useState(String(task.expectedQuantity));
  const [quantityAdded, setQuantityAdded] = useState("");
  const [source, setSource] = useState("");
  const [problemKind, setProblemKind] = useState<ProblemKind | "">("");
  const [nextCheckDate, setNextCheckDate] = useState(tomorrowIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || returnHref;
  const options = task.canRetire
    ? [...choices, { value: "retired" as Outcome, title: "Retire this seed lot", detail: "Owner-only governed closure", tone: "problem" }]
    : choices;

  const needsObserved = outcome === "count_corrected" || outcome === "restocked";
  const needsAdded = outcome === "restocked";
  const needsRecheck = outcome === "unable_to_verify";
  const needsProblem = outcome === "problem_found";
  const needsNote = outcome === "unable_to_verify" || outcome === "problem_found" || outcome === "retired";
  const numericObserved = Number(observedQuantity);
  const numericAdded = Number(quantityAdded);
  const complete = Boolean(outcome)
    && (!needsObserved || (Number.isFinite(numericObserved) && numericObserved > 0))
    && (!needsAdded || (Number.isFinite(numericAdded) && numericAdded > 0 && Boolean(source.trim())))
    && (!needsRecheck || Boolean(nextCheckDate))
    && (!needsProblem || Boolean(problemKind))
    && (!needsNote || Boolean(note.trim()));
  const moveBlocked = !assembly
    || assembly.readiness.status === "blocked"
    || assembly.spine.connection === "stops_at_move";

  function choose(value: Outcome) {
    setOutcome(value);
    if (value === "count_confirmed") setObservedQuantity(String(task.expectedQuantity));
    if (value === "depleted") setObservedQuantity("0");
  }

  async function submit() {
    if (!outcome || !complete || saving || busy || moveBlocked) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/seed-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "result",
          taskId: task.id,
          outcome,
          observedQuantity: outcome === "count_confirmed" ? task.expectedQuantity : outcome === "depleted" ? 0 : needsObserved ? numericObserved : null,
          quantityAdded: needsAdded ? numericAdded : null,
          source: needsAdded ? source.trim() : null,
          problemKind: needsProblem ? problemKind : null,
          nextCheckDate: needsRecheck ? nextCheckDate : null,
          note: note.trim() || null,
          idempotencyKey: `seed-inventory:${task.id}:${outcome}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Seed inventory result failed.");

      if (outcome === "count_confirmed") setMessage("Physical count confirmed. This inventory is trusted again.");
      else if (outcome === "count_corrected") setMessage("Corrected physical quantity recorded without rewriting the receipt history.");
      else if (outcome === "restocked") setMessage("Restock and new physical total recorded.");
      else if (outcome === "depleted") setMessage("Inventory verified at zero.");
      else if (outcome === "unable_to_verify") setMessage(`Count remains untrusted. This same card returns ${prettyDate(nextCheckDate)}.`);
      else if (outcome === "problem_found") setMessage("Problem preserved and returned for Owner attention.");
      else setMessage("Seed lot retired and its freshness Clock paused.");
      window.setTimeout(() => window.location.assign(returnTo), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Seed inventory result failed.");
      setSaving(false);
    }
  }

  return (
    <section data-atlas-result-instrument="seed-inventory">
      <div className={styles.choices}>
        {options.map((choice) => (
          <button key={choice.value} type="button" className={styles.choice} data-active={outcome === choice.value} data-tone={choice.tone} disabled={saving || busy} onClick={() => choose(choice.value)}>
            <strong>{choice.title}</strong><span>{choice.detail}</span>
          </button>
        ))}
      </div>

      {outcome ? (
        <section className={styles.form}>
          {outcome === "count_confirmed" ? <p className={styles.message}>Confirming {quantityLabel(task.expectedQuantity, task.quantityUnit)}.</p> : null}
          {needsObserved ? <label><span>Physical total now on hand ({task.quantityUnit})</span><input disabled={saving || busy} inputMode="decimal" value={observedQuantity} onChange={(event) => setObservedQuantity(event.target.value)} /></label> : null}
          {needsAdded ? <label><span>Quantity added ({task.quantityUnit})</span><input disabled={saving || busy} inputMode="decimal" value={quantityAdded} onChange={(event) => setQuantityAdded(event.target.value)} /></label> : null}
          {needsAdded ? <label><span>Source</span><input disabled={saving || busy} value={source} onChange={(event) => setSource(event.target.value)} placeholder="Supplier, saved seed, transfer…" /></label> : null}
          {needsRecheck ? <label><span>Count again</span><input disabled={saving || busy} type="date" min={tomorrowIso()} value={nextCheckDate} onChange={(event) => setNextCheckDate(event.target.value)} /></label> : null}
          {needsProblem ? <label><span>Problem</span><select disabled={saving || busy} value={problemKind} onChange={(event) => setProblemKind(event.target.value as ProblemKind | "")}><option value="">Choose after looking</option>{problemOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> : null}
          <label><span>{needsNote ? "Required note" : "Note (optional)"}</span><textarea disabled={saving || busy} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record only what was observed or decided." /></label>
          <button type="button" className={styles.submit} disabled={saving || busy || !complete || moveBlocked} onClick={() => void submit()}>{saving ? "Recording…" : "Record seed inventory result"}</button>
          {!complete ? <p className={styles.message}>Complete the required physical-result details before recording.</p> : null}
          {moveBlocked ? <p className={styles.message}>Atlas is still resolving what must be true before this recount can be recorded.</p> : null}
          {task.currentNote ? <p className={styles.message}>Previous note: {task.currentNote}</p> : null}
          {message ? <p className={styles.message}>{message}</p> : null}
        </section>
      ) : null}
    </section>
  );
}

export default SeedInventoryContextInstrument;
