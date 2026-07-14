"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type ProductionSowingTask = {
  taskId: string;
  successionId: string;
  cropLabel: string;
  variety: string | null;
  sequenceNumber: number;
  successionCount: number;
  plannedWindowStart: string;
  plannedWindowEnd: string;
  lateWindowEnd: string;
  skipAfterDate: string;
  nextWindowStart: string | null;
  nextWindowEnd: string | null;
  finalBiologicalSowDate: string | null;
  projectedGerminationStart: string | null;
  projectedGerminationEnd: string | null;
  projectedHarvestStart: string | null;
  projectedHarvestEnd: string | null;
  projectedClearDate: string | null;
  state: string;
  missedStrategy: "skip" | "merge" | "preserve";
  protectFinalSuccession: boolean;
  intendedUses: string[];
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function pretty(dateIso: string | null | undefined) {
  if (!dateIso) return "Not set";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(from: string, to: string) {
  return Math.ceil((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000);
}

function frostBoundaryIsRelevant(task: ProductionSowingTask) {
  if (!task.finalBiologicalSowDate) return false;
  const days = daysBetween(todayIso(), task.finalBiologicalSowDate);
  return days >= 0 && days <= 14;
}

function statusFor(task: ProductionSowingTask) {
  if (task.state === "sown") return "Sown";
  if (task.state === "skipped") return "Skipped";
  const today = todayIso();
  if (today < task.plannedWindowStart) {
    const days = daysBetween(today, task.plannedWindowStart);
    return `Upcoming · window opens in ${days} day${days === 1 ? "" : "s"}`;
  }
  if (today <= task.plannedWindowEnd) {
    const days = daysBetween(today, task.plannedWindowEnd);
    if (days <= 2) return `Closing soon · ${Math.max(0, days)} day${days === 1 ? "" : "s"} remain`;
    return `In window · ${days} days remain`;
  }
  if (today <= task.lateWindowEnd) return `Late for succession ${task.sequenceNumber}`;
  if (task.sequenceNumber === task.successionCount && frostBoundaryIsRelevant(task)) return "Final sowing boundary approaching";
  if (task.sequenceNumber === task.successionCount) return "Outside planned sowing window";
  if (task.missedStrategy === "skip") return `Skip succession ${task.sequenceNumber} and protect succession ${task.sequenceNumber + 1}`;
  if (task.missedStrategy === "merge") return `Late · review overlap with succession ${task.sequenceNumber + 1}`;
  return `Late · preserve succession ${task.sequenceNumber}`;
}

export default function SowingFocusPage({ task }: { task: ProductionSowingTask }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useMemo(() => statusFor(task), [task]);
  const showFrostBoundary = useMemo(() => frostBoundaryIsRelevant(task), [task]);
  const returnTo = typeof window === "undefined" ? "/production" : new URLSearchParams(window.location.search).get("returnTo") || "/production";

  async function update(state: "sown" | "skipped") {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/atlas/production-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-atlas-intent": "production-plan-v1" },
        body: JSON.stringify({ action: "set_succession_state", successionId: task.successionId, state, actualSowDate: state === "sown" ? todayIso() : undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Production update failed.");
      window.location.href = returnTo;
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Production update failed.");
      setSaving(false);
    }
  }

  return (
    <main className="atlas-sowing-focus-shell">
      <section className="atlas-sowing-focus-card">
        <header>
          <Link href={returnTo}>← Back</Link>
          <span>Production sowing</span>
        </header>

        <div className="atlas-sowing-focus-title">
          <p>{task.variety || task.cropLabel}</p>
          <h1>Sow {task.cropLabel}</h1>
          <b>{status}</b>
        </div>

        <section className="atlas-sowing-window-block">
          <span>Sowing window</span>
          <strong>{pretty(task.plannedWindowStart)}–{pretty(task.plannedWindowEnd)}</strong>
          <p>Late window through {pretty(task.lateWindowEnd)}</p>
        </section>

        <dl className="atlas-sowing-operating-grid">
          <div><dt>Next succession</dt><dd>{task.nextWindowStart ? `${pretty(task.nextWindowStart)}–${pretty(task.nextWindowEnd)}` : "None"}</dd></div>
          <div><dt>Skip threshold</dt><dd>{pretty(task.skipAfterDate)}</dd></div>
          {showFrostBoundary ? <div><dt>Final sowing boundary</dt><dd>{pretty(task.finalBiologicalSowDate)}</dd></div> : null}
          <div><dt>Production use</dt><dd>{task.intendedUses.length ? task.intendedUses.join(" · ") : "Mixed"}</dd></div>
        </dl>

        <section className="atlas-sowing-biology">
          <div><span>Projected germination</span><strong>{pretty(task.projectedGerminationStart)}–{pretty(task.projectedGerminationEnd)}</strong></div>
          <div><span>Projected harvest</span><strong>{pretty(task.projectedHarvestStart)}–{pretty(task.projectedHarvestEnd)}</strong></div>
          <div><span>Projected clear bed</span><strong>{pretty(task.projectedClearDate)}</strong></div>
        </section>

        {error ? <p className="atlas-sowing-error">{error}</p> : null}

        <div className="atlas-sowing-actions">
          <button type="button" className="secondary" disabled={saving || task.state === "skipped" || task.state === "sown"} onClick={() => void update("skipped")}>Skip this succession</button>
          <button type="button" disabled={saving || task.state === "sown" || task.state === "skipped"} onClick={() => void update("sown")}>{saving ? "Saving…" : "Mark sown today"}</button>
        </div>
      </section>
    </main>
  );
}
