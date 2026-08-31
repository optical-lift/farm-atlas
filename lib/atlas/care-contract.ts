export type AtlasCareDisposition = "hold" | "reassess" | "intervene";

export type AtlasCareReleaseKind =
  | "none"
  | "protected_attention"
  | "executable_intervention";

export type AtlasCareSubjectKind = "physical_object" | "attention_scope";

export type AtlasCareSubjectRef = {
  kind: AtlasCareSubjectKind;
  domainKey: string;
  objectType: string;
  objectId: string;
  objectKey?: string | null;
  label?: string | null;
};

export type AtlasCarePolicyRef = {
  policyKey: string;
  policyVersion: number;
  label: string;
};

/**
 * Physical condition is authoritative only when it comes from observation or
 * another domain-owned fact source. A clock may request attention, but it may
 * never manufacture physical condition merely because time elapsed.
 */
export type AtlasCarePhysicalCondition<Condition extends string = string> = {
  known: boolean;
  value: Condition | null;
  reportedAt: string | null;
  source?: string | null;
  inferredFromClock: false;
};

/**
 * A bounded care session records what actually happened to a cared-for object.
 * Domain adapters may add richer context, but the before/after condition and
 * actual effort remain portable across Farm, Household, Facilities, and other
 * Atlas care domains.
 */
export type AtlasCareSession<Condition extends string = string> = {
  id: string;
  workDate: string;
  minutes: number;
  minutesKnown: boolean;
  conditionBefore: Condition;
  conditionAfter: Condition;
  note: string | null;
  recordedAt: string;
};

export type AtlasCareAssessment<Condition extends string = string> = {
  subject: AtlasCareSubjectRef;
  policy: AtlasCarePolicyRef;
  disposition: AtlasCareDisposition;
  condition: AtlasCarePhysicalCondition<Condition>;
  reason: string;
};

export type AtlasCareIntervention<Action extends string = string> = {
  action: Action;
  method?: string | null;
  expectedMinutes?: number | null;
  reason?: string | null;
};

export type AtlasCareReleaseReason =
  | "care_holding"
  | "attention_not_eligible"
  | "reassessment_due"
  | "intervention_not_yet_specified"
  | "execution_not_enabled"
  | "intervention_ready";

export type AtlasCareReleaseDecision = {
  kind: AtlasCareReleaseKind;
  reason: AtlasCareReleaseReason;
  releasesExecutableWork: boolean;
};

/**
 * Atlas distinguishes attention from execution.
 *
 * - A holding object releases nothing.
 * - A reassessment may receive protected attention without asserting work.
 * - An intervention becomes executable only when the domain has actually
 *   specified the intervention and execution is enabled for this surface.
 *
 * This is the shared rule that prevents elapsed time from becoming fabricated
 * physical condition or an automatic overdue chore.
 */
export function decideAtlasCareRelease<Action extends string = string>(input: {
  assessment: AtlasCareAssessment;
  attentionEligible: boolean;
  intervention?: AtlasCareIntervention<Action> | null;
  executionEnabled: boolean;
}): AtlasCareReleaseDecision {
  const { assessment, attentionEligible, intervention, executionEnabled } = input;

  if (assessment.disposition === "hold") {
    return {
      kind: "none",
      reason: "care_holding",
      releasesExecutableWork: false,
    };
  }

  if (!attentionEligible) {
    return {
      kind: "none",
      reason: "attention_not_eligible",
      releasesExecutableWork: false,
    };
  }

  if (assessment.disposition === "reassess") {
    return {
      kind: "protected_attention",
      reason: "reassessment_due",
      releasesExecutableWork: false,
    };
  }

  if (!intervention) {
    return {
      kind: "protected_attention",
      reason: "intervention_not_yet_specified",
      releasesExecutableWork: false,
    };
  }

  if (!executionEnabled) {
    return {
      kind: "protected_attention",
      reason: "execution_not_enabled",
      releasesExecutableWork: false,
    };
  }

  return {
    kind: "executable_intervention",
    reason: "intervention_ready",
    releasesExecutableWork: true,
  };
}
