"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  careStateClass,
  fetchFarmCareZone,
  formatCareMinutes,
  humanizeCareValue,
  prettyCareDate,
  type CareHistoryEvent,
  type CareState,
  type FarmCareObject,
  type FarmCareZone,
  type ReleasedIntervention,
} from "@/lib/atlas/farm-care-client";

type GroupDefinition = {
  key: string;
  label: string;
  states: CareState[];
  calm?: boolean;
  collapsed?: boolean;
};

const GROUPS: GroupDefinition[] = [
  { key: "recovery", label: "Recovery needed", states: ["recovery_needed"] },
  { key: "shape", label: "Losing shape", states: ["losing_shape"] },
  { key: "tending", label: "Needs tending", states: ["needs_tending", "stirring"] },
  { key: "decision", label: "Decision needed", states: ["decision_needed"] },
  { key: "unknown", label: "Needs observation", states: ["unknown"] },
  { key: "resting", label: "Resting / suppressed", states: ["resting", "suppressed"], calm: true },
  { key: "settled", label: "Settled", states: ["settled"], collapsed: true, calm: true },
];

function reasonText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["reason", "note", "basis"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return "";
}

function riskSentence(zone: FarmCareZone) {
  const risks = [
    zone.risks.production ? `${zone.risks.production} production` : "",
    zone.risks.presentation ? `${zone.risks.presentation} presentation` : "",
    zone.risks.accessOrEstablishment ? `${zone.risks.accessOrEstablishment} access / establishment` : "",
    zone.risks.spread ? `${zone.risks.spread} spread` : "",
  ].filter(Boolean);

  if (zone.careState === "resting") return "This area is intentionally resting and is not overdue.";
  if (zone.careState === "suppressed") return "The current holding strategy is controlling pressure.";
  if (risks.length) return `At risk: ${risks.join(" · ")}`;
  if (zone.observationCoverage.unknownOrStale) return "Current risk is partly unknown until the remaining places are observed.";
  return "No verified active risk.";
}

function objectHref(zoneKey: string, objectKey: string) {
  return `/collections/weeding/${encodeURIComponent(zoneKey)}/${encodeURIComponent(objectKey)}`;
}

function ObjectRow({ zoneKey, object }: { zoneKey: string; object: FarmCareObject }) {
  const context = [
    object.careTrend === "unknown" ? "Trend unknown" : object.careTrendLabel,
    object.carePressure ? `${humanizeCareValue(object.carePressure)} pressure` : "",
    object.estimatedEffortMinutes ? formatCareMinutes(object.estimatedEffortMinutes) : "",
  ].filter(Boolean).join(" · ");

  return (
    <Link className={`atlas-farm-care-object-row ${careStateClass(object.careState)}`} href={objectHref(zoneKey, object.objectKey)}>
      <div>
        <strong>{object.objectLabel}</strong>
        <span>{context}</span>
        <p>{object.nextValidAction}</p>
      </div>
      <b>{object.careStateLabel}</b>
      <em aria-hidden="true">›</em>
    </Link>
  );
}

function InterventionCard({
  intervention,
  zoneKey,
  objects,
}: {
  intervention: ReleasedIntervention;
  zoneKey: string;
  objects: FarmCareObject[];
}) {
  const targetIds = new Set(intervention.objectIds ?? []);
  const targets = objects.filter((object) => targetIds.has(object.objectId));

  return (
    <article className="atlas-farm-care-intervention-card">
      <header>
        <div>
          <span>Released care</span>
          <strong>{intervention.title}</strong>
        </div>
        <b>{intervention.dueDate ? prettyCareDate(intervention.dueDate) : "Open"}</b>
      </header>
      {intervention.desiredResult ? <p>{intervention.desiredResult}</p> : null}
      {intervention.doneDefinition ? (
        <section><span>Done means</span><p>{intervention.doneDefinition}</p></section>
      ) : null}
      {targets.length ? (
        <div className="atlas-farm-care-target-links">
          {targets.map((object) => (
            <Link key={object.objectKey} href={objectHref(zoneKey, object.objectKey)}>{object.objectLabel}</Link>
          ))}
        </div>
      ) : null}
      <footer>
        <span>{formatCareMinutes(intervention.estimatedMinutes)}</span>
        <Link href={`/task?taskId=${encodeURIComponent(intervention.taskId)}`}>Open task</Link>
      </footer>
    </article>
  );
}

