function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanUuid(value) {
  const text = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function requireSubject(subject) {
  const domain = cleanText(subject?.domain);
  const kind = cleanText(subject?.kind);
  const id = cleanText(subject?.id);
  return domain && kind && id ? { domain, kind, id } : null;
}

export const FIVE_K_REQUIREMENT_KEY = "complete_5k";

export function isFiveKGoal(definition) {
  if (!definition || definition.signalKind !== "goal" || definition.status !== "active") return false;
  const raw = cleanText(definition.lifeSignal?.state?.explicitUserEnd ?? definition.state?.explicitUserEnd);
  return /\b5\s*k\b/i.test(raw) || /\b5\s*kilomet(er|re)s?\b/i.test(raw);
}

export function hasFiveKRequirement(definition) {
  const requirements = definition?.lifeSignal?.requirements ?? definition?.requirements ?? [];
  return Array.isArray(requirements) && requirements.some((item) => item?.requirementKey === FIVE_K_REQUIREMENT_KEY);
}

export function getFiveKRunSubject(definition) {
  const requirements = definition?.lifeSignal?.requirements ?? definition?.requirements ?? [];
  const requirement = Array.isArray(requirements)
    ? requirements.find((item) => item?.requirementKey === FIVE_K_REQUIREMENT_KEY)
    : null;
  return requireSubject(requirement?.evidenceSelector?.subject);
}

export function buildFiveKRequirementCapture({ goalSubject, sourceKey, observedAt }) {
  const subject = requireSubject(goalSubject);
  const key = cleanText(sourceKey);
  const at = cleanText(observedAt);
  if (!subject || !key || !at) return { ok: false, error: "Goal subject, source key, and acceptance time are required." };

  const runSubject = {
    domain: "training",
    kind: "run",
    id: `${subject.id}:five_k_run`,
  };
  const requirement = {
    requirementKey: FIVE_K_REQUIREMENT_KEY,
    requirementKind: "claim_threshold",
    phase: "realize",
    required: true,
    evidenceSelector: {
      subject: runSubject,
      claimType: "run_distance",
      lifecycleStates: ["observed"],
      authorityKinds: ["person_reported_observation", "person_correction"],
    },
    criterion: {
      path: ["distanceKm"],
      operator: ">=",
      value: 5,
      unit: "km",
      unitPath: ["unit"],
    },
  };

  return {
    ok: true,
    value: {
      requirement,
      capture: {
        sourceKey: key,
        subject,
        evidence: {
          kind: "goal_requirement_basis",
          value: requirement,
          observedAt: at,
          provenance: { adapter: "person_life_5k_notebook_v1", acceptance: "explicit_person_measurement" },
        },
        claim: {
          claimType: "goal_requirement",
          lifecycleState: "accepted",
          value: requirement,
          validFrom: at,
          metadata: { captureSurface: "person_life_5k_notebook", interpretationAuthority: "person" },
        },
      },
    },
  };
}

export function buildFiveKRhythmPlanCapture({
  goalDefinitionId,
  goalSubject,
  runSubject,
  sourceKey,
  acceptedAt,
  timezone,
  weekdays = [1, 3, 5],
  localStartTime = "17:00",
  windowMinutes = 90,
}) {
  const goalId = cleanUuid(goalDefinitionId);
  const subject = requireSubject(goalSubject);
  const run = requireSubject(runSubject);
  const key = cleanText(sourceKey);
  const at = cleanText(acceptedAt);
  const zone = cleanText(timezone);
  const start = cleanText(localStartTime);
  const days = Array.isArray(weekdays) ? [...new Set(weekdays.map(Number))] : [];
  const minutes = Number(windowMinutes);
  if (!goalId || !subject || !run || !key || !at || !zone || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
    return { ok: false, error: "Current Goal, exact cadence, timezone, source key, and acceptance time are required." };
  }
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    return { ok: false, error: "Cadence weekdays must be ISO weekdays 1 through 7." };
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return { ok: false, error: "Run window must be between 1 and 1440 minutes." };
  }

  const plan = {
    contractVersion: "goal_rhythm_plan_v1",
    goalDefinitionId: goalId,
    goalRequirementKey: FIVE_K_REQUIREMENT_KEY,
    rhythm: {
      sourceKey: `${key}:rhythm`,
      subject: run,
      state: { rhythmModel: "lease", authorizationState: "accepted" },
      timing: {
        boundaryMode: "exact_timestamp",
        validityIntervalSeconds: 259200,
        warningWindowSeconds: 43200,
        graceWindowSeconds: 43200,
      },
      requirements: [],
      constraints: [],
      ambiguities: [],
    },
    opportunityPlan: {
      strategy: "weekly_local_windows_v1",
      timezone: zone,
      weekdays: days,
      localStartTime: start,
      windowMinutes: minutes,
      materializationHorizonDays: 14,
      presentation: { kind: "training_run", label: "5K training run" },
    },
  };

  return {
    ok: true,
    value: {
      plan,
      capture: {
        sourceKey: key,
        subject,
        evidence: {
          kind: "goal_rhythm_plan_basis",
          value: plan,
          observedAt: at,
          provenance: { adapter: "person_life_5k_notebook_v1", acceptance: "explicit_person_cadence" },
        },
        claim: {
          claimType: "goal_rhythm_plan",
          lifecycleState: "accepted",
          value: plan,
          validFrom: at,
          metadata: { captureSurface: "person_life_5k_notebook", interpretationAuthority: "person" },
        },
      },
    },
  };
}

