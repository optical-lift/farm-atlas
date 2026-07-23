"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  fetchFarmCareObject,
  humanizeCareValue,
  prettyCareDate,
  type FarmCareObject,
} from "@/lib/atlas/farm-care-client";
import {
  fetchTendingBed,
  formatTendingEffort,
  prettyTendingDate,
  tendingClock,
  tendingDueLabel,
  tendingStepLabel,
  tendingStepsToHarvestLabel,
  tendingTaskHref,
  type TendingBedTrack,
  type TendingGate,
} from "@/lib/atlas/tending-client";

type UpdateResponse = { ok: boolean; object?: FarmCareObject; role?: string; error?: string | { message?: string } };

const STRATEGIES = [
  ["active_hand_care", "Active hand care"],
  ["targeted_recovery", "Targeted recovery"],
  ["mow_and_hold", "Mow and hold"],
  ["suppressed_by_tarp", "Suppressed by tarp"],
  ["mulch_hold", "Mulch hold"],
  ["cover_crop_hold", "Cover crop hold"],
  ["resting_until_review", "Rest until review"],
  ["redesign_pending", "Redesign pending"],
  ["removal_pending", "Removal pending"],
  ["unknown", "Strategy unknown"],
] as const;

function triState(value: string) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function errorMessage(error: UpdateResponse["error"], fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  return fallback;
}

function gateSymbol(gate: TendingGate) {
  if (gate.status === "complete") return "✓";
  if (gate.status === "current") return "●";
  if (gate.status === "blocked") return "!";
  if (gate.status === "skipped") return "–";
  return "○";
}

function HarvestScore({ bed }: { bed: TendingBedTrack }) {
  const hasForecast = bed.harvestForecast !== null && bed.harvestForecast !== undefined;
  const hasCeiling = bed.harvestCeiling !== null && bed.harvestCeiling !== undefined;
  if (!hasForecast && !hasCeiling) return <strong>HARVEST TRACK</strong>;
  const unit = bed.harvestMetricType === "harvest_rounds" ? "rounds" : bed.harvestMetricType === "harvest" ? "harvest" : "opportunities";
  return <strong>{bed.harvestForecast ?? 0}{hasCeiling ? ` / ${bed.harvestCeiling}` : ""} {unit}</strong>;
}

