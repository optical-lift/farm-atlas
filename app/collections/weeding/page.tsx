"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  CARE_STATE_ROWS,
  careStateClass,
  fetchFarmCareSummary,
  formatCareMinutes,
  prettyCareDate,
  type FarmCareSummary,
  type FarmCareZone,
  type StateCounts,
} from "@/lib/atlas/farm-care-client";

const CONCERN_ORDER: Array<keyof StateCounts> = [
  "recoveryNeeded",
  "losingShape",
  "needsTending",
  "stirring",
  "decisionNeeded",
  "resting",
  "suppressed",
  "settled",
  "unknown",
];

function stateLabel(key: keyof StateCounts) {
  return CARE_STATE_ROWS.find((row) => row.key === key)?.label ?? key;
}

function zoneStateSummary(zone: FarmCareZone) {
  return CONCERN_ORDER
    .filter((key) => zone.stateCounts[key] > 0)
    .map((key) => `${zone.stateCounts[key]} ${stateLabel(key)}`)
    .slice(0, 4);
}

function riskSummary(zone: FarmCareZone) {
  if (zone.careState === "resting") return "Intentionally resting; not overdue.";
  if (zone.careState === "suppressed") return "Pressure is being held by the current strategy.";

  const risks = [
    zone.risks.production ? `${zone.risks.production} production` : "",
    zone.risks.presentation ? `${zone.risks.presentation} presentation` : "",
    zone.risks.accessOrEstablishment ? `${zone.risks.accessOrEstablishment} access / establishment` : "",
    zone.risks.spread ? `${zone.risks.spread} spread` : "",
  ].filter(Boolean);

  if (risks.length) return `At risk: ${risks.join(" · ")}`;
  if (zone.observationCoverage.unknownOrStale > 0) return "Risk is not fully known until current observations are recorded.";
  return "No verified active risk.";
}

function primaryStrategy(zone: FarmCareZone) {
  const known = zone.strategySummary.find((item) => item.strategy !== "unknown");
  return known ?? zone.strategySummary[0] ?? null;
}

function changeRank(zone: FarmCareZone) {
  if (zone.careState === "recovery_needed") return 0;
  if (zone.careState === "losing_shape") return 1;
  if (zone.careTrend === "rising") return 2;
  if (zone.careTrend === "improving") return 3;
  return 4;
}

function zoneHref(zoneKey: string) {
  return `/collections/weeding/${encodeURIComponent(zoneKey)}`;
}

function AreaChangeRow({ zone }: { zone: FarmCareZone }) {
  const note = zone.careTrend === "improving"
    ? "Improving"
    : zone.careTrend === "rising"
      ? "Pressure rising"
      : zone.careStateLabel;

  return (
    <Link className={`atlas-farm-care-change-row ${careStateClass(zone.careState)}`} href={zoneHref(zone.zoneKey)}>
      <div>
        <strong>{zone.zoneLabel}</strong>
        <span>{zone.highestConcernObject?.objectLabel ?? zone.careStateLabel}</span>
      </div>
      <b>{note}</b>
    </Link>
  );
}

function AreaCard({ zone }: { zone: FarmCareZone }) {
  const strategy = primaryStrategy(zone);
  const summaries = zoneStateSummary(zone);
  const concern = zone.highestConcernObject;

  return (
    <Link className={`atlas-farm-care-area-card atlas-farm-care-area-link ${careStateClass(zone.careState)}`} href={zoneHref(zone.zoneKey)}>
      <header>
        <div>
          <span className="atlas-farm-care-area-kicker">{zone.objectCount} {zone.objectCount === 1 ? "place" : "places"}</span>
          <h3>{zone.zoneLabel}</h3>
        </div>
        <span className={`atlas-farm-care-state-badge ${careStateClass(zone.careState)}`}>{zone.careStateLabel}</span>
      </header>

      <p className="atlas-farm-care-purpose">{zone.purpose || zone.intendedFinish || "Purpose not yet recorded."}</p>

      <div className="atlas-farm-care-area-signals">
        <span>{zone.careTrend === "unknown" ? "Trend not yet known" : zone.careTrendLabel}</span>
        <span>{zone.observationCoverage.reliable} current · {zone.observationCoverage.unknownOrStale} need observation</span>
      </div>

      <div className="atlas-farm-care-count-line" aria-label={`${zone.zoneLabel} care state counts`}>
        {summaries.map((summary) => <span key={summary}>{summary}</span>)}
      </div>

      <p className="atlas-farm-care-risk-line">{riskSummary(zone)}</p>

      {concern ? (
        <section className="atlas-farm-care-object-focus">
          <span>{zone.careState === "resting" ? "Resting place" : "Current focus"}</span>
          <strong>{concern.objectLabel}</strong>
          <p>{concern.nextValidAction || zone.nextMove || "Record a current care observation."}</p>
        </section>
      ) : null}

      <footer>
        <div><span>Strategy</span><strong>{strategy ? strategy.label : "Strategy unknown"}</strong></div>
        <div><span>Known effort</span><strong>{formatCareMinutes(zone.estimatedCareMinutes)}</strong></div>
        <div><span>Released care</span><strong>{zone.releasedInterventionCount}</strong></div>
      </footer>
      <em className="atlas-farm-care-area-arrow" aria-hidden="true">›</em>
    </Link>
  );
}

