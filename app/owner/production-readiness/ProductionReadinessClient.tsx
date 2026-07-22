"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  BedCandidate,
  CapacityProductionLot,
  CapacityQuestion,
  OwnerProductionCapacitySnapshot,
} from "@/lib/atlas-data/production-capacity";

type ApiResponse = {
  ok?: boolean;
  snapshot?: OwnerProductionCapacitySnapshot;
  error?: string | { message?: string };
};

const placementKey = "spring_snapdragon_bed_assignments";

const answerConfig: Record<string, { label: string; step?: string; min?: number; max?: number }> = {
  rocket_s1_seed_quantity: { label: "seeds", step: "1", min: 1 },
  madame_s2_seed_quantity: { label: "seeds", step: "1", min: 1 },
  snapdragon_seeds_per_three_quarter_block: { label: "seeds per block", step: "0.1", min: 0.1 },
  three_quarter_blocks_per_cafeteria_tray: { label: "blocks per tray", step: "1", min: 1 },
  cafeteria_trays_per_rack_shelf: { label: "trays per shelf", step: "0.1", min: 1 },
  functional_grow_light_sets: { label: "working light sets", step: "1", min: 0 },
  shelf_positions_per_grow_light_set: { label: "shelves per light set", step: "0.1", min: 0.1 },
  snapdragon_lit_shelf_occupancy_days: { label: "days", step: "1", min: 1, max: 365 },
  snapdragon_planning_viability_percent: { label: "% viable seedlings", step: "0.1", min: 1, max: 100 },
  snapdragon_rows_per_three_foot_bed: { label: "rows per bed", step: "1", min: 1 },
  snapdragon_in_row_spacing_inches: { label: "inches", step: "0.25", min: 0.25 },
  snapdragon_bed_preparation_lead_days: { label: "days before transplant", step: "1", min: 1 },
};

function prettyDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function apiMessage(payload: ApiResponse, fallback: string) {
  if (typeof payload.error === "string") return payload.error;
  return payload.error?.message || fallback;
}

function requirementFor(lot: CapacityProductionLot, kind: string) {
  return lot.requirements.find((requirement) => requirement.capacityKind === kind) ?? null;
}

function QuestionCard({
  question,
  saving,
  onSave,
}: {
  question: CapacityQuestion;
  saving: boolean;
  onSave: (form: HTMLFormElement, question: CapacityQuestion) => Promise<void>;
}) {
  const config = answerConfig[question.stableKey] ?? { label: "value" };
  return (
    <article className={`capacity-question-card ${question.status === "answered" ? "answered" : ""}`}>
      <header>
        <span>{readable(question.kind)}</span>
        <strong>{question.status === "answered" ? "Recorded" : "Needed"}</strong>
      </header>
      <h3>{question.question}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(event.currentTarget, question);
        }}
      >
        <label>
          <span>{config.label}</span>
          <input
            name="answerValue"
            type="number"
            step={config.step ?? "any"}
            min={config.min}
            max={config.max}
            required
            defaultValue={question.answerValue ?? ""}
          />
        </label>
        <label>
          <span>How certain is this?</span>
          <select
            name="confidence"
            defaultValue={String(question.metadata?.confidence || "measured")}
          >
            <option value="measured">Measured in the real setup</option>
            <option value="confirmed">Confirmed count or decision</option>
            <option value="estimated">Planning estimate</option>
          </select>
        </label>
        <label className="capacity-wide-field">
          <span>Note</span>
          <input
            name="answerText"
            placeholder="Where this number came from"
            defaultValue={question.answerText ?? ""}
          />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : question.status === "answered" ? "Update answer" : "Record answer"}
        </button>
      </form>
    </article>
  );
}

function BedOption({ bed }: { bed: BedCandidate }) {
  return (
    <option value={bed.id}>
      {bed.zoneLabel} · {bed.label} · {bed.lengthFt} ft
    </option>
  );
}

