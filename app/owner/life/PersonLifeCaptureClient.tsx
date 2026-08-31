"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./person-life.module.css";

type Subject = { domain?: string; kind?: string; id?: string };
type Requirement = {
  requirementKey?: string;
  evidenceSelector?: { subject?: Subject };
  policy?: {
    actionSpec?: {
      effectKind?: string;
      target?: { kind?: string; goalDefinitionId?: string; goalRequirementKey?: string };
    };
  };
};

type LifeDefinition = {
  definitionId: string;
  signalKind: string;
  status: string;
  subject?: Subject;
  lifeSignal?: {
    subject?: Subject;
    state?: Record<string, unknown>;
    requirements?: Requirement[];
    ambiguities?: unknown[];
  };
  latestEvent?: {
    evaluation?: Record<string, unknown>;
  } | null;
};

type ConsequenceInstance = {
  instanceId: string;
  definitionId?: string;
  consequenceRole: string;
  actionKey?: string | null;
  carrierState: string;
  placementState: string;
  executionReadiness: string;
  status: string;
  evidence?: Record<string, unknown> | null;
};

type ConditionRow = {
  subject_domain: string;
  subject_kind: string;
  subject_id: string;
  condition_state: string;
  disposition: string;
  last_observed_at: string;
  metadata?: Record<string, unknown> | null;
};

type RhythmOpportunity = {
  opportunityId: string;
  bindingId: string;
  rhythmDefinitionId: string;
  localDate: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  projectionState: "projected" | "satisfied" | "elapsed" | "withdrawn";
  presentationState: "base" | "adapted" | "held" | "withdrawn";
  basePresentation?: Record<string, unknown>;
  presentationOverlay?: Record<string, unknown>;
  effectivePresentation?: Record<string, unknown>;
  planClaimId: string;
  planEvidenceId: string;
  satisfaction?: {
    evidenceId?: string;
    claimId?: string;
    eventId?: string;
    satisfiedAt?: string;
  } | null;
  presentationProvenance?: {
    consequenceInstanceId?: string;
    consequenceEventId?: string;
    appliedAt?: string;
  } | null;
};

type PersonClaim = {
  claimId: string;
  subject?: Subject;
  claimType: string;
  lifecycleState: string;
  authorityKind?: string;
  value?: Record<string, unknown> | null;
  primaryEvidenceId?: string;
  validFrom?: string | null;
};

type LifeStateResponse = {
  ok: boolean;
  error?: string;
  personLife?: {
    definitions?: LifeDefinition[];
    consequenceInstances?: ConsequenceInstance[];
    truthBoundary?: Record<string, unknown>;
  } | null;
  rhythmOpportunities?: RhythmOpportunity[];
  currentClaims?: PersonClaim[];
  conditions?: ConditionRow[];
};

type RunDraft = { distance: string; observedAt: string };

const FIVE_K_REQUIREMENT_KEY = "complete_5k";

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function goalLabel(definition: LifeDefinition) {
  const state = definition.lifeSignal?.state ?? {};
  const explicit = state.explicitUserEnd;
  return typeof explicit === "string" && explicit.trim() ? explicit : "Unnamed personal goal";
}

function goalState(definition: LifeDefinition) {
  const state = definition.latestEvent?.evaluation?.state;
  if (typeof state === "string") return humanize(state);
  return definition.status === "active" ? "defined" : definition.status;
}

function isFiveKGoal(definition: LifeDefinition) {
  if (definition.signalKind !== "goal" || definition.status !== "active") return false;
  return /\b5\s*k\b/i.test(goalLabel(definition)) || /\b5\s*kilomet(er|re)s?\b/i.test(goalLabel(definition));
}

function hasFiveKMeasurement(definition: LifeDefinition | null) {
  return Boolean(definition?.lifeSignal?.requirements?.some((item) => item.requirementKey === FIVE_K_REQUIREMENT_KEY));
}