export default function WeedingCollectionPage() {
  const [care, setCare] = useState<FarmCareSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchFarmCareSummary();
        if (!response.care) throw new Error("Farm Care failed to load.");
        setCare(response.care);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Farm Care failed to load.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const areasChanging = useMemo(() => {
    if (!care) return [];
    return care.zones
      .filter((zone) => (
        zone.careTrend === "improving"
        || zone.careTrend === "rising"
        || zone.careState === "recovery_needed"
        || zone.careState === "losing_shape"
      ))
      .sort((a, b) => changeRank(a) - changeRank(b) || a.sortOrder - b.sortOrder)
      .slice(0, 6);
  }, [care]);

  const recoveryObjectCount = care ? care.stateCounts.recoveryNeeded + care.stateCounts.losingShape : 0;
  const changingZoneCount = care ? care.zoneTrends.improving + care.zoneTrends.rising : 0;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell atlas-farm-care-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Farm Care</span>
          </Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body atlas-farm-care-body">
          <section className="atlas-overview-hero atlas-work-collection-hero atlas-farm-care-hero">
            <div><span>Elm Farm condition</span><strong>Farm Care</strong></div>
            <p>{loading ? "Reading how the farm is holding…" : care?.summarySentence}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading Farm Care…</div> : null}

          {!loading && care ? (
            <>
              <section className="atlas-overview-stat-grid atlas-farm-care-stats" aria-label="Farm Care summary">
                <article><strong>{recoveryObjectCount}</strong><span>need shape / recovery</span></article>
                <article><strong>{changingZoneCount}</strong><span>areas changing</span></article>
                <article><strong>{formatCareMinutes(care.effort.knownCareMinutes)}</strong><span>known care effort</span></article>
                <article><strong>{care.observationCoverage.coveredPercent}%</strong><span>condition coverage</span></article>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-state-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Farm condition</span><h2>{care.objectCount} maintainable places</h2></div>
                  <b>{care.zoneCount} areas</b>
                </header>
                <div className="atlas-farm-care-state-grid">
                  {CARE_STATE_ROWS.map((row) => (
                    <article key={row.key} className={careStateClass(row.state)}>
                      <strong>{care.stateCounts[row.key]}</strong><span>{row.label}</span><small>{row.quietLabel}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-coverage-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Observation coverage</span><h2>What Atlas actually knows</h2></div><b>{care.observationCoverage.coveredPercent}%</b>
                </header>
                <div className="atlas-farm-care-coverage-grid">
                  <article><strong>{care.observationCoverage.observed}</strong><span>Observed</span></article>
                  <article><strong>{care.observationCoverage.estimated}</strong><span>Estimated</span></article>
                  <article><strong>{care.observationCoverage.stale}</strong><span>Stale</span></article>
                  <article><strong>{care.observationCoverage.needsObservation}</strong><span>Need observation</span></article>
                </div>
                <p>Unknown means the place needs a current look. It does not mean the place is failing.</p>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-changing-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Movement</span><h2>Areas changing</h2></div><b>{areasChanging.length}</b>
                </header>
                {areasChanging.length ? <div className="atlas-farm-care-change-list">{areasChanging.map((zone) => <AreaChangeRow key={zone.zoneId} zone={zone} />)}</div> : <p className="atlas-farm-care-empty-line">No verified area movement yet.</p>}
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-wins-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Recorded momentum</span><h2>Recent wins</h2></div><b>{care.recentWins.length}</b>
                </header>
                {care.recentWins.length ? (
                  <div className="atlas-farm-care-win-list">
                    {care.recentWins.map((win) => (
                      <article key={win.historyId}><strong>{win.objectLabel}</strong><span>{win.zoneLabel || "Elm Farm"} · {prettyCareDate(win.occurredAt)}</span><p>{win.previousStateLabel ? `${win.previousStateLabel} → ` : ""}{win.resultingStateLabel}</p></article>
                    ))}
                  </div>
                ) : <p className="atlas-farm-care-empty-line">No verified care transition has been recorded yet.</p>}
              </section>

              <section className="atlas-farm-care-area-section" aria-label="Farm areas">
                <header className="atlas-farm-care-section-header atlas-farm-care-area-heading">
                  <div><span>Farm → area</span><h2>All farm areas</h2></div><b>{care.zones.length}</b>
                </header>
                <div className="atlas-farm-care-area-list">{care.zones.map((zone) => <AreaCard key={zone.zoneId} zone={zone} />)}</div>
              </section>

              <p className="atlas-farm-care-generated">Condition prepared {prettyCareDate(care.generatedAt)} · open an area to see its places, interventions, and history.</p>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