export default function TendingBedPage() {
  const params = useParams<{ zoneKey: string; objectKey: string }>();
  const [bed, setBed] = useState<TendingBedTrack | null>(null);
  const [object, setObject] = useState<FarmCareObject | null>(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"observe" | "strategy" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pressure, setPressure] = useState("unknown");
  const [shapeReadable, setShapeReadable] = useState("unknown");
  const [functionProtected, setFunctionProtected] = useState("unknown");
  const [recoveryRequired, setRecoveryRequired] = useState("unknown");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [observationNote, setObservationNote] = useState("");
  const [strategy, setStrategy] = useState("unknown");
  const [reviewOn, setReviewOn] = useState("");
  const [strategyReason, setStrategyReason] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [tendingResponse, careResponse] = await Promise.all([
        fetchTendingBed(params.objectKey),
        fetchFarmCareObject(params.objectKey),
      ]);
      if (!tendingResponse.bed || !careResponse.object) throw new Error("This bed board failed to load.");
      setBed(tendingResponse.bed);
      setObject(careResponse.object);
      setRole(careResponse.role ?? tendingResponse.role ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "This bed board failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params.objectKey]);

  useEffect(() => {
    if (!object) return;
    setPressure(object.latestObservation?.pressure || object.carePressure || "unknown");
    setShapeReadable(object.latestObservation?.intendedShapeReadable === true ? "yes" : object.latestObservation?.intendedShapeReadable === false ? "no" : "unknown");
    setFunctionProtected(object.latestObservation?.functionProtected === true ? "yes" : object.latestObservation?.functionProtected === false ? "no" : "unknown");
    setRecoveryRequired(object.latestObservation?.recoveryRequired === true ? "yes" : object.latestObservation?.recoveryRequired === false ? "no" : "unknown");
    setEstimatedMinutes(object.estimatedEffortMinutes ? String(object.estimatedEffortMinutes) : "");
    setStrategy(object.careStrategy || "unknown");
    setReviewOn(object.reviewOn || "");
  }, [object]);

  async function postUpdate(action: "observe" | "strategy", body: Record<string, unknown>) {
    const response = await fetch(`/api/atlas/farm-care/object?objectKey=${encodeURIComponent(params.objectKey)}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ action, ...body }),
    });
    const result = (await response.json()) as UpdateResponse;
    if (!response.ok || !result.ok || !result.object) throw new Error(errorMessage(result.error, "Farm Care update failed."));
    setObject(result.object);
    setRole(result.role ?? role);
  }

  async function saveObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSaving("observe"); setMessage(null);
      await postUpdate("observe", { pressure, intendedShapeReadable: triState(shapeReadable), functionProtected: triState(functionProtected), recoveryRequired: triState(recoveryRequired), estimatedEffortMinutes: estimatedMinutes ? Number(estimatedMinutes) : null, note: observationNote });
      setObservationNote(""); setMessage("Current observation recorded."); await load();
    } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : "Observation failed to save."); }
    finally { setSaving(null); }
  }

  async function saveStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSaving("strategy"); setMessage(null);
      await postUpdate("strategy", { strategy, reviewOn: reviewOn || null, reason: strategyReason });
      setStrategyReason(""); setMessage("Care strategy updated."); await load();
    } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : "Strategy failed to save."); }
    finally { setSaving(null); }
  }

  const mayCorrect = role === "owner" || role === "manager";
  const zoneHref = `/collections/weeding/${encodeURIComponent(bed?.zoneKey || params.zoneKey)}`;
  const taskHref = bed ? tendingTaskHref(bed) : null;
  const results = object?.results ?? [];
  const history = object?.history ?? [];

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-tending-shell atlas-tending-bed-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/collections/weeding" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Tending</span><span className="atlas-phone-title">Bed board</span></Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href="/collections/weeding" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to Tending">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-tending-body">
          {loading ? <div className="atlas-task-page-empty">Loading bed board…</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          {!loading && bed && object ? (
            <>
              <section className="atlas-tending-bed-hero">
                <span>{bed.zoneLabel}</span>
                <h1>{bed.bedLabel}</h1>
                <div className="atlas-tending-crop-line"><strong>{bed.cropLabel}</strong><em>{humanizeCareValue(bed.cropLifecycleStatus || bed.cropStage || "crop track")}</em></div>
                <div className="atlas-tending-score"><HarvestScore bed={bed} /><span>{tendingClock(bed)}</span></div>
              </section>

              <section className="atlas-tending-gate-board" aria-label={`${bed.bedLabel} harvest path`}>
                <header><span>Path to harvest</span><strong>{tendingStepsToHarvestLabel(bed)}</strong></header>
                <ol>
                  {bed.gates.map((gate, index) => {
                    const active = gate.status === "current" && gate.taskId && taskHref;
                    const dateLabel = gate.dueDate
                      ? gate.status === "current" ? tendingDueLabel(gate.dueDate) : prettyTendingDate(gate.dueDate)
                      : null;
                    const content = <><b>{gateSymbol(gate)}</b><span>{gate.label}</span>{dateLabel ? <time>{dateLabel}</time> : null}</>;
                    return <li key={`${gate.key}:${gate.dueDate ?? index}`} className={`gate-${gate.status}`}>{active ? <Link href={taskHref}>{content}</Link> : content}</li>;
                  })}
                </ol>
              </section>

              {bed.currentGate && taskHref ? (
                <Link href={taskHref} className="atlas-tending-bed-current">
                  <small>{tendingDueLabel(bed.taskDueDate || bed.currentGate.dueDate)} · {tendingStepLabel(bed)}</small>
                  <strong>{bed.taskTitle || `${bed.currentGate.label} ${bed.bedLabel}`}</strong>
                  <span>unlocks {bed.unlockLabel}</span>
                  <footer><b>{formatTendingEffort(bed.taskEffortMinutes)}</b><em>Open task ›</em></footer>
                </Link>
              ) : <section className="atlas-tending-bed-current quiet"><small>Next step</small><strong>No step is open</strong><span>{tendingClock(bed)}</span></section>}

              <details className="atlas-tending-detail-drawer">
                <summary><strong>Bed details</strong><span>contents · care · history</span></summary>
                <div className="atlas-tending-detail-stack">
                  <section><h2>Contents</h2>{object.contents.map((item) => <article key={item.contentId}><strong>{item.variety || item.label}</strong><span>{humanizeCareValue(item.status || item.type || "recorded")}</span></article>)}{object.activeCropCycles.map((cycle) => <article key={cycle.cropCycleId}><strong>{cycle.variety || cycle.crop}</strong><span>{cycle.expectedHarvestWatchStart ? `harvest ${prettyCareDate(cycle.expectedHarvestWatchStart)}` : humanizeCareValue(cycle.lifecycleStatus)}</span></article>)}</section>
                  <section><h2>Care engine</h2><div className="atlas-tending-facts"><span>State <b>{object.careStateLabel}</b></span><span>Strategy <b>{object.careStrategyLabel}</b></span><span>Pressure <b>{humanizeCareValue(object.carePressure)}</b></span><span>Observed <b>{object.observedAt ? prettyCareDate(object.observedAt) : "Not current"}</b></span></div></section>
                  <section><h2>Recent history</h2>{results.slice(0, 4).map((result) => <article key={result.maintenanceHistoryId}><strong>{humanizeCareValue(result.outcome)}</strong><span>{prettyCareDate(result.completedAt)}</span></article>)}{history.slice(0, 6).map((event) => <article key={event.historyId}><strong>{event.resultingStateLabel || "State updated"}</strong><span>{prettyCareDate(event.occurredAt)}</span></article>)}{!results.length && !history.length ? <p>No recorded history yet.</p> : null}</section>
                </div>
              </details>

              {mayCorrect ? (
                <details className="atlas-tending-detail-drawer atlas-tending-management">
                  <summary><strong>Management controls</strong><span>Owner / Manager</span></summary>
                  <div className="atlas-farm-care-management-stack">
                    <form onSubmit={saveObservation}>
                      <h2>Record observation</h2>
                      <label>Pressure<select value={pressure} onChange={(event) => setPressure(event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="severe">Severe</option><option value="unknown">Unknown</option></select></label>
                      <label>Shape readable<select value={shapeReadable} onChange={(event) => setShapeReadable(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                      <label>Function protected<select value={functionProtected} onChange={(event) => setFunctionProtected(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                      <label>Recovery required<select value={recoveryRequired} onChange={(event) => setRecoveryRequired(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                      <label>Estimated effort<input type="number" min="0" max="1440" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label>
                      <label>Note<textarea value={observationNote} onChange={(event) => setObservationNote(event.target.value)} rows={3} /></label>
                      <button type="submit" disabled={saving !== null}>{saving === "observe" ? "Saving…" : "Record observation"}</button>
                    </form>
                    <form onSubmit={saveStrategy}>
                      <h2>Care strategy</h2>
                      <label>Strategy<select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{STRATEGIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label>Review date<input type="date" value={reviewOn} onChange={(event) => setReviewOn(event.target.value)} /></label>
                      <label>Reason<textarea required value={strategyReason} onChange={(event) => setStrategyReason(event.target.value)} rows={3} /></label>
                      <button type="submit" disabled={saving !== null}>{saving === "strategy" ? "Saving…" : "Update strategy"}</button>
                    </form>
                    {message ? <p>{message}</p> : null}
                  </div>
                </details>
              ) : null}

              <nav className="atlas-farm-care-breadcrumb-footer"><Link href="/collections/weeding">Tending</Link><Link href={zoneHref}>{bed.zoneLabel}</Link><span>{bed.bedLabel}</span></nav>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