function runSubjectForGoal(definition: LifeDefinition | null) {
  const requirement = definition?.lifeSignal?.requirements?.find((item) => item.requirementKey === FIVE_K_REQUIREMENT_KEY);
  return requirement?.evidenceSelector?.subject ?? null;
}

function isGuardrailForGoal(definition: LifeDefinition, goalDefinitionId: string) {
  if (definition.signalKind !== "consequence" || definition.status !== "active") return false;
  return Boolean(definition.lifeSignal?.requirements?.some((requirement) => {
    const action = requirement.policy?.actionSpec;
    return action?.effectKind === "rhythm_opportunity_presentation_overlay"
      && action.target?.kind === "goal_requirement_next_opportunity"
      && action.target.goalDefinitionId === goalDefinitionId
      && action.target.goalRequirementKey === FIVE_K_REQUIREMENT_KEY;
  }));
}

function sameSubject(left?: Subject | null, right?: Subject | null) {
  return Boolean(left?.domain && left.kind && left.id
    && left.domain === right?.domain
    && left.kind === right?.kind
    && left.id === right?.id);
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function shortId(value?: string | null) {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function toIso(localValue: string) {
  if (!localValue) return "";
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function sourceStamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

export default function PersonLifeCaptureClient({ personName }: { personName: string }) {
  const [state, setState] = useState<LifeStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});

  const refresh = useCallback(async () => {
    const response = await fetch("/api/atlas/person-life", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as LifeStateResponse | null;
    setState(payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const definitions = state?.personLife?.definitions ?? [];
  const goals = useMemo(
    () => definitions.filter((definition) => definition.signalKind === "goal"),
    [definitions],
  );
  const activeFiveK = useMemo(
    () => definitions.filter(isFiveKGoal).at(-1) ?? null,
    [definitions],
  );
  const measurementAccepted = hasFiveKMeasurement(activeFiveK);
  const runSubject = runSubjectForGoal(activeFiveK);
  const guardrailAccepted = Boolean(activeFiveK && definitions.some((definition) => isGuardrailForGoal(definition, activeFiveK.definitionId)));

  const acceptedPlanClaims = useMemo(() => {
    if (!activeFiveK) return [];
    return (state?.currentClaims ?? []).filter((claim) => {
      if (claim.claimType !== "goal_rhythm_plan" || claim.lifecycleState !== "accepted") return false;
      return claim.value?.goalDefinitionId === activeFiveK.definitionId
        && claim.value?.goalRequirementKey === FIVE_K_REQUIREMENT_KEY;
    });
  }, [activeFiveK, state?.currentClaims]);
  const acceptedPlanIds = useMemo(() => new Set(acceptedPlanClaims.map((claim) => claim.claimId)), [acceptedPlanClaims]);
  const rhythmAccepted = acceptedPlanClaims.length > 0;

  const opportunities = useMemo(
    () => (state?.rhythmOpportunities ?? [])
      .filter((item) => acceptedPlanIds.has(item.planClaimId) && item.projectionState !== "withdrawn")
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [acceptedPlanIds, state?.rhythmOpportunities],
  );

  const runClaims = useMemo(
    () => (state?.currentClaims ?? []).filter((claim) =>
      claim.claimType === "run_distance"
      && claim.lifecycleState === "observed"
      && sameSubject(claim.subject, runSubject)),
    [runSubject, state?.currentClaims],
  );
  const bestDistance = runClaims.reduce((best, claim) => {
    const distance = Number(claim.value?.distanceKm);
    return Number.isFinite(distance) ? Math.max(best, distance) : best;
  }, 0);
  const satisfiedCount = opportunities.filter((item) => item.projectionState === "satisfied").length;
  const progress = Math.min(100, Math.max(0, (bestDistance / 5) * 100));

  const openConsequences = useMemo(
    () => (state?.personLife?.consequenceInstances ?? []).filter((item) => item.status === "open"),
    [state],
  );
  const conditions = state?.conditions ?? [];
  const kneeObservation = conditions.find((condition) =>
    condition.subject_domain === "body"
    && condition.subject_kind === "body_region"
    && condition.subject_id === "right_knee"
    && condition.condition_state === "aching_after_mile_2");

  const post = useCallback(async (key: string, payload: Record<string, unknown>, success: string) => {
    setWorking(key);
    setError("");
    setFeedback("");
    try {
      const response = await fetch("/api/atlas/person-life", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        setError(result?.error ?? "Atlas could not save that change.");
        return false;
      }
      setFeedback(success);
      await refresh();
      return true;
    } finally {
      setWorking("");
    }
  }, [refresh]);

  const acceptMeasurement = async () => {
    if (!activeFiveK) return;
    await post("measurement", {
      action: "accept_five_k_measurement",
      sourceKey: `person-life-5k:${activeFiveK.definitionId}:measurement-v1`,
      goalDefinitionId: activeFiveK.definitionId,
      acceptedAt: new Date().toISOString(),
    }, "5 km is now an explicitly accepted measurement for this Goal.");
  };

  const acceptRhythm = async () => {
    if (!activeFiveK) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
    await post("rhythm", {
      action: "accept_five_k_rhythm",
      sourceKey: `person-life-5k:${activeFiveK.definitionId}:rhythm-v1`,
      goalDefinitionId: activeFiveK.definitionId,
      acceptedAt: new Date().toISOString(),
      timezone,
      weekdays: [1, 3, 5],
      localStartTime: "17:00",
      windowMinutes: 90,
    }, "The Monday / Wednesday / Friday run rhythm is now explicitly accepted.");
  };

  const acceptGuardrail = async () => {
    if (!activeFiveK) return;
    await post("guardrail", {
      action: "accept_five_k_guardrail",
      sourceKey: `person-life-5k:${activeFiveK.definitionId}:right-knee-guardrail-v1`,
      goalDefinitionId: activeFiveK.definitionId,
      acceptedAt: new Date().toISOString(),
    }, "The knee-response policy is now separately accepted.");
  };

  const recordKneeObservation = async () => {
    if (!activeFiveK) return;
    await post("knee", {
      action: "record_five_k_knee_observation",
      sourceKey: `person-life-5k:${activeFiveK.definitionId}:knee:${sourceStamp()}`,
      goalDefinitionId: activeFiveK.definitionId,
      observedAt: new Date().toISOString(),
    }, guardrailAccepted
      ? "The knee observation was recorded. Atlas evaluated only the already-accepted response policy."
      : "The knee observation was recorded without creating a response rule.");
  };

  const recordRun = async (opportunity: RhythmOpportunity) => {
    if (!activeFiveK) return;
    const draft = runDrafts[opportunity.opportunityId] ?? { distance: "", observedAt: "" };
    const distance = Number(draft.distance);
    const observedAt = toIso(draft.observedAt);
    if (!Number.isFinite(distance) || distance <= 0 || !observedAt) {
      setError("Enter the distance and the time you actually ran before logging this run.");
      return;
    }
    const ok = await post(`run:${opportunity.opportunityId}`, {
      action: "record_five_k_run",
      sourceKey: `person-life-5k:${activeFiveK.definitionId}:run:${opportunity.opportunityId}:${observedAt}`,
      goalDefinitionId: activeFiveK.definitionId,
      opportunityId: opportunity.opportunityId,
      distanceKm: distance,
      observedAt,
    }, "Run Evidence recorded; the same Evidence updated Rhythm satisfaction and reevaluated the Goal.");
    if (ok) {
      setRunDrafts((current) => ({ ...current, [opportunity.opportunityId]: { distance: "", observedAt: "" } }));
    }
  };

  return (
    <main className={styles.root}>
      <section className={styles.page}>
        <header className={styles.chrome}>
          <div>
            <span>personal atlas</span>
            <strong>{personName}</strong>
          </div>
          <Link href="/owner" aria-label="Return to Today">← today</Link>
        </header>

        <div className={styles.spread}>
          <section className={styles.capturePage}>
            <header className={styles.pageHeader}>
              <span>CAPTURE</span>
              <h1>What changed?</h1>
              <p>Tell Atlas only what you know. Acceptance and observation stay visibly separate.</p>
            </header>

            <nav className={styles.captureActions} aria-label="Personal Atlas capture instruments">
              <Link href="/owner/input/person-goal">
                <span>Goal</span>
                <strong>What do you want to make true?</strong>
                <small>Records your chosen end. No training plan, rhythm, task, or Clock placement is inferred.</small>
                <b aria-hidden="true">›</b>
              </Link>
              <Link href="/owner/input/body-observation">
                <span>Body observation</span>
                <strong>What did you notice?</strong>
                <small>Records first-party evidence. Cause, diagnosis, consequence, and treatment remain unestablished.</small>
                <b aria-hidden="true">›</b>
              </Link>
            </nav>

            {activeFiveK ? (
              <section className={styles.notebook}>
                <div className={styles.notebookHeading}>
                  <span>5K NOTEBOOK</span>
                  <h2>{goalLabel(activeFiveK)}</h2>
                  <p>The Goal stays simple. Each extra authority below exists only after you accept it.</p>
                </div>

                <div className={styles.acceptanceList}>
                  <article className={styles.acceptanceCard} data-complete={measurementAccepted ? "true" : "false"}>
                    <span>01 · measurement</span>
                    <strong>5 km counts as completion.</strong>
                    <p>This is not inferred from the letters “5K.” It becomes a Goal requirement only when you accept the measurement.</p>
                    {measurementAccepted ? <b>accepted ✓</b> : (
                      <button type="button" disabled={Boolean(working)} onClick={() => void acceptMeasurement()}>
                        {working === "measurement" ? "accepting…" : "Accept 5 km measurement"}
                      </button>
                    )}
                  </article>

                  <article className={styles.acceptanceCard} data-complete={rhythmAccepted ? "true" : "false"}>
                    <span>02 · rhythm</span>
                    <strong>Mon / Wed / Fri · 5:00 PM · 90 min.</strong>
                    <p>These are opportunity windows, not Tasks and not Principal Clock placements.</p>
                    {rhythmAccepted ? <b>accepted ✓</b> : (
                      <button type="button" disabled={Boolean(working) || !measurementAccepted} onClick={() => void acceptRhythm()}>
                        {working === "rhythm" ? "accepting…" : "Accept this run rhythm"}
                      </button>
                    )}
                  </article>

                  <article className={styles.acceptanceCard} data-complete={guardrailAccepted ? "true" : "false"}>
                    <span>03 · response policy</span>
                    <strong>If I report right-knee aching after mile 2, make the next run recovery-paced.</strong>
                    <p>The observation never invents this rule. The exact presentation-only response is separately person-authorized.</p>
                    {guardrailAccepted ? <b>accepted ✓</b> : (
                      <button type="button" disabled={Boolean(working) || !measurementAccepted} onClick={() => void acceptGuardrail()}>
                        {working === "guardrail" ? "accepting…" : "Accept this knee response"}
                      </button>
                    )}
                  </article>
                </div>

                {feedback ? <p className={styles.feedback}>{feedback}</p> : null}
                {error ? <p className={styles.error}>{error}</p> : null}
              </section>
            ) : (
              <aside className={styles.captureBoundary}>
                <strong>No active 5K Goal yet.</strong>
                <span>Capture “I want to run a 5K” as a Goal first. Atlas will not manufacture the rest from that sentence.</span>
              </aside>
            )}

            <aside className={styles.captureBoundary}>
              <strong>Capture is evidence, not instruction.</strong>
              <span>Atlas may preserve what you report without silently turning it into something you should do.</span>
            </aside>
          </section>

          <section className={styles.statePage} aria-busy={loading}>
            <header className={styles.pageHeader}>
              <span>KNOWN NOW</span>
              <h2>Your person-owned state</h2>
              <p>Private by default. Evidence, accepted rules, and schedule projections keep their own provenance.</p>
            </header>

            {loading ? <p className={styles.quiet}>Reading Atlas…</p> : null}
            {!loading && state?.error ? <p className={styles.error}>{state.error}</p> : null}

            {activeFiveK && measurementAccepted ? (
              <section className={styles.progressCard}>
                <div className={styles.progressTopline}>
                  <span>5K PROGRESS</span>
                  <strong>{bestDistance ? `${bestDistance.toFixed(2)} km` : "no run distance yet"}</strong>
                </div>
                <div className={styles.progressTrack} aria-label={`${Math.round(progress)} percent of 5 km`}>
                  <i style={{ width: `${progress}%` }} />
                </div>
                <p>{satisfiedCount} accepted run window{satisfiedCount === 1 ? "" : "s"} satisfied by canonical Evidence.</p>
              </section>
            ) : null}

            {activeFiveK && rhythmAccepted ? (
              <section className={styles.stateGroup}>
                <h3>Upcoming runs</h3>
                {opportunities.length ? opportunities.map((opportunity) => {
                  const presentation = opportunity.effectivePresentation ?? opportunity.basePresentation ?? {};
                  const label = typeof presentation.label === "string" ? presentation.label : "5K training run";
                  const guidance = typeof presentation.guidance === "string" ? presentation.guidance : "";
                  const draft = runDrafts[opportunity.opportunityId] ?? { distance: "", observedAt: "" };
                  const isSatisfied = opportunity.projectionState === "satisfied";
                  const isWorking = working === `run:${opportunity.opportunityId}`;
                  return (
                    <article key={opportunity.opportunityId} className={styles.runCard} data-adapted={opportunity.presentationState === "adapted" ? "true" : "false"}>
                      <div className={styles.runHeader}>
                        <div>
                          <span>{formatWhen(opportunity.startsAt)}</span>
                          <strong>{label}</strong>
                        </div>
                        <b>{humanize(opportunity.projectionState)}</b>
                      </div>
                      {guidance ? <p>{guidance}</p> : null}

                      {!isSatisfied && opportunity.projectionState === "projected" ? (
                        <div className={styles.runLog}>
                          <label>
                            <span>distance · km</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              inputMode="decimal"
                              value={draft.distance}
                              onChange={(event) => setRunDrafts((current) => ({
                                ...current,
                                [opportunity.opportunityId]: { ...draft, distance: event.target.value },
                              }))}
                            />
                          </label>
                          <label>
                            <span>when you ran</span>
                            <input
                              type="datetime-local"
                              value={draft.observedAt}
                              onChange={(event) => setRunDrafts((current) => ({
                                ...current,
                                [opportunity.opportunityId]: { ...draft, observedAt: event.target.value },
                              }))}
                            />
                          </label>
                          <button type="button" disabled={Boolean(working)} onClick={() => void recordRun(opportunity)}>
                            {isWorking ? "recording…" : "Log this run"}
                          </button>
                          <small>Recorded time must fall inside this accepted window. Atlas will not fabricate execution from the window itself.</small>
                        </div>
                      ) : null}

                      <details className={styles.provenance}>
                        <summary>Why is this here{opportunity.presentationState === "adapted" ? " / why did it change" : ""}?</summary>
                        <dl>
                          <div><dt>accepted plan Claim</dt><dd>{shortId(opportunity.planClaimId)}</dd></div>
                          <div><dt>plan Evidence</dt><dd>{shortId(opportunity.planEvidenceId)}</dd></div>
                          {opportunity.satisfaction ? <>
                            <div><dt>run Evidence</dt><dd>{shortId(opportunity.satisfaction.evidenceId)}</dd></div>
                            <div><dt>Rhythm event</dt><dd>{shortId(opportunity.satisfaction.eventId)}</dd></div>
                          </> : null}
                          {opportunity.presentationProvenance ? <>
                            <div><dt>Consequence</dt><dd>{shortId(opportunity.presentationProvenance.consequenceInstanceId)}</dd></div>
                            <div><dt>authorized evaluation</dt><dd>{shortId(opportunity.presentationProvenance.consequenceEventId)}</dd></div>
                          </> : null}
                        </dl>
                        <p>{opportunity.presentationState === "adapted"
                          ? "The base accepted plan is preserved. Only the separately authorized presentation overlay changed."
                          : "This window comes from the accepted Rhythm plan; it carries no Task or Clock authority."}</p>
                      </details>
                    </article>
                  );
                }) : <p className={styles.quiet}>No current windows are projected from the accepted plan.</p>}
              </section>
            ) : null}

            {activeFiveK ? (
              <section className={styles.stateGroup}>
                <h3>Knee observation flow</h3>
                {kneeObservation ? (
                  <article className={styles.stateRow}>
                    <strong>right knee · aching after mile 2</strong>
                    <span>observed {formatWhen(kneeObservation.last_observed_at)} · {kneeObservation.disposition === "observe" ? "observation only" : humanize(kneeObservation.disposition)}</span>
                  </article>
                ) : <p className={styles.quiet}>No matching right-knee observation is currently recorded.</p>}
                <button className={styles.inlineButton} type="button" disabled={Boolean(working)} onClick={() => void recordKneeObservation()}>
                  {working === "knee" ? "recording…" : "Record: right knee aching after mile 2"}
                </button>
                <p className={styles.microcopy}>{guardrailAccepted
                  ? "Because the response policy is already accepted, Atlas may evaluate this Evidence against that exact rule and adapt only the next projected run if it matches."
                  : "Without an accepted response policy, this remains observation only."}</p>
              </section>
            ) : null}

            <section className={styles.stateGroup}>
              <h3>Goals</h3>
              {goals.length ? goals.map((goal) => (
                <article key={goal.definitionId} className={styles.stateRow}>
                  <strong>{goalLabel(goal)}</strong>
                  <span>{goalState(goal)}</span>
                </article>
              )) : <p className={styles.quiet}>No personal goals recorded here yet.</p>}
            </section>

            <section className={styles.stateGroup}>
              <h3>Body observations</h3>
              {conditions.length ? conditions.map((condition) => (
                <article key={`${condition.subject_domain}:${condition.subject_kind}:${condition.subject_id}`} className={styles.stateRow}>
                  <strong>{humanize(condition.subject_id)} · {humanize(condition.condition_state)}</strong>
                  <span>{condition.disposition === "observe" ? "observation only" : humanize(condition.disposition)}</span>
                </article>
              )) : <p className={styles.quiet}>No first-party condition observations recorded here yet.</p>}
            </section>

            <section className={styles.stateGroup}>
              <h3>Open consequences</h3>
              {openConsequences.length ? openConsequences.map((item) => (
                <article key={item.instanceId} className={styles.stateRow}>
                  <strong>{humanize(item.actionKey ?? item.consequenceRole)}</strong>
                  <span>{humanize(item.carrierState)} carrier · {humanize(item.placementState)} placement</span>
                </article>
              )) : <p className={styles.quiet}>Nothing has earned an operational consequence here.</p>}
            </section>

            <footer className={styles.boundary}>
              <strong>Atlas has not been granted Clock authority from this spread.</strong>
              <span>Rhythm opportunities are not Tasks. Evidence does not become work merely because it exists.</span>
            </footer>
          </section>
        </div>
      </section>
    </main>
  );
}
