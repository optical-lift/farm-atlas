"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { atlasInputValueFromDraft } from "@/lib/atlas/input-contract";
import { selectCatalogPersonLifeNotebook } from "@/lib/atlas/person-life-notebook-catalog.js";
import styles from "./person-life.module.css";

type Subject = { domain?: string; kind?: string; id?: string };

type LifeDefinition = {
  definitionId: string;
  signalKind: string;
  status: string;
  subject?: Subject;
  lifeSignal?: {
    subject?: Subject;
    state?: Record<string, unknown>;
    requirements?: Array<Record<string, unknown>>;
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

type EvidenceDraft = { value: string; observedAt: string };

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
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, EvidenceDraft>>({});

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
  const conditions = state?.conditions ?? [];
  const openConsequences = useMemo(
    () => (state?.personLife?.consequenceInstances ?? []).filter((item) => item.status === "open"),
    [state],
  );
  const notebook = useMemo(() => selectCatalogPersonLifeNotebook({
    definitions,
    currentClaims: state?.currentClaims ?? [],
    rhythmOpportunities: state?.rhythmOpportunities ?? [],
    conditions,
  }), [conditions, definitions, state?.currentClaims, state?.rhythmOpportunities]);

  const spec = notebook?.spec ?? null;
  const model = notebook?.model ?? null;
  const activeGoal = (model?.goal ?? null) as LifeDefinition | null;
  const opportunities = (model?.opportunities ?? []) as RhythmOpportunity[];
  const matchingCondition = (model?.matchingCondition ?? null) as ConditionRow | null;

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

  const acceptRequirement = async () => {
    if (!spec || !activeGoal) return;
    await post("requirement", {
      action: spec.api.acceptRequirementAction,
      sourceKey: `${spec.sourcePrefix}:${activeGoal.definitionId}:${spec.sourceKeys.requirement}`,
      goalDefinitionId: activeGoal.definitionId,
      acceptedAt: new Date().toISOString(),
    }, spec.requirement.acceptedFeedback);
  };
  const acceptRhythm = async () => {
    if (!spec || !activeGoal) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || spec.rhythm.defaults.fallbackTimezone;
    await post("rhythm", {
      action: spec.api.acceptRhythmAction,
      sourceKey: `${spec.sourcePrefix}:${activeGoal.definitionId}:${spec.sourceKeys.rhythm}`,
      goalDefinitionId: activeGoal.definitionId,
      acceptedAt: new Date().toISOString(),
      timezone,
      weekdays: spec.rhythm.defaults.weekdays,
      localStartTime: spec.rhythm.defaults.localStartTime,
      windowMinutes: spec.rhythm.defaults.windowMinutes,
    }, spec.rhythm.acceptedFeedback);
  };

  const acceptPolicy = async () => {
    if (!spec || !activeGoal) return;
    await post("policy", {
      action: spec.api.acceptPolicyAction,
      sourceKey: `${spec.sourcePrefix}:${activeGoal.definitionId}:${spec.sourceKeys.policy}`,
      goalDefinitionId: activeGoal.definitionId,
      acceptedAt: new Date().toISOString(),
    }, spec.policy.acceptedFeedback);
  };

  const recordCondition = async () => {
    if (!spec || !activeGoal || !model) return;
    await post("condition", {
      action: spec.api.recordConditionAction,
      sourceKey: `${spec.sourcePrefix}:${activeGoal.definitionId}:${spec.sourceKeys.condition}:${sourceStamp()}`,
      goalDefinitionId: activeGoal.definitionId,
      observedAt: new Date().toISOString(),
    }, model.policyAccepted ? spec.policy.authorizedFeedback : spec.policy.observationOnlyFeedback);
  };

  const recordEvidence = async (opportunity: RhythmOpportunity) => {
    if (!spec || !activeGoal) return;
    const draft = evidenceDrafts[opportunity.opportunityId] ?? { value: "", observedAt: "" };
    const inputField = spec.evidence.inputField;
    const evidenceValue = atlasInputValueFromDraft(inputField, draft.value);
    const observedAt = toIso(draft.observedAt);
    if (evidenceValue === null || !observedAt) {
      setError(spec.evidence.invalidDraftMessage);
      return;
    }
    const ok = await post(`evidence:${opportunity.opportunityId}`, {
      action: spec.api.recordEvidenceAction,
      sourceKey: `${spec.sourcePrefix}:${activeGoal.definitionId}:${spec.sourceKeys.evidence}:${opportunity.opportunityId}:${observedAt}`,
      goalDefinitionId: activeGoal.definitionId,
      opportunityId: opportunity.opportunityId,
      [inputField.id]: evidenceValue,
      observedAt,
    }, spec.evidence.recordedFeedback);
    if (ok) {
      setEvidenceDrafts((current) => ({
        ...current,
        [opportunity.opportunityId]: { value: "", observedAt: "" },
      }));
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

            {spec && model && activeGoal ? (
              <section className={styles.notebook} data-notebook={spec.id}>
                <div className={styles.notebookHeading}>
                  <span>{spec.heading.eyebrow}</span>
                  <h2>{goalLabel(activeGoal)}</h2>
                  <p>{spec.heading.intro}</p>
                </div>

                <div className={styles.acceptanceList}>
                  <article className={styles.acceptanceCard} data-complete={model.requirementAccepted ? "true" : "false"}>
                    <span>{spec.requirement.stepLabel}</span>
                    <strong>{spec.requirement.statement}</strong>
                    <p>{spec.requirement.explanation}</p>
                    {model.requirementAccepted ? <b>accepted ✓</b> : (
                      <button type="button" disabled={Boolean(working)} onClick={() => void acceptRequirement()}>
                        {working === "requirement" ? "accepting…" : spec.requirement.acceptLabel}
                      </button>
                    )}
                  </article>

                  <article className={styles.acceptanceCard} data-complete={model.rhythmAccepted ? "true" : "false"}>
                    <span>{spec.rhythm.stepLabel}</span>
                    <strong>{spec.rhythm.statement}</strong>
                    <p>{spec.rhythm.explanation}</p>
                    {model.rhythmAccepted ? <b>accepted ✓</b> : (
                      <button type="button" disabled={Boolean(working) || !model.requirementAccepted} onClick={() => void acceptRhythm()}>
                        {working === "rhythm" ? "accepting…" : spec.rhythm.acceptLabel}
                      </button>
                    )}
                  </article>

                  <article className={styles.acceptanceCard} data-complete={model.policyAccepted ? "true" : "false"}>
                    <span>{spec.policy.stepLabel}</span>
                    <strong>{spec.policy.statement}</strong>
                    <p>{spec.policy.explanation}</p>
                    {model.policyAccepted ? <b>accepted ✓</b> : (
                      <button type="button" disabled={Boolean(working) || !model.requirementAccepted} onClick={() => void acceptPolicy()}>
                        {working === "policy" ? "accepting…" : spec.policy.acceptLabel}
                      </button>
                    )}
                  </article>
                </div>

                {feedback ? <p className={styles.feedback}>{feedback}</p> : null}
                {error ? <p className={styles.error}>{error}</p> : null}
              </section>
            ) : (
              <aside className={styles.captureBoundary}>
                <strong>No guided Goal notebook is active.</strong>
                <span>Capture a Goal first. When a governed notebook adapter recognizes it, Atlas offers each additional authority separately instead of manufacturing a plan from the Goal sentence.</span>
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

            {spec && model && activeGoal && model.requirementAccepted ? (
              <section className={styles.progressCard}>
                <div className={styles.progressTopline}>
                  <span>{spec.evidence.progressHeading}</span>
                  <strong>{model.progressValue
                    ? `${model.progressValue.toFixed(2)} ${spec.evidence.unit}`
                    : spec.evidence.emptyMetricLabel}</strong>
                </div>
                <div
                  className={styles.progressTrack}
                  aria-label={`${Math.round(model.progressPercent)} percent of ${spec.evidence.targetValue} ${spec.evidence.unit}`}
                >
                  <i style={{ width: `${model.progressPercent}%` }} />
                </div>
                <p>
                  {model.satisfiedCount} accepted {spec.rhythm.acceptedWindowNoun}
                  {model.satisfiedCount === 1 ? "" : "s"} satisfied by canonical Evidence.
                </p>
              </section>
            ) : null}

            {spec && model && activeGoal && model.rhythmAccepted ? (
              <section className={styles.stateGroup}>
                <h3>{spec.rhythm.sectionTitle}</h3>
                {opportunities.length ? opportunities.map((opportunity) => {
                  const presentation = opportunity.effectivePresentation ?? opportunity.basePresentation ?? {};
                  const label = typeof presentation.label === "string"
                    ? presentation.label
                    : spec.rhythm.fallbackPresentationLabel;
                  const guidance = typeof presentation.guidance === "string" ? presentation.guidance : "";
                  const draft = evidenceDrafts[opportunity.opportunityId] ?? { value: "", observedAt: "" };
                  const inputField = spec.evidence.inputField;
                  const isSatisfied = opportunity.projectionState === "satisfied";
                  const isWorking = working === `evidence:${opportunity.opportunityId}`;
                  return (
                    <article
                      key={opportunity.opportunityId}
                      className={styles.runCard}
                      data-adapted={opportunity.presentationState === "adapted" ? "true" : "false"}
                    >
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
                            <span>{inputField.label}</span>
                            <input
                              type={inputField.primitive === "quantity" ? "number" : "text"}
                              min={inputField.primitive === "quantity" ? inputField.minimum : undefined}
                              step={inputField.primitive === "quantity" ? inputField.step : undefined}
                              inputMode={inputField.primitive === "quantity"
                                ? inputField.wholeNumber || (inputField.step ?? 1) >= 1 ? "numeric" : "decimal"
                                : undefined}
                              placeholder={inputField.primitive === "text" ? inputField.placeholder : undefined}
                              value={draft.value}
                              onChange={(event) => setEvidenceDrafts((current) => ({
                                ...current,
                                [opportunity.opportunityId]: { ...draft, value: event.target.value },
                              }))}
                            />
                          </label>
                          <label>
                            <span>{spec.evidence.timeInputLabel}</span>
                            <input
                              type="datetime-local"
                              value={draft.observedAt}
                              onChange={(event) => setEvidenceDrafts((current) => ({
                                ...current,
                                [opportunity.opportunityId]: { ...draft, observedAt: event.target.value },
                              }))}
                            />
                          </label>
                          <button type="button" disabled={Boolean(working)} onClick={() => void recordEvidence(opportunity)}>
                            {isWorking ? "recording…" : spec.evidence.logLabel}
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
                            <div><dt>{spec.evidence.provenanceLabel}</dt><dd>{shortId(opportunity.satisfaction.evidenceId)}</dd></div>
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

            {spec && model && activeGoal ? (
              <section className={styles.stateGroup}>
                <h3>{spec.policy.sectionTitle}</h3>
                {matchingCondition ? (
                  <article className={styles.stateRow}>
                    <strong>{spec.policy.condition.displayLabel}</strong>
                    <span>
                      observed {formatWhen(matchingCondition.last_observed_at)} · {matchingCondition.disposition === "observe"
                        ? "observation only"
                        : humanize(matchingCondition.disposition)}
                    </span>
                  </article>
                ) : <p className={styles.quiet}>{spec.policy.condition.emptyLabel}</p>}
                <button className={styles.inlineButton} type="button" disabled={Boolean(working)} onClick={() => void recordCondition()}>
                  {working === "condition" ? "recording…" : spec.policy.condition.recordLabel}
                </button>
                <p className={styles.microcopy}>{model.policyAccepted
                  ? spec.policy.authorizedCopy
                  : spec.policy.observationOnlyCopy}</p>
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