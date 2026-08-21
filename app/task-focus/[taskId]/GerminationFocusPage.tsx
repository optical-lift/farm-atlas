"use client";

import { useMemo, useState } from "react";

import CropCycleTaskCardBody, { type CropCycleTrailStep } from "@/components/atlas/crop-cycle-task-card-body";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./GerminationFocus.module.css";

type GerminationOutcome = "thin" | "on_target" | "patch";
type GerminationAction = "not_yet" | "germinated" | "failed";
type GerminationChoice = "Strong" | "Patchy" | "Failed" | "Too early to tell";

type GerminationTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
  dueDate?: string | null;
  sownDate?: string | null;
  plantedDate?: string | null;
  plantingMethod?: string | null;
  cycleState?: string | null;
  expectedGerminationStart?: string | null;
  expectedGerminationEnd?: string | null;
  expectedHarvestStart?: string | null;
  expectedHarvestEnd?: string | null;
  targetSpacingInches?: number | null;
  successionNumber?: number | null;
};

function returnDestination() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "";
  const date = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "";
  if (!start) return prettyDate(end);
  if (!end) return prettyDate(start);
  const startDate = new Date(`${start.slice(0, 10)}T12:00:00`);
  const endDate = new Date(`${end.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return `${prettyDate(start)}–${prettyDate(end)}`;
  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${endDate.toLocaleDateString("en-US", { day: "numeric" })}`;
  }
  return `${prettyDate(start)}–${prettyDate(end)}`;
}

function cropName(cropLabel: string, variety: string | null) {
  if (!variety) return cropLabel;
  return variety.toLowerCase().includes(cropLabel.toLowerCase()) ? variety : `${variety} ${cropLabel.toLowerCase()}`;
}

function backendResult(choice: GerminationChoice): { action: GerminationAction; spacingOutcome?: GerminationOutcome; note?: string } {
  if (choice === "Strong") return { action: "germinated", spacingOutcome: "on_target" };
  if (choice === "Patchy") return { action: "germinated", spacingOutcome: "patch" };
  if (choice === "Failed") return { action: "failed", note: "Germination failed." };
  return { action: "not_yet" };
}

function nextMoveFor(choice: GerminationChoice | null, observedGapInches: number | null, targetSpacingInches: number | null | undefined) {
  if (choice === "Strong") return "Keep growing";
  if (choice === "Failed") return "Bed open · choose next crop";
  if (choice === "Too early to tell") return "Check again";
  if (choice === "Patchy") {
    if (!observedGapInches || !targetSpacingInches) return "Measure gaps";
    return observedGapInches >= targetSpacingInches * 3 ? "Patch gaps" : "Keep growing";
  }
  return "from result";
}

function gapChoices(targetSpacingInches: number | null | undefined) {
  if (!targetSpacingInches || targetSpacingInches <= 0) return null;
  return {
    small: targetSpacingInches * 2,
    large: targetSpacingInches * 3,
  };
}

function inchesLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export default function GerminationFocusPage({ task }: { task: GerminationTask }) {
  const [choice, setChoice] = useState<GerminationChoice | null>(null);
  const [observedGapInches, setObservedGapInches] = useState<number | null>(null);
  const [saving, setSaving] = useState<GerminationChoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const displayCrop = cropName(task.cropLabel, task.variety);
  const sownDate = task.sownDate || task.plantedDate || null;
  const germinationRange = prettyRange(task.expectedGerminationStart, task.expectedGerminationEnd);
  const harvestRange = prettyRange(task.expectedHarvestStart, task.expectedHarvestEnd);
  const gaps = gapChoices(task.targetSpacingInches);
  const nextMove = nextMoveFor(choice, observedGapInches, task.targetSpacingInches);
  const timing = germinationRange
    ? `Germination window · ${germinationRange}`
    : task.dueDate
      ? `Check stand · ${prettyDate(task.dueDate)}`
      : undefined;

  const trail = useMemo<CropCycleTrailStep[]>(() => {
    const steps: CropCycleTrailStep[] = [];
    if (sownDate) steps.push({ label: "Sown", detail: prettyDate(sownDate), state: "done" });
    steps.push({ label: "Germination", detail: prettyDate(task.dueDate) || germinationRange || "Now", state: "now" });
    steps.push({ label: "Next move", detail: nextMove, state: "later" });
    if (harvestRange && choice !== "Failed") steps.push({ label: "Harvest", detail: harvestRange, state: "later" });
    return steps;
  }, [choice, germinationRange, harvestRange, nextMove, sownDate, task.dueDate]);

  async function submit(selected: GerminationChoice, gapInches?: number) {
    const result = backendResult(selected);
    try {
      setChoice(selected);
      if (gapInches !== undefined) setObservedGapInches(gapInches);
      setSaving(selected);
      setMessage(null);
      const response = await fetch("/api/atlas/germination-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          action: result.action,
          spacingOutcome: result.spacingOutcome,
          targetSpacingInches: task.targetSpacingInches,
          observedGapInches: gapInches,
          note: result.note,
        }),
      });
      const data = await response.json() as { ok?: boolean; bedReleased?: boolean; patchRequired?: boolean; error?: string; details?: string };
      if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Germination update failed.");
      if (selected === "Failed" && data.bedReleased) setMessage("Bed open · crop decision needed.");
      else if (selected === "Patchy") setMessage(data.patchRequired ? "Patchy recorded · patching added." : "Patchy recorded · keep growing.");
      else setMessage(`${selected} recorded.`);
      window.setTimeout(() => window.location.assign(returnDestination()), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
      setSaving(null);
    }
  }

  function choosePrimary(selected: GerminationChoice) {
    setMessage(null);
    if (selected === "Patchy") {
      setChoice("Patchy");
      setObservedGapInches(null);
      if (!gaps) setMessage("Atlas is missing this variety's target spacing, so it cannot decide whether patching is needed yet.");
      return;
    }
    setObservedGapInches(null);
    void submit(selected);
  }

  const completion = (
    <div className={styles.completion} aria-label="Log germination result and complete this check">
      {(["Strong", "Patchy", "Failed", "Too early to tell"] as GerminationChoice[]).map((item) => (
        <button
          type="button"
          data-active={choice === item ? "true" : "false"}
          disabled={saving !== null}
          key={item}
          onClick={() => choosePrimary(item)}
        >
          {saving === item ? "Saving…" : item}
        </button>
      ))}
    </div>
  );

  const failed = choice === "Failed";

  return (
    <main className={styles.shell}>
      <div className={styles.body}>
        <article className={styles.ticket}>
          <AtlasTaskCardFrame
            family="Germination"
            familyDetail={task.successionNumber ? `Succession ${task.successionNumber}` : undefined}
            title={task.objectLabel}
            timing={timing}
            completion={completion}
          >
            <CropCycleTaskCardBody
              state={{
                crop: displayCrop,
                stage: failed ? "Planting failed" : sownDate ? `Sown ${prettyDate(sownDate)}` : task.cycleState || null,
                harvest: !failed && harvestRange ? `Harvest watch ${harvestRange}` : null,
                trail,
                trailLabel: `${task.objectLabel} crop-cycle germination trail`,
              }}
            />
            <section className={styles.checkSection}>
              <div className={styles.prompt}>How&apos;d they do?</div>
              {choice === "Patchy" && gaps ? (
                <div className={styles.gapDrawer} aria-label="Measure patchy germination gaps">
                  <strong>How big are the gaps between seeds?</strong>
                  <div className={styles.gapChoices}>
                    <button type="button" disabled={saving !== null} onClick={() => void submit("Patchy", gaps.small)}>
                      About {inchesLabel(gaps.small)}″
                    </button>
                    <button type="button" disabled={saving !== null} onClick={() => void submit("Patchy", gaps.large)}>
                      {inchesLabel(gaps.large)}″+
                    </button>
                  </div>
                </div>
              ) : null}
              {choice ? <div className={styles.nextMove}><small>Next</small><strong>{nextMove}</strong></div> : null}
            </section>
            {message ? <p className={styles.message}>{message}</p> : null}
          </AtlasTaskCardFrame>
        </article>
      </div>
    </main>
  );
}