export function buildFiveKGuardrailCapture({ ownerUserId, goalDefinitionId, sourceKey, acceptedAt }) {
  const owner = cleanUuid(ownerUserId);
  const goalId = cleanUuid(goalDefinitionId);
  const key = cleanText(sourceKey);
  const at = cleanText(acceptedAt);
  if (!owner || !goalId || !key || !at) return { ok: false, error: "Person, current Goal, source key, and acceptance time are required." };

  const subject = { domain: "body", kind: "body_region", id: "right_knee" };
  const requirement = {
    requirementKey: "right_knee_aching_after_mile_2_recovery_presentation",
    requirementKind: "preparation",
    required: true,
    policy: {
      stableKey: `five_k_right_knee_recovery:${goalId}`,
      consequenceRole: "preparation",
      consequenceKind: "training_presentation_adjustment",
      actionKey: "use_recovery_run_presentation",
      priority: 100,
      subjectSelector: { subject },
      stateMatch: {
        claim: {
          claimType: "condition_observation",
          lifecycleState: "observed",
          value: { conditionState: "aching_after_mile_2" },
        },
      },
      actionSpec: {
        effectKind: "rhythm_opportunity_presentation_overlay",
        target: {
          kind: "goal_requirement_next_opportunity",
          goalDefinitionId: goalId,
          goalRequirementKey: FIVE_K_REQUIREMENT_KEY,
        },
        presentationOverlay: {
          label: "Recovery-paced 5K run",
          guidance: "Keep the next run easy; stop and reassess if the knee keeps aching.",
        },
      },
    },
  };
  const policyValue = { signalKind: "consequence", subject, requirements: [requirement] };

  return {
    ok: true,
    value: {
      policyCapture: {
        sourceKey: key,
        subject,
        evidence: {
          kind: "consequence_policy_basis",
          value: policyValue,
          observedAt: at,
          provenance: { adapter: "person_life_5k_notebook_v1", acceptance: "explicit_person_guardrail" },
        },
        claim: {
          claimType: "consequence_policy",
          lifecycleState: "accepted",
          value: policyValue,
          validFrom: at,
          metadata: { captureSurface: "person_life_5k_notebook", interpretationAuthority: "person" },
        },
      },
      buildDefinition(policyClaimId) {
        const claimId = cleanUuid(policyClaimId);
        if (!claimId) return null;
        return {
          sourceKey: `${key}:definition`,
          signal: {
            contractVersion: "atlas_life_signal_v1",
            scope: { kind: "person", id: owner },
            subject,
            signalKind: "consequence",
            state: { authorizationState: "person_accepted_policy" },
            timing: {},
            requirements: [requirement],
            constraints: [],
            ambiguities: [],
            relations: [],
            source: { domain: "claim_evidence", kind: "claim", id: claimId },
            epistemic: { factClass: "person_accepted_policy", interpretationAuthority: "person" },
          },
        };
      },
    },
  };
}

export function buildRunDistanceCapture({ runSubject, sourceKey, observedAt, distanceKm }) {
  const subject = requireSubject(runSubject);
  const key = cleanText(sourceKey);
  const at = cleanText(observedAt);
  const distance = Number(distanceKm);
  if (!subject || !key || !at || !Number.isFinite(distance) || distance <= 0) {
    return { ok: false, error: "Run subject, source key, observed time, and positive distance are required." };
  }
  const value = { distanceKm: distance, unit: "km" };
  return {
    ok: true,
    value: {
      sourceKey: key,
      subject,
      evidence: {
        kind: "run_distance",
        value,
        observedAt: at,
        provenance: { adapter: "person_life_5k_notebook_v1", captureAuthority: "person_reported_observation" },
      },
      claim: {
        claimType: "run_distance",
        lifecycleState: "observed",
        value,
        validFrom: at,
        metadata: { captureSurface: "person_life_5k_notebook" },
      },
    },
  };
}

export function fiveKGuardrailDefinitionForGoal(definitions, goalDefinitionId) {
  const goalId = cleanUuid(goalDefinitionId);
  if (!goalId || !Array.isArray(definitions)) return null;
  return definitions.find((definition) => {
    if (definition?.signalKind !== "consequence" || definition?.status !== "active") return false;
    const requirements = definition.lifeSignal?.requirements ?? definition.requirements ?? [];
    return Array.isArray(requirements) && requirements.some((requirement) => {
      const action = requirement?.policy?.actionSpec;
      return action?.effectKind === "rhythm_opportunity_presentation_overlay"
        && action?.target?.kind === "goal_requirement_next_opportunity"
        && action?.target?.goalDefinitionId === goalId
        && action?.target?.goalRequirementKey === FIVE_K_REQUIREMENT_KEY;
    });
  }) ?? null;
}
