export const WORK_GRAMMAR_VERSION = "work-grammar-v1";

export const WORK_MODES = Object.freeze([
  "change",
  "observe",
  "decide",
  "communicate",
  "transfer",
  "create",
  "plan",
]);

export const REFERENT_ROLES = Object.freeze([
  "subject",
  "target",
  "source",
  "destination",
  "work_location",
  "party",
  "contact",
  "provider",
  "customer",
  "order",
  "event",
  "project",
  "commitment",
  "crop_cycle",
  "material",
  "resource",
  "parent_work",
  "prerequisite_work",
  "downstream_work",
  "artifact",
  "channel",
  "service",
]);

export const CLAIM_MODALITIES = Object.freeze([
  "observed",
  "authoritative_assertion",
  "derived",
  "planned",
  "forecast",
  "estimated",
  "unknown",
]);

export const CLAIM_ADJUDICATION_STATES = Object.freeze([
  "current",
  "disputed",
  "superseded",
]);

export const TEMPORAL_KINDS = Object.freeze([
  "not_before",
  "preferred_window",
  "latest_satisfactory",
  "hard_deadline",
  "event_anchor",
  "expected_duration",
  "recurrence",
  "minimum_interval",
  "biological_window",
  "forecast_window",
  "service_date",
  "planned_placement",
]);

export const MOVEMENT_POLICIES = Object.freeze([
  "fixed",
  "bounded",
  "movable",
  "re_evaluate",
]);

export const CONSTRAINT_KINDS = Object.freeze([
  "method",
  "policy",
  "safety",
  "physical_condition",
  "weather_environment",
  "resource",
  "presence_capability",
  "preservation",
  "substitution",
  "truth_boundary",
]);

export const REQUIREMENT_KINDS = Object.freeze([
  "work_state",
  "resource_state",
  "referent_state",
  "claim_state",
  "decision",
  "capability",
  "presence",
  "external_state",
]);

export const GATE_STATES = Object.freeze([
  "satisfied",
  "unsatisfied",
  "needs_check",
  "unknown",
]);

export const REQUIREMENT_CONSEQUENCES = Object.freeze([
  "block",
  "hold",
  "re_evaluate",
]);

export const COMPOSITION_KINDS = Object.freeze([
  "sequence",
  "checklist",
  "conditional_branch",
  "option_set",
  "batch",
  "round",
  "route",
  "collection",
  "parent_child",
  "serial_queue",
  "paired_work",
  "recurring_family",
]);

export const RESULT_ACCEPTANCE_MODES = Object.freeze([
  "worker_attestation",
  "manager_acceptance",
  "system_observation",
  "external_confirmation",
]);

export const RESULT_FIELD_KINDS = Object.freeze([
  "choice",
  "number",
  "boolean",
  "reference",
  "observation",
  "artifact",
  "text",
]);

export const RESULT_EFFECT_KINDS = Object.freeze([
  "claim",
  "relation",
  "state_transition",
  "inventory_movement",
  "downstream_requirement",
]);

const FORBIDDEN_PROSE_KEYS = new Set([
  "title",
  "instructions",
  "instruction",
  "note",
  "notes",
  "detail",
  "details",
  "description",
  "display_title",
  "display_detail",
  "detail_lines",
  "display_action",
  "execution_do",
  "execution_how",
  "execution_done_when",
  "execution_statement",
  "worker_script",
  "owner_instruction_text",
]);

