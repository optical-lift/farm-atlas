import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_ADJUDICATION_STATES,
  CLAIM_MODALITIES,
  WORK_MODES,
  assertWorkGrammarV1Package,
} from "../lib/atlas/work-grammar-v1-core.js";

function atomicPackage() {
  return {
    version: "work-grammar-v1",
    workIdentity: { kind: "work_item", id: "work-1" },
    acts: [{ actId: "act-1", mode: "change", operation: "spray" }],
    referents: [
      {
        referentId: "ref-bb10",
        role: "target",
        identity: { kind: "growing_object", id: "bb10-canonical-id" },
      },
    ],
    claims: [],
    relations: [
      {
        relationId: "rel-1",
        type: "at",
        from: { kind: "act", id: "act-1" },
        to: { kind: "referent", id: "ref-bb10" },
      },
    ],
    specifications: [
      {
        specificationId: "spec-pass",
        key: "pass_number",
        value: { kind: "number", value: 1, unit: "pass" },
        appliesTo: "act-1",
      },
    ],
    temporalContracts: [],
    constraints: [],
    requirements: [],
    gates: [],
    compositions: [],
    resultContracts: [
      {
        resultContractId: "result-1",
        acceptanceMode: "worker_attestation",
        appliesTo: "act-1",
        fields: [{ fieldKey: "completed", kind: "boolean", required: true }],
        effects: [{ kind: "state_transition", effectKey: "work_completed" }],
      },
    ],
  };
}

test("A2 governs the seven universal Work Act modes without turning operations into task types", () => {
  assert.deepEqual(WORK_MODES, [
    "change",
    "observe",
    "decide",
    "communicate",
    "transfer",
    "create",
    "plan",
  ]);

  const grammar = atomicPackage();
  grammar.acts[0].operation = "custom_domain_operation";
  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));

  grammar.acts[0].mode = "miscellaneous";
  assert.throws(() => assertWorkGrammarV1Package(grammar), /act\.mode is not governed/);
});

test("A2 rejects prose escape hatches inside canonical semantic boxes", () => {
  const grammar = atomicPackage();
  grammar.acts[0].instructions = "Spray this because the owner said so.";
  assert.throws(
    () => assertWorkGrammarV1Package(grammar),
    /instructions is a presentation\/prose field/,
  );

  const second = atomicPackage();
  second.constraints.push({
    constraintId: "constraint-1",
    kind: "method",
    ruleKey: "approved_treatment_method",
    note: "Use the black jug in the barn.",
  });
  assert.throws(
    () => assertWorkGrammarV1Package(second),
    /note is a presentation\/prose field/,
  );
});

test("A2 Referents require canonical identities instead of copied display nouns", () => {
  const grammar = atomicPackage();
  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));

  grammar.referents[0].identity = { kind: "growing_object", id: "" };
  assert.throws(
    () => assertWorkGrammarV1Package(grammar),
    /referent\.identity\.id must be a non-empty string/,
  );
});

test("A2 distinguishes Claim modality from adjudication", () => {
  assert.deepEqual(CLAIM_MODALITIES, [
    "observed",
    "authoritative_assertion",
    "derived",
    "planned",
    "forecast",
    "estimated",
    "unknown",
  ]);
  assert.deepEqual(CLAIM_ADJUDICATION_STATES, ["current", "disputed", "superseded"]);

  const grammar = atomicPackage();
  grammar.claims.push({
    claimId: "claim-treatment-count",
    subjectRef: "ref-bb10",
    predicate: "confirmed_treatment_count",
    value: { kind: "number", value: 0, unit: "count" },
    modality: "authoritative_assertion",
    adjudication: { state: "current", supersedesClaimIds: ["legacy-inference"] },
    provenance: { kind: "source_record", id: "owner-correction-2026-08-29" },
    effectiveAt: "2026-08-29T12:00:00-05:00",
  });
  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));

  grammar.claims[0].modality = "true";
  assert.throws(() => assertWorkGrammarV1Package(grammar), /claim\.modality is not governed/);
});

test("A2 keeps Constraint separate from Requirement and Gate evaluation", () => {
  const grammar = atomicPackage();
  grammar.constraints.push({
    constraintId: "constraint-dry",
    kind: "weather_environment",
    ruleKey: "surface_must_be_dry",
    appliesTo: "act-1",
  });
  grammar.requirements.push({
    requirementId: "requirement-sprayer",
    kind: "resource_state",
    requirementKey: "sprayer_available",
    satisfactionRuleKey: "resource_is_available",
    consequence: "block",
    appliesTo: "act-1",
  });
  grammar.gates.push({
    gateId: "gate-sprayer",
    requirementId: "requirement-sprayer",
    state: "needs_check",
    evidenceClaimIds: [],
    evaluatedAt: "2026-09-07T12:00:00-05:00",
  });

  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));

  grammar.gates[0].requirementId = "constraint-dry";
  assert.throws(
    () => assertWorkGrammarV1Package(grammar),
    /gate\.requirementId must reference a package Requirement/,
  );
});

test("A2 represents timing as typed temporal contracts rather than one due-date sentence", () => {
  const grammar = atomicPackage();
  grammar.temporalContracts.push(
    {
      temporalId: "time-not-before",
      kind: "not_before",
      value: { kind: "instant", at: "2026-09-07T08:00:00-05:00" },
      movementPolicy: "fixed",
      appliesTo: "act-1",
    },
    {
      temporalId: "time-window",
      kind: "preferred_window",
      value: {
        kind: "window",
        start: "2026-09-07T08:00:00-05:00",
        end: "2026-09-07T11:00:00-05:00",
      },
      movementPolicy: "bounded",
      appliesTo: "act-1",
    },
  );

  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));
});

test("A2 keeps Work identity separate from presentation composition", () => {
  const grammar = atomicPackage();
  grammar.acts.push({ actId: "act-2", mode: "change", operation: "spray" });
  grammar.compositions.push({
    compositionId: "composition-worker-line",
    kind: "paired_work",
    members: [
      { kind: "act", id: "act-1" },
      { kind: "act", id: "act-2" },
    ],
  });

  assert.equal(grammar.workIdentity.id, "work-1");
  assert.notEqual(grammar.workIdentity.id, grammar.compositions[0].compositionId);
  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));

  grammar.compositions[0].title = "Spray BB10 and BB walkways";
  assert.throws(
    () => assertWorkGrammarV1Package(grammar),
    /title is a presentation\/prose field/,
  );
});

test("A2 Result Contracts describe governed evidence rather than generic Done", () => {
  const grammar = atomicPackage();
  grammar.resultContracts[0] = {
    resultContractId: "result-harvest",
    acceptanceMode: "manager_acceptance",
    appliesTo: "act-1",
    fields: [
      { fieldKey: "stem_count", kind: "number", required: true, unit: "stems" },
      {
        fieldKey: "grade",
        kind: "choice",
        required: true,
        choices: ["market", "event", "reject"],
      },
    ],
    effects: [
      { kind: "inventory_movement", effectKey: "harvest_into_inventory" },
      { kind: "claim", effectKey: "harvest_result_observed" },
    ],
  };

  assert.doesNotThrow(() => assertWorkGrammarV1Package(grammar));
});