function LotCard({
  lot,
  beds,
  savingKey,
  mutate,
}: {
  lot: CapacityProductionLot;
  beds: BedCandidate[];
  savingKey: string | null;
  mutate: (body: Record<string, unknown>, key: string) => Promise<void>;
}) {
  const bedRequirement = requirementFor(lot, "bed_feet");
  const assignedFeet = lot.bedAssignments.reduce(
    (sum, assignment) => sum + Number(assignment.quantityAssigned || 0),
    0,
  );
  const remainingFeet = Math.max(0, Number(bedRequirement?.quantityNeeded || 0) - assignedFeet);
  const canAssign = Boolean(
    bedRequirement?.quantityNeeded &&
      ["calculated", "confirmed"].includes(bedRequirement.status) &&
      remainingFeet > 0,
  );

  return (
    <article className="capacity-lot-card">
      <header>
        <div>
          <span>Succession {lot.successionNumber}</span>
          <h3>{lot.label}</h3>
        </div>
        <strong>{lot.plannedSeedQuantity ?? "?"} seeds</strong>
      </header>

      <div className="capacity-lot-dates">
        <span>Sow <b>{prettyDate(lot.plannedSowDate)}</b></span>
        <span>Transplant <b>{prettyDate(lot.transplantStart)}</b></span>
      </div>

      <div className="capacity-requirement-list">
        {lot.requirements.map((requirement) => (
          <div key={requirement.id} className={requirement.status === "blocked" ? "blocked" : "ready"}>
            <span>{readable(requirement.capacityKind)}</span>
            <strong>
              {requirement.quantityNeeded ?? "?"} {requirement.quantityNeeded === null ? "" : readable(requirement.unit)}
            </strong>
            <small>
              {requirement.reservations.length
                ? `${requirement.reservations.reduce((sum, row) => sum + Number(row.quantityReserved), 0)} reserved`
                : requirement.status === "blocked"
                  ? "waiting on facts"
                  : "calculated"}
            </small>
          </div>
        ))}
      </div>

      <section className="capacity-bed-section">
        <div className="capacity-bed-heading">
          <div>
            <span>Bed plan</span>
            <strong>
              {assignedFeet} of {bedRequirement?.quantityNeeded ?? "?"} bed-ft assigned
            </strong>
          </div>
          {bedRequirement?.preparationDueDate ? (
            <em>Prepare by {prettyDate(bedRequirement.preparationDueDate)}</em>
          ) : null}
        </div>

        {lot.bedAssignments.map((assignment) => (
          <div className="capacity-assignment-row" key={assignment.id}>
            <div>
              <strong>{assignment.zoneLabel} · {assignment.objectLabel}</strong>
              <span>{assignment.quantityAssigned} bed-ft · transplant {prettyDate(assignment.plannedTransplantDate)}</span>
              {assignment.preparationTaskId ? (
                <Link href={`/owner/tasks/${encodeURIComponent(assignment.preparationTaskId)}`}>
                  Open preparation task
                </Link>
              ) : null}
            </div>
            <button
              type="button"
              disabled={savingKey === `release:${assignment.id}`}
              onClick={() => void mutate(
                { action: "release_bed", assignmentId: assignment.id },
                `release:${assignment.id}`,
              )}
            >
              Release
            </button>
          </div>
        ))}

        {canAssign ? (
          <form
            className="capacity-bed-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void mutate(
                {
                  action: "assign_bed",
                  productionLotId: lot.id,
                  objectId: String(form.get("objectId") || ""),
                  quantityAssigned: Number(form.get("quantityAssigned")),
                },
                `assign:${lot.id}`,
              );
            }}
          >
            <label>
              <span>Assign bed</span>
              <select name="objectId" required defaultValue="">
                <option value="" disabled>Select a measured bed</option>
                {beds.map((bed) => <BedOption key={bed.id} bed={bed} />)}
              </select>
            </label>
            <label>
              <span>Usable bed-feet</span>
              <input name="quantityAssigned" type="number" min="0.25" step="0.25" max={remainingFeet} defaultValue={remainingFeet} required />
            </label>
            <button type="submit" disabled={savingKey === `assign:${lot.id}`}>
              {savingKey === `assign:${lot.id}` ? "Assigning…" : "Assign + create prep work"}
            </button>
          </form>
        ) : remainingFeet > 0 ? (
          <p className="capacity-muted">Answer viability, rows, spacing, and preparation lead time before assigning beds.</p>
        ) : null}
      </section>
    </article>
  );
}

