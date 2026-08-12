"use client";

import { useEffect, useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type Dependency = {
  productionLotLabel?: string;
  plannedSowDate?: string | null;
  outstandingQuantity?: number | string;
  coveredByTrustedInventory?: boolean;
};

type SeedLot = {
  seedLotId?: string;
  lotLabel?: string;
  cropLabel?: string;
  variety?: string | null;
  storageLocation?: string | null;
  quantityUnit?: string;
  recordedReceiptQuantity?: number | string;
  observationStatus?: string;
  verifiedOnHandQuantity?: number | string | null;
  projectedOnHandQuantity?: number | string | null;
  outstandingReservedQuantity?: number | string;
  lastVerifiedAt?: string | null;
  stateNote?: string | null;
  dependencies?: Dependency[];
};

type Dashboard = {
  ok?: boolean;
  error?: string;
  canManage?: boolean;
  items?: SeedLot[];
};

type SeedInventoryDependency = {
  label: string;
  plannedSowDate: string | null;
  outstandingQuantity: number;
  covered: boolean;
};

type SeedInventoryFocus = {
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

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

function returnDestination(fallback: string) {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export default function SeedInventoryTaskLoader(props: Props) {
  const { task } = props;
  const [focus, setFocus] = useState<SeedInventoryFocus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [observedQuantity, setObservedQuantity] = useState("");
  const [quantityAdded, setQuantityAdded] = useState("");
  const [source, setSource] = useState("");
  const [problemKind, setProblemKind] = useState<ProblemKind | "">("");
  const [nextCheckDate, setNextCheckDate] = useState(tomorrowIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const seedLotId = text(task.metadata?.seed_lot_id);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(null);
        const response = await fetch("/api/atlas/seed-inventory", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = await response.json() as Dashboard;
        if (!response.ok || !data.ok) throw new Error(data.error || "Seed inventory failed.");
        const item = (data.items ?? []).find((candidate) => candidate.seedLotId === seedLotId);
        if (!item) throw new Error("This seed lot is not available in the active farm inventory.");

        const recordedReceiptQuantity = number(item.recordedReceiptQuantity ?? task.metadata?.recorded_receipt_quantity);
        const projectedOnHand = item.projectedOnHandQuantity === null || item.projectedOnHandQuantity === undefined
          ? null
          : number(item.projectedOnHandQuantity);
        const verifiedOnHand = item.verifiedOnHandQuantity === null || item.verifiedOnHandQuantity === undefined
          ? null
          : number(item.verifiedOnHandQuantity);
        const nextFocus: SeedInventoryFocus = {
          lotLabel: text(item.lotLabel) || text(task.metadata?.seed_lot_label) || task.title,
          cropLabel: text(item.cropLabel) || text(task.metadata?.crop_label) || "Seed",
          variety: text(item.variety) || text(task.metadata?.variety) || null,
          storageLocation: text(item.storageLocation) || text(task.metadata?.storage_location) || null,
          quantityUnit: text(item.quantityUnit) || text(task.metadata?.quantity_unit) || "units",
          recordedReceiptQuantity,
          expectedQuantity: projectedOnHand ?? recordedReceiptQuantity,
          verifiedOnHandQuantity: verifiedOnHand,
          lastVerifiedAt: text(item.lastVerifiedAt) || null,
          outstandingReservedQuantity: number(item.outstandingReservedQuantity),
          observationStatus: text(item.observationStatus) || "verification_required",
          currentNote: text(item.stateNote) || null,
          dependencies: (item.dependencies ?? []).map((dependency) => ({
            label: text(dependency.productionLotLabel) || "Production lot",
            plannedSowDate: text(dependency.plannedSowDate) || null,
            outstandingQuantity: number(dependency.outstandingQuantity),
            covered: Boolean(dependency.coveredByTrustedInventory),
          })),
          canRetire: Boolean(data.canManage),
        };
        if (!cancelled) {
          setFocus(nextFocus);
          setObservedQuantity(String(nextFocus.expectedQuantity));
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Seed inventory failed.");
      }
    }
    if (seedLotId) void load();
    else setError("This recount is missing its canonical seed-lot link.");
    return () => { cancelled = true; };
  }, [seedLotId, task.metadata, task.title]);

  const options = useMemo(
    () => focus?.canRetire
      ? [...choices, { value: "retired" as Outcome, title: "Retire this seed lot", detail: "Owner-only governed closure", tone: "problem" }]
      : choices,
    [focus?.canRetire],
  );
  const needsObserved = outcome === "count_corrected" || outcome === "restocked";
  const needsAdded = outcome === "restocked";
  const needsRecheck = outcome === "unable_to_verify";
  const needsProblem = outcome === "problem_found";
  const needsNote = outcome === "unable_to_verify" || outcome === "problem_found" || outcome === "retired";
  const numericObserved = Number(observedQuantity);
  const numericAdded = Number(quantityAdded);
  const complete = Boolean(focus && outcome)
    && (!needsObserved || (Number.isFinite(numericObserved) && numericObserved > 0))
    && (!needsAdded || (Number.isFinite(numericAdded) && numericAdded > 0 && Boolean(source.trim())))
    && (!needsRecheck || Boolean(nextCheckDate))
    && (!needsProblem || Boolean(problemKind))
    && (!needsNote || Boolean(note.trim()));

  function choose(value: Outcome) {
    setOutcome(value);
    setMessage(null);
    if (value === "count_confirmed" && focus) setObservedQuantity(String(focus.expectedQuantity));
    if (value === "depleted") setObservedQuantity("0");
  }

  async function submit(context: AssignedTaskResultInstrumentContext) {
    if (!focus || !outcome || !complete || saving || context.busy) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/seed-inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-atlas-intent": "seed-inventory-result-v1",
        },
        body: JSON.stringify({
          action: "result",
          taskId: task.task_id,
          outcome,
          observedQuantity: outcome === "count_confirmed" ? focus.expectedQuantity : outcome === "depleted" ? 0 : needsObserved ? numericObserved : null,
          quantityAdded: needsAdded ? numericAdded : null,
          source: needsAdded ? source.trim() : null,
          problemKind: needsProblem ? problemKind : null,
          nextCheckDate: needsRecheck ? nextCheckDate : null,
          note: note.trim() || null,
          idempotencyKey: `seed-inventory:${task.task_id}:${outcome}:${Date.now()}`,
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
      window.setTimeout(() => window.location.assign(returnDestination(context.returnHref || "/inventory/seeds")), 900);
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : "Seed inventory result failed.");
    } finally {
      setSaving(false);
    }
  }

  function methodInstrument({ busy }: AssignedTaskInstrumentContext) {
    if (error) return <section className="atlas-seed-recount atlas-seed-recount--error" data-atlas-method-instrument="seed-inventory">{error}</section>;
    if (!focus) return <section className="atlas-seed-recount" data-atlas-method-instrument="seed-inventory">Loading physical seed count…</section>;
    return (
      <section className="atlas-seed-recount" aria-label="Seed inventory facts" data-atlas-method-instrument="seed-inventory">
        <div className="atlas-seed-recount__identity">
          <small>Physical recount</small>
          <strong>{focus.lotLabel}</strong>
          <span>{focus.storageLocation || `${focus.cropLabel}${focus.variety ? ` · ${focus.variety}` : ""}`}</span>
        </div>
        <div className="atlas-seed-recount__facts">
          <div><small>Atlas expects</small><strong>{quantityLabel(focus.expectedQuantity, focus.quantityUnit)}</strong></div>
          <div><small>Recorded receipt</small><strong>{quantityLabel(focus.recordedReceiptQuantity, focus.quantityUnit)}</strong></div>
          <div><small>Last verified</small><strong>{prettyDate(focus.lastVerifiedAt)}</strong></div>
          <div><small>Committed</small><strong>{quantityLabel(focus.outstandingReservedQuantity, focus.quantityUnit)}</strong></div>
        </div>
        <div className="atlas-seed-recount__prompt">
          <small>What is physically true?</small>
          <strong>Find the seed lot and count what is actually on hand.</strong>
          <p>Time does not claim seed was received, consumed, lost, or damaged. A physical result changes inventory truth.</p>
        </div>
        {focus.dependencies.length ? (
          <div className="atlas-seed-recount__dependencies">
            <small>Committed production</small>
            {focus.dependencies.map((dependency) => (
              <p key={`${dependency.label}-${dependency.plannedSowDate}`}>
                {dependency.label} · {quantityLabel(dependency.outstandingQuantity, focus.quantityUnit)} · sow {prettyDate(dependency.plannedSowDate)}
              </p>
            ))}
          </div>
        ) : null}
        {busy ? <p className="atlas-seed-recount__status">Saving task state…</p> : null}
        <style>{seedInventoryStyles}</style>
      </section>
    );
  }

  function resultInstrument(context: AssignedTaskResultInstrumentContext) {
    if (error || !focus) {
      return <section data-atlas-result-instrument="seed-inventory"><p className="atlas-seed-recount__status">{error || "Loading physical count…"}</p></section>;
    }
    const disabled = saving || context.busy;
    return (
      <section className="atlas-seed-result" data-atlas-result-instrument="seed-inventory">
        <strong className="atlas-seed-result__heading">Record what you found</strong>
        <div className="atlas-seed-result__choices">
          {options.map((choice) => (
            <button key={choice.value} type="button" data-active={outcome === choice.value} data-tone={choice.tone} disabled={disabled} onClick={() => choose(choice.value)}>
              <strong>{choice.title}</strong><span>{choice.detail}</span>
            </button>
          ))}
        </div>
        {outcome ? (
          <div className="atlas-seed-result__form">
            {outcome === "count_confirmed" ? <p>Confirming {quantityLabel(focus.expectedQuantity, focus.quantityUnit)}.</p> : null}
            {needsObserved ? <label><span>Physical total now on hand ({focus.quantityUnit})</span><input inputMode="decimal" value={observedQuantity} disabled={disabled} onChange={(event) => setObservedQuantity(event.target.value)} /></label> : null}
            {needsAdded ? <label><span>Quantity added ({focus.quantityUnit})</span><input inputMode="decimal" value={quantityAdded} disabled={disabled} onChange={(event) => setQuantityAdded(event.target.value)} /></label> : null}
            {needsAdded ? <label><span>Source</span><input value={source} disabled={disabled} onChange={(event) => setSource(event.target.value)} placeholder="Supplier, saved seed, transfer…" /></label> : null}
            {needsRecheck ? <label><span>Count again</span><input type="date" min={tomorrowIso()} value={nextCheckDate} disabled={disabled} onChange={(event) => setNextCheckDate(event.target.value)} /></label> : null}
            {needsProblem ? <label><span>Problem</span><select value={problemKind} disabled={disabled} onChange={(event) => setProblemKind(event.target.value as ProblemKind | "")}><option value="">Choose after looking</option>{problemOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> : null}
            <label><span>{needsNote ? "Required note" : "Note (optional)"}</span><textarea rows={3} value={note} disabled={disabled} onChange={(event) => setNote(event.target.value)} placeholder="Record only what was observed or decided." /></label>
            <button type="button" className="atlas-seed-result__submit" disabled={disabled || !complete} onClick={() => void submit(context)}>{saving ? "Recording…" : "Record seed inventory result"}</button>
            {!complete ? <p>Complete the required physical-result details before recording.</p> : null}
            {focus.currentNote ? <p>Previous note: {focus.currentNote}</p> : null}
            {message ? <p aria-live="polite">{message}</p> : null}
          </div>
        ) : message ? <p className="atlas-seed-result__message" aria-live="polite">{message}</p> : null}
        <style>{seedInventoryStyles}</style>
      </section>
    );
  }

  return (
    <AssignedTaskExecutionShell
      {...props}
      childTasks={[]}
      methodInstrument={methodInstrument}
      resultInstrument={resultInstrument}
    />
  );
}

const seedInventoryStyles = `
  .atlas-seed-recount { margin:0 28px 22px; padding:18px; border:1px solid rgba(68,65,89,.14); border-radius:20px; background:#fffdf8; color:#303145; }
  .atlas-seed-recount--error { color:#7a4039; background:#fff7f3; }
  .atlas-seed-recount__identity small,.atlas-seed-recount__prompt small,.atlas-seed-recount__dependencies small { display:block; color:#7772ad; font-size:.68rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
  .atlas-seed-recount__identity strong { display:block; margin-top:4px; font-size:1.28rem; line-height:1.08; }
  .atlas-seed-recount__identity span { display:block; margin-top:4px; color:#6b6b77; font-size:.82rem; }
  .atlas-seed-recount__facts { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:15px; }
  .atlas-seed-recount__facts div { padding:10px; border-radius:12px; background:#f7f4ec; }
  .atlas-seed-recount__facts small { display:block; color:#7a7885; font-size:.65rem; font-weight:800; text-transform:uppercase; }
  .atlas-seed-recount__facts strong { display:block; margin-top:3px; font-size:.84rem; }
  .atlas-seed-recount__prompt,.atlas-seed-recount__dependencies { margin-top:16px; padding-top:14px; border-top:1px solid rgba(68,65,89,.1); }
  .atlas-seed-recount__prompt strong { display:block; margin-top:5px; font-size:1rem; }
  .atlas-seed-recount__prompt p,.atlas-seed-recount__dependencies p,.atlas-seed-recount__status { margin:6px 0 0; color:#6c6b76; font-size:.78rem; line-height:1.4; }
  .atlas-seed-result { display:grid; gap:12px; }
  .atlas-seed-result__heading { display:block; font-size:.82rem; letter-spacing:.04em; }
  .atlas-seed-result__choices { display:grid; gap:8px; }
  .atlas-seed-result__choices button { width:100%; padding:11px 12px; border:1px solid rgba(68,65,89,.14); border-radius:13px; background:#fffdf8; color:#333344; text-align:left; }
  .atlas-seed-result__choices button[data-active="true"] { border-color:#8d88b6; background:#f0eef8; }
  .atlas-seed-result__choices button[data-tone="problem"][data-active="true"] { border-color:#a27c71; background:#fff4ef; }
  .atlas-seed-result__choices strong,.atlas-seed-result__choices span { display:block; }
  .atlas-seed-result__choices span { margin-top:2px; color:#777681; font-size:.72rem; }
  .atlas-seed-result__form { display:grid; gap:10px; padding-top:4px; }
  .atlas-seed-result__form label { display:grid; gap:5px; color:#555461; font-size:.75rem; font-weight:800; }
  .atlas-seed-result__form input,.atlas-seed-result__form select,.atlas-seed-result__form textarea { width:100%; padding:10px 11px; border:1px solid rgba(68,65,89,.17); border-radius:11px; background:#fff; color:#303145; font:inherit; }
  .atlas-seed-result__submit { min-height:44px; border:0; border-radius:12px; background:#dce8ba; color:#4d5935; font-weight:900; }
  .atlas-seed-result__form p,.atlas-seed-result__message { margin:0; color:#70574f; font-size:.72rem; line-height:1.4; }
  .atlas-seed-result button:disabled,.atlas-seed-result input:disabled,.atlas-seed-result select:disabled,.atlas-seed-result textarea:disabled { opacity:.55; }
  @media (max-width:560px) { .atlas-seed-recount { margin-left:18px; margin-right:18px; } }
`;
