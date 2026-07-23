"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  careStateClass,
  fetchFarmCareObject,
  formatCareMinutes,
  humanizeCareValue,
  prettyCareDate,
  type CareHistoryEvent,
  type FarmCareObject,
  type MaintenanceResult,
  type ReleasedIntervention,
} from "@/lib/atlas/farm-care-client";

type UpdateResponse = {
  ok: boolean;
  object?: FarmCareObject;
  role?: string;
  error?: string | { message?: string };
};

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

function errorMessage(error: UpdateResponse["error"], fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  return fallback;
}

function triState(value: string) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function reasonText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["reason", "strategy_reason", "note", "basis"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return "";
}

function seasonalContext(object: FarmCareObject) {
  if (object.reviewOn) return `Hold the current strategy until review on ${prettyCareDate(object.reviewOn, true)}.`;
  const active = object.activeCropCycles.filter((cycle) => cycle.lifecycleStatus === "active");
  if (active.length) return `Protect the current ${active.map((cycle) => cycle.variety || cycle.crop).join(" and ")} cycle.`;
  const planned = object.activeCropCycles.filter((cycle) => cycle.lifecycleStatus === "planned");
  if (planned.length) return `Keep this place ready for ${planned.map((cycle) => cycle.variety || cycle.crop).join(" and ")}.`;
  if (object.careState === "unknown") return "Observe this place before prescribing seasonal care.";
  return `${humanizeCareValue(object.objectMode)} place inside a ${humanizeCareValue(object.zoneMode)} area.`;
}

function taskHref(taskId: string) {
  return `/task?taskId=${encodeURIComponent(taskId)}`;
}

function InterventionCard({ intervention }: { intervention: ReleasedIntervention }) {
  return (
    <article className="atlas-farm-care-intervention-card">
      <header>
        <div><span>Executable care</span><strong>{intervention.title}</strong></div>
        <b>{intervention.dueDate ? prettyCareDate(intervention.dueDate) : "Open"}</b>
      </header>
      {intervention.reasonLines?.length ? <p>{intervention.reasonLines.join(" · ")}</p> : null}
      {intervention.desiredResult ? <section><span>After this</span><p>{intervention.desiredResult}</p></section> : null}
      {intervention.doneDefinition ? <section><span>Done means</span><p>{intervention.doneDefinition}</p></section> : null}
      {intervention.unlocks ? <section><span>Unlocks</span><p>{intervention.unlocks}</p></section> : null}
      <footer><span>{formatCareMinutes(intervention.estimatedMinutes)}</span><Link href={taskHref(intervention.taskId)}>Open task</Link></footer>
    </article>
  );
}

function HistoryRow({ event }: { event: CareHistoryEvent }) {
  const transition = event.previousStateLabel
    ? `${event.previousStateLabel} → ${event.resultingStateLabel || "Updated"}`
    : event.resultingStateLabel || "Care state updated";
  const strategy = event.previousStrategyLabel && event.resultingStrategyLabel
    && event.previousStrategyLabel !== event.resultingStrategyLabel
    ? `${event.previousStrategyLabel} → ${event.resultingStrategyLabel}`
    : "";
  const note = reasonText(event.reason);

  return (
    <article className="atlas-farm-care-history-row">
      <div>
        <strong>{transition}</strong>
        {strategy ? <span>{strategy}</span> : null}
        {note ? <p>{note}</p> : null}
      </div>
      <time>{prettyCareDate(event.occurredAt)}</time>
    </article>
  );
}

function ResultRow({ result }: { result: MaintenanceResult }) {
  return (
    <article className="atlas-farm-care-history-row">
      <div>
        <strong>{humanizeCareValue(result.outcome)}</strong>
        <span>{[
          result.actualMinutes ? `${result.actualMinutes} min worked` : "",
          result.remainingMinutesAfter !== undefined ? `${result.remainingMinutesAfter} min remaining` : "",
        ].filter(Boolean).join(" · ")}</span>
        {result.note ? <p>{result.note}</p> : null}
      </div>
      <time>{prettyCareDate(result.completedAt)}</time>
    </article>
  );
}