export default function ProductionReadinessClient({
  initialSnapshot,
}: {
  initialSnapshot: OwnerProductionCapacitySnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const numericQuestions = snapshot.questions.filter((question) => question.stableKey !== placementKey);
  const placementQuestion = snapshot.questions.find((question) => question.stableKey === placementKey) ?? null;

  async function mutate(body: Record<string, unknown>, key: string) {
    try {
      setSavingKey(key);
      setError(null);
      const response = await fetch("/api/atlas/production-capacity", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-atlas-intent": "production-capacity-v1",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as ApiResponse;
      if (!response.ok || !payload.ok || !payload.snapshot) {
        throw new Error(apiMessage(payload, "Production capacity update failed."));
      }
      setSnapshot(payload.snapshot);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Production capacity update failed.");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveQuestion(form: HTMLFormElement, question: CapacityQuestion) {
    const data = new FormData(form);
    await mutate(
      {
        action: "answer_question",
        questionId: question.id,
        answerValue: Number(data.get("answerValue")),
        answerText: String(data.get("answerText") || ""),
        confidence: String(data.get("confidence") || "measured"),
      },
      `question:${question.id}`,
    );
  }

  return (
    <main className="capacity-page-shell">
      <header className="capacity-topbar">
        <Link href="/owner">← Owner</Link>
        <div>
          <span>Spring 2027</span>
          <strong>Production readiness</strong>
        </div>
        <button
          type="button"
          disabled={savingKey === "recalculate"}
          onClick={() => void mutate({ action: "recalculate" }, "recalculate")}
        >
          {savingKey === "recalculate" ? "Recalculating…" : "Recalculate"}
        </button>
      </header>

      <section className="capacity-hero">
        <div>
          <span>{snapshot.program.label}</span>
          <h1>Protect January before thousands of seeds arrive.</h1>
          <p>Record real measurements once. Atlas will translate them into seed demand, tray and light occupancy, bed-feet, and preparation deadlines.</p>
        </div>
        <div className="capacity-score">
          <strong>{snapshot.summary.answeredQuestions}/13</strong>
          <span>planning answers recorded</span>
        </div>
      </section>

      {error ? <div className="capacity-error">{error}</div> : null}

      <section className="capacity-stat-grid" aria-label="Production capacity summary">
        <article><strong>{snapshot.summary.openQuestions}</strong><span>open facts</span></article>
        <article><strong>{snapshot.summary.blockedRequirements}</strong><span>blocked calculations</span></article>
        <article><strong>{snapshot.summary.activeReservations}</strong><span>dated reservations</span></article>
        <article><strong>{snapshot.summary.capacityConflicts}</strong><span>capacity conflicts</span></article>
      </section>

      <section className="capacity-section">
        <header>
          <div><span>Step 1</span><h2>Measure the real system</h2></div>
          <p>Estimated answers remain labeled as estimates. Replacing one number recalculates every affected succession.</p>
        </header>
        <div className="capacity-question-grid">
          {numericQuestions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              saving={savingKey === `question:${question.id}`}
              onSave={saveQuestion}
            />
          ))}
        </div>
      </section>

      <section className="capacity-section">
        <header>
          <div><span>Known physical capacity</span><h2>What Elm can hold</h2></div>
          <p>Lit shelf capacity stays unconfirmed until the light count and coverage measurements are recorded.</p>
        </header>
        <div className="capacity-pool-grid">
          {snapshot.pools.filter((pool) => ["tray_inventory", "shelf_positions", "lit_shelf_positions"].includes(pool.kind)).map((pool) => (
            <article key={pool.id}>
              <span>{pool.label}</span>
              <strong>{pool.totalCapacity ?? "?"} {readable(pool.unit)}</strong>
              <em>{pool.status}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="capacity-section">
        <header>
          <div><span>Step 2</span><h2>Assign each crop cohort</h2></div>
          <p>{placementQuestion?.answerText || "Bed placement remains open until every calculated lot has enough measured bed-feet."}</p>
        </header>
        <div className="capacity-lot-grid">
          {snapshot.lots.map((lot) => (
            <LotCard
              key={lot.id}
              lot={lot}
              beds={snapshot.bedCandidates}
              savingKey={savingKey}
              mutate={mutate}
            />
          ))}
        </div>
      </section>

      {snapshot.conflicts.length ? (
        <section className="capacity-section capacity-conflict-section">
          <header>
            <div><span>Needs decision</span><h2>Capacity conflicts</h2></div>
            <p>These dates request more capacity than Elm has confirmed.</p>
          </header>
          <div className="capacity-conflict-list">
            {snapshot.conflicts.slice(0, 30).map((conflict) => (
              <article key={`${conflict.poolId}:${conflict.date}`}>
                <strong>{conflict.poolLabel}</strong>
                <span>{prettyDate(conflict.date)}</span>
                <em>{conflict.reservedQuantity} reserved · {conflict.totalCapacity ?? "?"} available</em>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