const SEMANTIC_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function fail(message) {
  throw new Error(`Work Grammar V1: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function semanticKey(value, label) {
  const key = nonEmptyString(value, label);
  if (!SEMANTIC_KEY.test(key)) fail(`${label} must be a semantic key, not prose.`);
  return key;
}

function oneOf(value, values, label) {
  if (!values.includes(value)) fail(`${label} is not governed by Work Grammar V1.`);
  return value;
}

function rejectProseEscapeHatches(value, path = "grammar") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectProseEscapeHatches(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PROSE_KEYS.has(key)) {
      fail(`${path}.${key} is a presentation/prose field and cannot carry canonical semantics.`);
    }
    rejectProseEscapeHatches(child, `${path}.${key}`);
  }
}

function validateIdentity(value, label) {
  const identity = object(value, label);
  semanticKey(identity.kind, `${label}.kind`);
  nonEmptyString(identity.id, `${label}.id`);
  return identity;
}

function validateScalar(value, label) {
  const scalar = object(value, label);
  const kind = oneOf(
    scalar.kind,
    ["number", "boolean", "code", "date", "datetime", "reference"],
    `${label}.kind`,
  );

  if (kind === "number") {
    if (typeof scalar.value !== "number" || !Number.isFinite(scalar.value)) {
      fail(`${label}.value must be a finite number.`);
    }
    if (scalar.unit !== undefined) semanticKey(scalar.unit, `${label}.unit`);
  } else if (kind === "boolean") {
    if (typeof scalar.value !== "boolean") fail(`${label}.value must be boolean.`);
  } else if (kind === "code") {
    semanticKey(scalar.value, `${label}.value`);
  } else if (kind === "date") {
    if (typeof scalar.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scalar.value)) {
      fail(`${label}.value must use YYYY-MM-DD.`);
    }
  } else if (kind === "datetime") {
    if (typeof scalar.value !== "string" || Number.isNaN(Date.parse(scalar.value))) {
      fail(`${label}.value must be an ISO-compatible datetime.`);
    }
  } else if (kind === "reference") {
    nonEmptyString(scalar.referentId, `${label}.referentId`);
  }

  return scalar;
}

function validateTemporalValue(value, label) {
  const temporal = object(value, label);
  const kind = oneOf(
    temporal.kind,
    ["instant", "window", "duration", "recurrence", "anchor"],
    `${label}.kind`,
  );

  if (kind === "instant") {
    if (typeof temporal.at !== "string" || Number.isNaN(Date.parse(temporal.at))) {
      fail(`${label}.at must be an ISO-compatible datetime.`);
    }
  } else if (kind === "window") {
    if (temporal.start === undefined && temporal.end === undefined) {
      fail(`${label} must have start or end.`);
    }
    for (const boundary of ["start", "end"]) {
      if (
        temporal[boundary] !== undefined &&
        (typeof temporal[boundary] !== "string" || Number.isNaN(Date.parse(temporal[boundary])))
      ) {
        fail(`${label}.${boundary} must be an ISO-compatible datetime.`);
      }
    }
  } else if (kind === "duration") {
    if (typeof temporal.amount !== "number" || !Number.isFinite(temporal.amount) || temporal.amount < 0) {
      fail(`${label}.amount must be a non-negative number.`);
    }
    oneOf(temporal.unit, ["minutes", "hours", "days", "weeks"], `${label}.unit`);
  } else if (kind === "recurrence") {
    nonEmptyString(temporal.rrule, `${label}.rrule`);
  } else if (kind === "anchor") {
    nonEmptyString(temporal.referentId, `${label}.referentId`);
  }

  return temporal;
}

function uniqueIds(rows, idKey, label) {
  const ids = new Set();
  for (const row of rows) {
    const id = nonEmptyString(row[idKey], `${label}.${idKey}`);
    if (ids.has(id)) fail(`${label} contains duplicate ${idKey} ${id}.`);
    ids.add(id);
  }
  return ids;
}

export function assertWorkGrammarV1Package(input) {
  const grammar = object(input, "grammar");
  rejectProseEscapeHatches(grammar);

  if (grammar.version !== WORK_GRAMMAR_VERSION) {
    fail(`version must be ${WORK_GRAMMAR_VERSION}.`);
  }

  validateIdentity(grammar.workIdentity, "workIdentity");

  const acts = array(grammar.acts, "acts");
  if (acts.length === 0) fail("at least one Work Act is required.");
  const actIds = uniqueIds(acts, "actId", "acts");
  for (const act of acts) {
    object(act, "act");
    oneOf(act.mode, WORK_MODES, "act.mode");
    semanticKey(act.operation, "act.operation");
    if (act.variant !== undefined) semanticKey(act.variant, "act.variant");
  }

  const referents = array(grammar.referents ?? [], "referents");
  const referentIds = uniqueIds(referents, "referentId", "referents");
  for (const referent of referents) {
    oneOf(referent.role, REFERENT_ROLES, "referent.role");
    validateIdentity(referent.identity, "referent.identity");
  }

  const claims = array(grammar.claims ?? [], "claims");
  uniqueIds(claims, "claimId", "claims");
  for (const claim of claims) {
    if (!referentIds.has(nonEmptyString(claim.subjectRef, "claim.subjectRef"))) {
      fail(`claim.subjectRef must reference a package Referent.`);
    }
    semanticKey(claim.predicate, "claim.predicate");
    validateScalar(claim.value, "claim.value");
    oneOf(claim.modality, CLAIM_MODALITIES, "claim.modality");
    const adjudication = object(claim.adjudication, "claim.adjudication");
    oneOf(adjudication.state, CLAIM_ADJUDICATION_STATES, "claim.adjudication.state");
    if (adjudication.contradictsClaimIds !== undefined) array(adjudication.contradictsClaimIds, "claim.adjudication.contradictsClaimIds");
    if (adjudication.supersedesClaimIds !== undefined) array(adjudication.supersedesClaimIds, "claim.adjudication.supersedesClaimIds");
    if (adjudication.correctedByClaimId !== undefined) nonEmptyString(adjudication.correctedByClaimId, "claim.adjudication.correctedByClaimId");
    validateIdentity(claim.provenance, "claim.provenance");
    if (claim.effectiveAt !== undefined && (typeof claim.effectiveAt !== "string" || Number.isNaN(Date.parse(claim.effectiveAt)))) {
      fail("claim.effectiveAt must be an ISO-compatible datetime.");
    }
  }

  const relations = array(grammar.relations ?? [], "relations");
  uniqueIds(relations, "relationId", "relations");
  for (const relation of relations) {
    semanticKey(relation.type, "relation.type");
    for (const endpoint of ["from", "to"]) {
      const ref = object(relation[endpoint], `relation.${endpoint}`);
      oneOf(ref.kind, ["act", "referent", "claim", "composition"], `relation.${endpoint}.kind`);
      nonEmptyString(ref.id, `relation.${endpoint}.id`);
    }
  }

  const specifications = array(grammar.specifications ?? [], "specifications");
  uniqueIds(specifications, "specificationId", "specifications");
  for (const specification of specifications) {
    semanticKey(specification.key, "specification.key");
    validateScalar(specification.value, "specification.value");
    if (specification.appliesTo !== undefined) nonEmptyString(specification.appliesTo, "specification.appliesTo");
    if (specification.min !== undefined && typeof specification.min !== "number") fail("specification.min must be numeric.");
    if (specification.max !== undefined && typeof specification.max !== "number") fail("specification.max must be numeric.");
  }

  const temporalContracts = array(grammar.temporalContracts ?? [], "temporalContracts");
  uniqueIds(temporalContracts, "temporalId", "temporalContracts");
  for (const temporal of temporalContracts) {
    oneOf(temporal.kind, TEMPORAL_KINDS, "temporal.kind");
    validateTemporalValue(temporal.value, "temporal.value");
    if (temporal.movementPolicy !== undefined) oneOf(temporal.movementPolicy, MOVEMENT_POLICIES, "temporal.movementPolicy");
    if (temporal.appliesTo !== undefined) nonEmptyString(temporal.appliesTo, "temporal.appliesTo");
  }

  const constraints = array(grammar.constraints ?? [], "constraints");
  uniqueIds(constraints, "constraintId", "constraints");
  for (const constraint of constraints) {
    oneOf(constraint.kind, CONSTRAINT_KINDS, "constraint.kind");
    semanticKey(constraint.ruleKey, "constraint.ruleKey");
    if (constraint.appliesTo !== undefined) nonEmptyString(constraint.appliesTo, "constraint.appliesTo");
    if (constraint.parameterRefs !== undefined) array(constraint.parameterRefs, "constraint.parameterRefs");
  }

  const requirements = array(grammar.requirements ?? [], "requirements");
  const requirementIds = uniqueIds(requirements, "requirementId", "requirements");
  for (const requirement of requirements) {
    oneOf(requirement.kind, REQUIREMENT_KINDS, "requirement.kind");
    semanticKey(requirement.requirementKey, "requirement.requirementKey");
    semanticKey(requirement.satisfactionRuleKey, "requirement.satisfactionRuleKey");
    oneOf(requirement.consequence, REQUIREMENT_CONSEQUENCES, "requirement.consequence");
    if (requirement.appliesTo !== undefined) nonEmptyString(requirement.appliesTo, "requirement.appliesTo");
  }

  const gates = array(grammar.gates ?? [], "gates");
  uniqueIds(gates, "gateId", "gates");
  for (const gate of gates) {
    const requirementId = nonEmptyString(gate.requirementId, "gate.requirementId");
    if (!requirementIds.has(requirementId)) fail("gate.requirementId must reference a package Requirement.");
    oneOf(gate.state, GATE_STATES, "gate.state");
    if (gate.evidenceClaimIds !== undefined) array(gate.evidenceClaimIds, "gate.evidenceClaimIds");
    if (gate.evaluatedAt !== undefined && (typeof gate.evaluatedAt !== "string" || Number.isNaN(Date.parse(gate.evaluatedAt)))) {
      fail("gate.evaluatedAt must be an ISO-compatible datetime.");
    }
  }

  const compositions = array(grammar.compositions ?? [], "compositions");
  const compositionIds = uniqueIds(compositions, "compositionId", "compositions");
  for (const composition of compositions) {
    oneOf(composition.kind, COMPOSITION_KINDS, "composition.kind");
    const members = array(composition.members, "composition.members");
    if (members.length === 0) fail("composition.members cannot be empty.");
    for (const member of members) {
      oneOf(member.kind, ["act", "composition"], "composition.member.kind");
      const memberId = nonEmptyString(member.id, "composition.member.id");
      if (member.kind === "act" && !actIds.has(memberId)) fail("composition act member must reference a package Work Act.");
      if (member.kind === "composition" && !compositionIds.has(memberId)) fail("composition member must reference a package Composition.");
    }
  }

  const resultContracts = array(grammar.resultContracts ?? [], "resultContracts");
  uniqueIds(resultContracts, "resultContractId", "resultContracts");
  for (const resultContract of resultContracts) {
    oneOf(resultContract.acceptanceMode, RESULT_ACCEPTANCE_MODES, "resultContract.acceptanceMode");
    if (resultContract.appliesTo !== undefined) nonEmptyString(resultContract.appliesTo, "resultContract.appliesTo");
    const fields = array(resultContract.fields ?? [], "resultContract.fields");
    const fieldKeys = new Set();
    for (const field of fields) {
      const fieldKey = semanticKey(field.fieldKey, "resultContract.field.fieldKey");
      if (fieldKeys.has(fieldKey)) fail(`duplicate result field ${fieldKey}.`);
      fieldKeys.add(fieldKey);
      oneOf(field.kind, RESULT_FIELD_KINDS, "resultContract.field.kind");
      if (typeof field.required !== "boolean") fail("resultContract.field.required must be boolean.");
      if (field.unit !== undefined) semanticKey(field.unit, "resultContract.field.unit");
      if (field.choices !== undefined) {
        array(field.choices, "resultContract.field.choices").forEach((choice) => semanticKey(choice, "resultContract.field.choice"));
      }
    }
    for (const effect of array(resultContract.effects ?? [], "resultContract.effects")) {
      oneOf(effect.kind, RESULT_EFFECT_KINDS, "resultContract.effect.kind");
      semanticKey(effect.effectKey, "resultContract.effect.effectKey");
    }
  }

  return grammar;
}