export default function FarmCareObjectPage() {
  const params = useParams<{ zoneKey: string; objectKey: string }>();
  const [object, setObject] = useState<FarmCareObject | null>(null);
  const [role, setRole] = useState<string>("");
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

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchFarmCareObject(params.objectKey);
        if (!response.object) throw new Error("Atlas could not load this farm place.");
        setObject(response.object);
        setRole(response.role ?? "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Atlas could not load this farm place.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.objectKey]);

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

  const mayCorrect = role === "owner" || role === "manager";
  const canonicalZoneKey = object?.zoneKey || params.zoneKey;
  const zoneHref = `/collections/weeding/${encodeURIComponent(canonicalZoneKey)}`;

  const contents = useMemo(() => object?.contents ?? [], [object]);
  const cycles = useMemo(() => object?.activeCropCycles ?? [], [object]);

  async function postUpdate(action: "observe" | "strategy", body: Record<string, unknown>) {
    const response = await fetch(`/api/atlas/farm-care/object?objectKey=${encodeURIComponent(params.objectKey)}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ action, ...body }),
    });
    const result = (await response.json()) as UpdateResponse;
    if (!response.ok || !result.ok || !result.object) {
      throw new Error(errorMessage(result.error, "Farm Care update failed."));
    }
    setObject(result.object);
    setRole(result.role ?? role);
  }

  async function saveObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSaving("observe");
      setMessage(null);
      await postUpdate("observe", {
        pressure,
        intendedShapeReadable: triState(shapeReadable),
        functionProtected: triState(functionProtected),
        recoveryRequired: triState(recoveryRequired),
        estimatedEffortMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
        note: observationNote,
      });
      setObservationNote("");
      setMessage("Current observation recorded.");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Observation failed to save.");
    } finally {
      setSaving(null);
    }
  }

  async function saveStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSaving("strategy");
      setMessage(null);
      await postUpdate("strategy", { strategy, reviewOn: reviewOn || null, reason: strategyReason });
      setStrategyReason("");
      setMessage("Care strategy updated.");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Strategy failed to save.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-farm-care-page-shell atlas-farm-care-drilldown-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={zoneHref} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Farm Care</span>
            <span className="atlas-phone-title">Place</span>
          </Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href={zoneHref} className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to area">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-farm-care-body atlas-farm-care-drilldown-body">
          {loading ? <div className="atlas-task-page-empty">Loading place care…</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          {!loading && object ? (
            <>
              <section className={`atlas-overview-hero atlas-farm-care-object-hero ${careStateClass(object.careState)}`}>
                <div>
                  <span>{object.zoneLabel}</span>
                  <strong>{object.objectLabel}</strong>
                </div>
                <p>{object.now}</p>
                <footer><b>{object.careStateLabel}</b><span>{object.careTrend === "unknown" ? "Trend unknown" : object.careTrendLabel}</span></footer>
              </section>

              <section className="atlas-farm-care-now-after-grid" aria-label={`${object.objectLabel} care result`}>
                <article><span>Now</span><p>{object.now}</p></article>
                <article><span>After this</span><p>{object.desiredAfter}</p></article>
                <article><span>Done means</span><p>{object.doneDefinition}</p></article>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-next-action-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Next valid action</span><h2>{object.nextValidAction}</h2></div>
                  <b>{formatCareMinutes(object.estimatedEffortMinutes)}</b>
                </header>
                <div className="atlas-farm-care-copy-block">
                  <p>{seasonalContext(object)}</p>
                  <strong>{object.riskLabels.length ? `At risk: ${object.riskLabels.map(humanizeCareValue).join(" · ")}` : "No verified active risk."}</strong>
                </div>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-object-context-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Identity and contents</span><h2>What is here</h2></div>
                  <b>{humanizeCareValue(object.objectType)}</b>
                </header>
                <div className="atlas-farm-care-content-list">
                  {contents.map((content) => (
                    <article key={content.contentId}>
                      <strong>{content.variety || content.label}</strong>
                      <span>{[content.type ? humanizeCareValue(content.type) : "", content.status ? humanizeCareValue(content.status) : "", content.plantedDate ? `planted ${prettyCareDate(content.plantedDate)}` : ""].filter(Boolean).join(" · ")}</span>
                    </article>
                  ))}
                  {cycles.map((cycle) => (
                    <article key={cycle.cropCycleId}>
                      <strong>{cycle.variety || cycle.crop}</strong>
                      <span>{[cycle.lifecycleStatus ? humanizeCareValue(cycle.lifecycleStatus) : "Crop cycle", cycle.plantedDate ? `planted ${prettyCareDate(cycle.plantedDate)}` : cycle.sownDate ? `sown ${prettyCareDate(cycle.sownDate)}` : "", cycle.expectedHarvestWatchStart ? `watch ${prettyCareDate(cycle.expectedHarvestWatchStart)}` : ""].filter(Boolean).join(" · ")}</span>
                    </article>
                  ))}
                  {!contents.length && !cycles.length ? <p className="atlas-farm-care-empty-line">No current contents or crop cycle is recorded here.</p> : null}
                </div>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-object-strategy-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Strategy and evidence</span><h2>{object.careStrategyLabel}</h2></div>
                  <b>{humanizeCareValue(object.careFreshness)}</b>
                </header>
                <div className="atlas-farm-care-fact-grid">
                  <article><span>Pressure</span><strong>{humanizeCareValue(object.carePressure)}</strong></article>
                  <article><span>Confidence</span><strong>{humanizeCareValue(object.careConfidence)}</strong></article>
                  <article><span>Observed</span><strong>{object.observedAt ? prettyCareDate(object.observedAt) : "Not current"}</strong></article>
                  <article><span>Last care</span><strong>{object.lastMeaningfullyTendedAt ? prettyCareDate(object.lastMeaningfullyTendedAt) : "Not recorded"}</strong></article>
                  <article><span>Review</span><strong>{object.reviewOn ? prettyCareDate(object.reviewOn) : "No date"}</strong></article>
                  <article><span>Ordinary weeding</span><strong>{object.ordinaryWeedingAllowed ? "Allowed" : "Not appropriate"}</strong></article>
                </div>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-object-interventions">
                <header className="atlas-farm-care-section-header">
                  <div><span>Current intervention</span><h2>Released care</h2></div>
                  <b>{object.releasedInterventions.length}</b>
                </header>
                {object.releasedInterventions.length ? (
                  <div className="atlas-farm-care-intervention-list">{object.releasedInterventions.map((intervention) => <InterventionCard key={intervention.taskId} intervention={intervention} />)}</div>
                ) : <p className="atlas-farm-care-empty-line">No executable task is currently released for this place.</p>}
              </section>

              {object.plannedRecommendations.length ? (
                <section className="atlas-farm-care-panel atlas-farm-care-planned-panel">
                  <header className="atlas-farm-care-section-header">
                    <div><span>Prepared, not released</span><h2>Recommendations</h2></div>
                    <b>{object.plannedRecommendations.length}</b>
                  </header>
                  <div className="atlas-farm-care-planned-list">
                    {object.plannedRecommendations.map((item) => (
                      <article key={item.occurrenceId}><strong>{item.title}</strong><span>{item.plannedDueDate ? prettyCareDate(item.plannedDueDate) : "No planned date"} · {formatCareMinutes(item.estimatedMinutes)}</span>{item.doneDefinition ? <p>{item.doneDefinition}</p> : null}</article>
                    ))}
                  </div>
                </section>
              ) : null}

              {object.latestObservation ? (
                <section className="atlas-farm-care-panel atlas-farm-care-observation-panel">
                  <header className="atlas-farm-care-section-header">
                    <div><span>Latest evidence</span><h2>Current observation</h2></div>
                    <b>{prettyCareDate(object.latestObservation.observedAt)}</b>
                  </header>
                  <div className="atlas-farm-care-fact-grid">
                    <article><span>Pressure</span><strong>{humanizeCareValue(object.latestObservation.pressure)}</strong></article>
                    <article><span>Shape readable</span><strong>{object.latestObservation.intendedShapeReadable === undefined ? "Unknown" : object.latestObservation.intendedShapeReadable ? "Yes" : "No"}</strong></article>
                    <article><span>Function protected</span><strong>{object.latestObservation.functionProtected === undefined ? "Unknown" : object.latestObservation.functionProtected ? "Yes" : "No"}</strong></article>
                    <article><span>Recovery required</span><strong>{object.latestObservation.recoveryRequired === undefined ? "Unknown" : object.latestObservation.recoveryRequired ? "Yes" : "No"}</strong></article>
                  </div>
                  {object.latestObservation.note ? <p className="atlas-farm-care-panel-note">{object.latestObservation.note}</p> : null}
                </section>
              ) : null}

              <section className="atlas-farm-care-panel atlas-farm-care-object-history">
                <header className="atlas-farm-care-section-header">
                  <div><span>Care history and evidence</span><h2>What happened here</h2></div>
                  <b>{(object.history?.length ?? 0) + (object.results?.length ?? 0)}</b>
                </header>
                {object.results?.length ? <div className="atlas-farm-care-history-list">{object.results.map((result) => <ResultRow key={result.maintenanceHistoryId} result={result} />)}</div> : null}
                {object.history?.length ? <div className="atlas-farm-care-history-list">{object.history.map((event) => <HistoryRow key={event.historyId} event={event} />)}</div> : null}
                {!object.results?.length && !object.history?.length ? <p className="atlas-farm-care-empty-line">No prior care result or state movement is recorded here yet.</p> : null}
              </section>

              {mayCorrect ? (
                <section className="atlas-farm-care-management-stack" aria-label="Manager Farm Care controls">
                  <details className="atlas-farm-care-management-panel">
                    <summary><strong>Record current observation</strong><span>Owner / Manager</span></summary>
                    <form onSubmit={saveObservation}>
                      <label>Pressure<select value={pressure} onChange={(event) => setPressure(event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="severe">Severe</option><option value="unknown">Unknown</option></select></label>
                      <label>Intended shape readable<select value={shapeReadable} onChange={(event) => setShapeReadable(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                      <label>Function protected<select value={functionProtected} onChange={(event) => setFunctionProtected(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                      <label>Recovery required<select value={recoveryRequired} onChange={(event) => setRecoveryRequired(event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                      <label>Estimated effort<input type="number" min="0" max="1440" inputMode="numeric" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} placeholder="minutes" /></label>
                      <label className="wide">Observation note<textarea value={observationNote} onChange={(event) => setObservationNote(event.target.value)} rows={3} /></label>
                      <button type="submit" disabled={saving !== null}>{saving === "observe" ? "Saving…" : "Record observation"}</button>
                    </form>
                  </details>

                  <details className="atlas-farm-care-management-panel">
                    <summary><strong>Change care strategy</strong><span>Owner / Manager</span></summary>
                    <form onSubmit={saveStrategy}>
                      <label className="wide">Strategy<select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{STRATEGIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label>Review date<input type="date" value={reviewOn} onChange={(event) => setReviewOn(event.target.value)} /></label>
                      <label className="wide">Reason<textarea value={strategyReason} onChange={(event) => setStrategyReason(event.target.value)} rows={3} required /></label>
                      <button type="submit" disabled={saving !== null}>{saving === "strategy" ? "Saving…" : "Update strategy"}</button>
                    </form>
                  </details>
                  {message ? <p className="atlas-farm-care-management-message">{message}</p> : null}
                </section>
              ) : null}

              <nav className="atlas-farm-care-breadcrumb-footer" aria-label="Farm Care navigation">
                <Link href="/collections/weeding">Farm Care</Link>
                <Link href={zoneHref}>{object.zoneLabel}</Link>
                <span>{object.objectLabel}</span>
              </nav>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
