"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import CropCycleTaskCardBody, { type CropCycleTrailStep } from "@/components/atlas/crop-cycle-task-card-body";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./GerminationFocus.module.css";

type GerminationOutcome = "thin" | "on_target" | "patch";
type GerminationAction = "not_yet" | "germinated" | "failed_or_uncertain";
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
};

const nextMove: Record<GerminationChoice, string> = {
  Strong: "Continue",
  Patchy: "Gap fill",
  Failed: "Owner review",
  "Too early to tell": "Wait",
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
  if (choice === "Failed") return { action: "failed_or_uncertain", note: "Germination failed." };
  return { action: "not_yet" };
}

export default function GerminationFocusPage({ task }: { task: GerminationTask }) {
  const [choice, setChoice] = useState<GerminationChoice | null>(null);
  const [saving, setSaving] = useState<GerminationChoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const displayCrop = cropName(task.cropLabel, task.variety);
  const sownDate = task.sownDate || task.plantedDate || null;
  const germinationRange = prettyRange(task.expectedGerminationStart, task.expectedGerminationEnd);
  const harvestRange = prettyRange(task.expectedHarvestStart, task.expectedHarvestEnd);
  const timing = germinationRange
    ? `Germination window · ${germinationRange}`
    : task.dueDate
      ? `Check stand · ${prettyDate(task.dueDate)}`
      : undefined;

  const trail = useMemo<CropCycleTrailStep[]>(() => {
    const steps: CropCycleTrailStep[] = [];
    if (sownDate) steps.push({ label: "Sown", detail: prettyDate(sownDate), state: "done" });
    steps.push({ label: "Germination", detail: prettyDate(task.dueDate) || germinationRange || "Now", state: "now" });
    steps.push({ label: "Next move", detail: choice ? nextMove[choice] : "from result", state: "later" });
    if (harvestRange) steps.push({ label: "Harvest", detail: harvestRange, state: "later" });
    return steps;
  }, [choice, germinationRange, harvestRange, sownDate, task.dueDate]);

  async function submit(selected: GerminationChoice) {
    const result = backendResult(selected);
    try {
      setChoice(selected);
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
          note: result.note,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; details?: string };
      if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Germination update failed.");
      setMessage(`${selected} recorded.`);
      window.setTimeout(() => window.location.assign(returnDestination()), 450);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
      setSaving(null);
    }
  }

  const completion = (
    <div className={styles.completion} aria-label="Log germination result and complete this check">
      {(Object.keys(nextMove) as GerminationChoice[]).map((item) => (
        <button
          type="button"
          data-active={choice === item ? "true" : "false"}
          disabled={saving !== null}
          key={item}
          onClick={() => void submit(item)}
        >
          {saving === item ? "Saving…" : item}
        </button>
      ))}
    </div>
  );

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><small>Atlas</small><strong>Work</strong></Link>
        <Link href="/" className={styles.close} aria-label="Close task">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <AtlasTaskCardFrame
            family="Germination"
            familyDetail="crop check"
            title={task.objectLabel}
            timing={timing}
            completion={completion}
          >
            <CropCycleTaskCardBody
              state={{
                crop: displayCrop,
                stage: sownDate ? `Sown ${prettyDate(sownDate)}` : task.cycleState || null,
                harvest: harvestRange ? `Harvest watch ${harvestRange}` : null,
                trail,
                trailLabel: `${task.objectLabel} crop-cycle germination trail`,
              }}
            />
            <section className={styles.checkSection}>
              <div className={styles.prompt}>Did enough emerge to keep this planting?</div>
              {choice ? <div className={styles.nextMove}><small>Next</small><strong>{nextMove[choice]}</strong></div> : null}
            </section>
            {message ? <p className={styles.message}>{message}</p> : null}
          </AtlasTaskCardFrame>
        </article>
      </div>
    </main>
  );
}
