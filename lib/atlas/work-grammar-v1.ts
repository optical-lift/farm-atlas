import "server-only";

import { assertWorkGrammarV1Package } from "@/lib/atlas/work-grammar-v1-core.js";

export type WorkModeV1 =
  | "change"
  | "observe"
  | "decide"
  | "communicate"
  | "transfer"
  | "create"
  | "plan";

export type ReferentRoleV1 =
  | "subject"
  | "target"
  | "source"
  | "destination"
  | "work_location"
  | "party"
  | "contact"
  | "provider"
  | "customer"
  | "order"
  | "event"
  | "project"
  | "commitment"
  | "crop_cycle"
  | "material"
  | "resource"
  | "parent_work"
  | "prerequisite_work"
  | "downstream_work"
  | "artifact"
  | "channel"
  | "service";

export type ClaimModalityV1 =
  | "observed"
  | "authoritative_assertion"
  | "derived"
  | "planned"
  | "forecast"
  | "estimated"
  | "unknown";

export type ClaimAdjudicationStateV1 = "current" | "disputed" | "superseded";

export type TemporalKindV1 =
  | "not_before"
  | "preferred_window"
  | "latest_satisfactory"
  | "hard_deadline"
  | "event_anchor"
  | "expected_duration"
  | "recurrence"
  | "minimum_interval"
  | "biological_window"
  | "forecast_window"
  | "service_date"
  | "planned_placement";

export type MovementPolicyV1 = "fixed" | "bounded" | "movable" | "re_evaluate";

export type ConstraintKindV1 =
  | "method"
  | "policy"
  | "safety"
  | "physical_condition"
  | "weather_environment"
  | "resource"
  | "presence_capability"
  | "preservation"
  | "substitution"
  | "truth_boundary";

export type RequirementKindV1 =
  | "work_state"
  | "resource_state"
  | "referent_state"
  | "claim_state"
  | "decision"
  | "capability"
  | "presence"
  | "external_state";

export type GateStateV1 = "satisfied" | "unsatisfied" | "needs_check" | "unknown";
export type RequirementConsequenceV1 = "block" | "hold" | "re_evaluate";

export type CompositionKindV1 =
  | "sequence"
  | "checklist"
  | "conditional_branch"
  | "option_set"
  | "batch"
  | "round"
  | "route"
  | "collection"
  | "parent_child"
  | "serial_queue"
  | "paired_work"
  | "recurring_family";

export type ResultAcceptanceModeV1 =
  | "worker_attestation"
  | "manager_acceptance"
  | "system_observation"
  | "external_confirmation";

export type ResultFieldKindV1 =
  | "choice"
  | "number"
  | "boolean"
  | "reference"
  | "observation"
  | "artifact"
  | "text";

export type ResultEffectKindV1 =
  | "claim"
  | "relation"
  | "state_transition"
  | "inventory_movement"
  | "downstream_requirement";

export type CanonicalIdentityV1 = {
  kind: string;
  id: string;
};

export type ScalarValueV1 =
  | { kind: "number"; value: number; unit?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "code"; value: string }
  | { kind: "date"; value: string }
  | { kind: "datetime"; value: string }
  | { kind: "reference"; referentId: string };

export type TemporalValueV1 =
  | { kind: "instant"; at: string }
  | { kind: "window"; start?: string; end?: string }
  | { kind: "duration"; amount: number; unit: "minutes" | "hours" | "days" | "weeks" }
  | { kind: "recurrence"; rrule: string }
  | { kind: "anchor"; referentId: string };

export type WorkActV1 = {
  actId: string;
  mode: WorkModeV1;
  operation: string;
  variant?: string;
};

export type ReferentV1 = {
  referentId: string;
  role: ReferentRoleV1;
  identity: CanonicalIdentityV1;
};

export type ClaimV1 = {
  claimId: string;
  subjectRef: string;
  predicate: string;
  value: ScalarValueV1;
  modality: ClaimModalityV1;
  adjudication: {
    state: ClaimAdjudicationStateV1;
    contradictsClaimIds?: string[];
    supersedesClaimIds?: string[];
    correctedByClaimId?: string;
  };
  provenance: CanonicalIdentityV1;
  effectiveAt?: string;
};

export type RelationEndpointV1 = {
  kind: "act" | "referent" | "claim" | "composition";
  id: string;
};

export type RelationV1 = {
  relationId: string;
  type: string;
  from: RelationEndpointV1;
  to: RelationEndpointV1;
};

export type SpecificationV1 = {
  specificationId: string;
  key: string;
  value: ScalarValueV1;
  appliesTo?: string;
  min?: number;
  max?: number;
};

export type TemporalContractV1 = {
  temporalId: string;
  kind: TemporalKindV1;
  value: TemporalValueV1;
  movementPolicy?: MovementPolicyV1;
  appliesTo?: string;
};

export type ConstraintV1 = {
  constraintId: string;
  kind: ConstraintKindV1;
  ruleKey: string;
  appliesTo?: string;
  parameterRefs?: string[];
};

export type RequirementV1 = {
  requirementId: string;
  kind: RequirementKindV1;
  requirementKey: string;
  satisfactionRuleKey: string;
  consequence: RequirementConsequenceV1;
  appliesTo?: string;
};

export type GateV1 = {
  gateId: string;
  requirementId: string;
  state: GateStateV1;
  evidenceClaimIds?: string[];
  evaluatedAt?: string;
};

export type CompositionMemberV1 = {
  kind: "act" | "composition";
  id: string;
};

export type CompositionV1 = {
  compositionId: string;
  kind: CompositionKindV1;
  members: CompositionMemberV1[];
};

export type ResultFieldV1 = {
  fieldKey: string;
  kind: ResultFieldKindV1;
  required: boolean;
  unit?: string;
  choices?: string[];
};

export type ResultEffectV1 = {
  kind: ResultEffectKindV1;
  effectKey: string;
};

export type ResultContractV1 = {
  resultContractId: string;
  acceptanceMode: ResultAcceptanceModeV1;
  appliesTo?: string;
  fields: ResultFieldV1[];
  effects: ResultEffectV1[];
};

export type WorkGrammarV1Package = {
  version: "work-grammar-v1";
  workIdentity: CanonicalIdentityV1;
  acts: WorkActV1[];
  referents: ReferentV1[];
  claims: ClaimV1[];
  relations: RelationV1[];
  specifications: SpecificationV1[];
  temporalContracts: TemporalContractV1[];
  constraints: ConstraintV1[];
  requirements: RequirementV1[];
  gates: GateV1[];
  compositions: CompositionV1[];
  resultContracts: ResultContractV1[];
};

export function validateWorkGrammarV1(
  grammar: WorkGrammarV1Package,
): WorkGrammarV1Package {
  assertWorkGrammarV1Package(grammar);
  return grammar;
}