function HistoryRow({ event }: { event: CareHistoryEvent }) {
  const transition = event.previousStateLabel
    ? `${event.previousStateLabel} → ${event.resultingStateLabel || "Updated"}`
    : event.resultingStateLabel || "Care state updated";
  const note = reasonText(event.reason);

  return (
    <article className="atlas-farm-care-history-row">
      <div>
        <strong>{event.objectLabel || "Area care"}</strong>
        <span>{transition}</span>
        {note ? <p>{note}</p> : null}
      </div>
      <time>{prettyCareDate(event.occurredAt)}</time>
    </article>
  );
}

export default function FarmCareZonePage() {
  const params = useParams<{ zoneKey: string }>();
  const zoneKey = params.zoneKey;
  const [zone, setZone] = useState<FarmCareZone | null>(null);
  const [role, setRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchFarmCareZone(zoneKey);
        if (!response.zone) throw new Error("Atlas could not load this farm area.");
        setZone(response.zone);
        setRole(response.role ?? "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Atlas could not load this farm area.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [zoneKey]);

  const allObjects = useMemo(() => {
    if (!zone?.objectGroups) return [];
    const seen = new Set<string>();
    return Object.values(zone.objectGroups)
      .flatMap((objects) => objects ?? [])
      .filter((object) => {
        if (seen.has(object.objectId)) return false;
        seen.add(object.objectId);
        return true;
      });
  }, [zone]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-farm-care-page-shell atlas-farm-care-drilldown-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/collections/weeding" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Farm Care</span>
            <span className="atlas-phone-title">Area</span>
          </Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href="/collections/weeding" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to Farm Care">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-farm-care-body atlas-farm-care-drilldown-body">
          {loading ? <div className="atlas-task-page-empty">Loading area care…</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          {!loading && zone ? (
            <>
              <section className={`atlas-overview-hero atlas-farm-care-zone-hero ${careStateClass(zone.careState)}`}>
                <div>
                  <span>{humanizeCareValue(zone.zoneMode)}</span>
                  <strong>{zone.zoneLabel}</strong>
                </div>
                <p>{zone.purpose || "Purpose not yet recorded."}</p>
                <footer>
                  <b>{zone.careStateLabel}</b>
                  <span>{zone.careTrend === "unknown" ? "Trend unknown" : zone.careTrendLabel}</span>
                </footer>
              </section>

              <section className="atlas-overview-stat-grid atlas-farm-care-zone-stats" aria-label={`${zone.zoneLabel} condition`}>
                <article><strong>{zone.objectCount}</strong><span>places</span></article>
                <article><strong>{zone.observationCoverage.reliable}</strong><span>current readings</span></article>
                <article><strong>{zone.observationCoverage.unknownOrStale}</strong><span>need observation</span></article>
                <article><strong>{formatCareMinutes(zone.estimatedCareMinutes)}</strong><span>known effort</span></article>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-zone-purpose-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Purpose and finish</span><h2>What this area is for</h2></div>
                  <b>{zone.careStateLabel}</b>
                </header>
                <div className="atlas-farm-care-copy-block">
                  <p>{zone.purpose || "Purpose not yet recorded."}</p>
                  {zone.intendedFinish && zone.intendedFinish !== zone.purpose ? (
                    <section><span>Intended finish</span><p>{zone.intendedFinish}</p></section>
                  ) : null}
                  <strong>{riskSentence(zone)}</strong>
                </div>
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-zone-strategy-panel">
                <header className="atlas-farm-care-section-header">
                  <div><span>Strategy and season</span><h2>How this place is being held</h2></div>
                  <b>{humanizeCareValue(zone.zoneMode)}</b>
                </header>
                <div className="atlas-farm-care-strategy-list">
                  {zone.strategySummary.map((strategy) => (
                    <article key={strategy.strategy}>
                      <strong>{strategy.label}</strong>
                      <span>{strategy.objectCount} {strategy.objectCount === 1 ? "place" : "places"}</span>
                    </article>
                  ))}
                </div>
                <p className="atlas-farm-care-panel-note">Next move: {zone.nextMove || "Record a current care observation."}</p>
              </section>

              <section className="atlas-farm-care-zone-groups" aria-label={`${zone.zoneLabel} places grouped by condition`}>
                <header className="atlas-farm-care-section-header atlas-farm-care-area-heading">
                  <div><span>Area → place</span><h2>Places by condition</h2></div>
                  <b>{allObjects.length}</b>
                </header>
                {GROUPS.map((group) => {
                  const objects = group.states.flatMap((state) => zone.objectGroups?.[state] ?? []);
                  if (!objects.length) return null;
                  return (
                    <details key={group.key} className={`atlas-farm-care-object-group${group.calm ? " calm" : ""}`} open={!group.collapsed}>
                      <summary><strong>{group.label}</strong><b>{objects.length}</b></summary>
                      <div>{objects.map((object) => <ObjectRow key={object.objectId} zoneKey={zone.zoneKey} object={object} />)}</div>
                    </details>
                  );
                })}
              </section>

              <section className="atlas-farm-care-panel atlas-farm-care-zone-interventions">
                <header className="atlas-farm-care-section-header">
                  <div><span>Current intervention</span><h2>Released care in context</h2></div>
                  <b>{zone.releasedInterventions?.length ?? 0}</b>
                </header>
                {zone.releasedInterventions?.length ? (
                  <div className="atlas-farm-care-intervention-list">
                    {zone.releasedInterventions.map((intervention) => (
                      <InterventionCard key={intervention.taskId} intervention={intervention} zoneKey={zone.zoneKey} objects={allObjects} />
                    ))}
                  </div>
                ) : <p className="atlas-farm-care-empty-line">No executable care is currently released for this area.</p>}
              </section>

              {zone.plannedRecommendations?.length ? (
                <section className="atlas-farm-care-panel atlas-farm-care-planned-panel">
                  <header className="atlas-farm-care-section-header">
                    <div><span>Prepared, not released</span><h2>Legacy recommendations</h2></div>
                    <b>{zone.plannedRecommendations.length}</b>
                  </header>
                  <div className="atlas-farm-care-planned-list">
                    {zone.plannedRecommendations.map((item) => (
                      <article key={item.occurrenceId}>
                        <strong>{item.title}</strong>
                        <span>{item.plannedDueDate ? prettyCareDate(item.plannedDueDate) : "No planned date"} · {formatCareMinutes(item.estimatedMinutes)}</span>
                        {item.desiredResult ? <p>{item.desiredResult}</p> : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="atlas-farm-care-panel atlas-farm-care-zone-history">
                <header className="atlas-farm-care-section-header">
                  <div><span>History and momentum</span><h2>What changed here</h2></div>
                  <b>{zone.history?.length ?? 0}</b>
                </header>
                {zone.history?.length ? (
                  <div className="atlas-farm-care-history-list">{zone.history.map((event) => <HistoryRow key={event.historyId} event={event} />)}</div>
                ) : <p className="atlas-farm-care-empty-line">No care-state movement has been recorded for this area yet.</p>}
              </section>

              <nav className="atlas-farm-care-breadcrumb-footer" aria-label="Farm Care navigation">
                <Link href="/collections/weeding">Farm Care</Link>
                <span>{zone.zoneLabel}</span>
                {role ? <b>{humanizeCareValue(role)}</b> : null}
              </nav>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
