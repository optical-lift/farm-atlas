function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function goalLabel(definition) {
  const state = definition?.lifeSignal?.state ?? definition?.state ?? {};
  const explicit = state.explicitUserEnd;
  return typeof explicit === "string" && explicit.trim() ? explicit.trim() : "";
}

function sameSubject(left, right) {
  return Boolean(
    left?.domain && left?.kind && left?.id
    && left.domain === right?.domain
    && left.kind === right?.kind
    && left.id === right?.id,
  );
}

function valueAtPath(value, path) {
  let current = value;
  for (const key of Array.isArray(path) ? path : []) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}

function requirementsFor(definition) {
  const requirements = definition?.lifeSignal?.requirements ?? definition?.requirements ?? [];
  return Array.isArray(requirements) ? requirements : [];
}

function evidenceProgressValue(spec, evidenceClaims) {
  const reducer = cleanText(spec?.evidence?.progressReducer) || "max_value";
  if (reducer === "count_claims") return evidenceClaims.length;
  if (reducer !== "max_value") return 0;

  return evidenceClaims.reduce((best, claim) => {
    const candidate = Number(valueAtPath(claim?.value, spec?.evidence?.metricPath));
    return Number.isFinite(candidate) ? Math.max(best, candidate) : best;
  }, 0);
}

export function matchesPersonLifeNotebookGoal(definition, spec) {
  if (!definition || definition.signalKind !== "goal" || definition.status !== "active") return false;
  const label = goalLabel(definition);
  const patterns = Array.isArray(spec?.goalMatch?.patterns) ? spec.goalMatch.patterns : [];
  if (!label || !patterns.length) return false;
  const flags = cleanText(spec?.goalMatch?.flags) || "i";
  return patterns.some((source) => {
    try {
      return new RegExp(source, flags).test(label);
    } catch {
      return false;
    }
  });
}

export function notebookPolicyMatchesGoal(definition, goalDefinitionId, spec) {
  if (!definition || definition.signalKind !== "consequence" || definition.status !== "active") return false;
  const goalId = cleanText(goalDefinitionId);
  const requirementKey = cleanText(spec?.requirement?.key);
  const effectKind = cleanText(spec?.policy?.effectKind);
  const targetKind = cleanText(spec?.policy?.targetKind);
  if (!goalId || !requirementKey || !effectKind || !targetKind) return false;
  return requirementsFor(definition).some((requirement) => {
    const action = requirement?.policy?.actionSpec;
    return action?.effectKind === effectKind
      && action?.target?.kind === targetKind
      && action?.target?.goalDefinitionId === goalId
      && action?.target?.goalRequirementKey === requirementKey;
  });
}

export function projectPersonLifeNotebook(spec, state) {
  const definitions = Array.isArray(state?.definitions) ? state.definitions : [];
  const currentClaims = Array.isArray(state?.currentClaims) ? state.currentClaims : [];
  const rhythmOpportunities = Array.isArray(state?.rhythmOpportunities) ? state.rhythmOpportunities : [];
  const conditions = Array.isArray(state?.conditions) ? state.conditions : [];
  const requirementKey = cleanText(spec?.requirement?.key);
  const planClaimType = cleanText(spec?.rhythm?.claimType) || "goal_rhythm_plan";
  const evidenceClaimType = cleanText(spec?.evidence?.claimType);
  const goal = definitions.filter((definition) => matchesPersonLifeNotebookGoal(definition, spec)).at(-1) ?? null;

  if (!goal) {
    return {
      specId: cleanText(spec?.id),
      goal: null,
      requirementAccepted: false,
      evidenceSubject: null,
      policyAccepted: false,
      acceptedPlanClaims: [],
      rhythmAccepted: false,
      opportunities: [],
      evidenceClaims: [],
      progressValue: 0,
      progressPercent: 0,
      satisfiedCount: 0,
      matchingCondition: null,
    };
  }

  const goalRequirements = requirementsFor(goal);
  const requirement = goalRequirements.find((item) => item?.requirementKey === requirementKey) ?? null;
  const evidenceSubject = requirement?.evidenceSelector?.subject ?? null;
  const acceptedPlanClaims = currentClaims.filter((claim) => {
    if (claim?.claimType !== planClaimType || claim?.lifecycleState !== "accepted") return false;
    return claim?.value?.goalDefinitionId === goal.definitionId
      && claim?.value?.goalRequirementKey === requirementKey;
  });
  const acceptedPlanIds = new Set(acceptedPlanClaims.map((claim) => claim.claimId));
  const opportunities = rhythmOpportunities
    .filter((item) => acceptedPlanIds.has(item?.planClaimId) && item?.projectionState !== "withdrawn")
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  const evidenceClaims = currentClaims.filter((claim) =>
    claim?.claimType === evidenceClaimType
    && claim?.lifecycleState === "observed"
    && sameSubject(claim?.subject, evidenceSubject));
  const progressValue = evidenceProgressValue(spec, evidenceClaims);
  const targetValue = Number(spec?.evidence?.targetValue);
  const progressPercent = Number.isFinite(targetValue) && targetValue > 0
    ? Math.min(100, Math.max(0, (progressValue / targetValue) * 100))
    : 0;
  const policyAccepted = definitions.some((definition) => notebookPolicyMatchesGoal(definition, goal.definitionId, spec));
  const condition = spec?.policy?.condition ?? {};
  const matchingCondition = conditions.find((row) =>
    row?.subject_domain === condition.subjectDomain
    && row?.subject_kind === condition.subjectKind
    && row?.subject_id === condition.subjectId
    && row?.condition_state === condition.conditionState) ?? null;

  return {
    specId: cleanText(spec?.id),
    goal,
    requirementAccepted: Boolean(requirement),
    evidenceSubject,
    policyAccepted,
    acceptedPlanClaims,
    rhythmAccepted: acceptedPlanClaims.length > 0,
    opportunities,
    evidenceClaims,
    progressValue,
    progressPercent,
    satisfiedCount: opportunities.filter((item) => item.projectionState === "satisfied").length,
    matchingCondition,
  };
}

export function selectPersonLifeNotebook(specs, state) {
  const catalog = Array.isArray(specs) ? specs : [];
  const definitions = Array.isArray(state?.definitions) ? state.definitions : [];
  for (const spec of catalog) {
    if (definitions.some((definition) => matchesPersonLifeNotebookGoal(definition, spec))) {
      return { spec, model: projectPersonLifeNotebook(spec, state) };
    }
  }
  return null;
}
