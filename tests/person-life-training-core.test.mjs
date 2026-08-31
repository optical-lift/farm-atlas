import assert from "node:assert/strict";
import test from "node:test";

import {
  FIVE_K_REQUIREMENT_KEY,
  buildFiveKGuardrailCapture,
  buildFiveKRequirementCapture,
  buildFiveKRhythmPlanCapture,
  buildRunDistanceCapture,
} from "../lib/atlas/person-life-training-core.js";

const owner = "11111111-1111-4111-8111-111111111111";
const goalDefinitionId = "22222222-2222-4222-8222-222222222222";
const goalSubject = { domain: "personal", kind: "goal", id: "goal:5k:1" };

test("5K measurement is a separate accepted requirement, not an inference from the Goal label", () => {
  const result = buildFiveKRequirementCapture({
    goalSubject,
    sourceKey: "five-k:measurement:1",
    observedAt: "2026-08-31T17:00:00-05:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.capture.claim.claimType, "goal_requirement");
  assert.equal(result.value.capture.claim.lifecycleState, "accepted");
  assert.equal(result.value.requirement.requirementKey, FIVE_K_REQUIREMENT_KEY);
  assert.equal(result.value.requirement.criterion.value, 5);
  assert.equal(result.value.requirement.criterion.unit, "km");
  assert.deepEqual(result.value.requirement.evidenceSelector.authorityKinds, [
    "person_reported_observation",
    "person_correction",
  ]);
});

test("accepted cadence owns exact weekly windows but no Task or Clock authority", () => {
  const runSubject = { domain: "training", kind: "run", id: "goal:5k:1:five_k_run" };
  const result = buildFiveKRhythmPlanCapture({
    goalDefinitionId,
    goalSubject,
    runSubject,
    sourceKey: "five-k:rhythm:1",
    acceptedAt: "2026-08-31T17:01:00-05:00",
    timezone: "America/Chicago",
    weekdays: [1, 3, 5],
    localStartTime: "17:00",
    windowMinutes: 90,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.capture.claim.claimType, "goal_rhythm_plan");
  assert.equal(result.value.plan.goalRequirementKey, FIVE_K_REQUIREMENT_KEY);
  assert.deepEqual(result.value.plan.opportunityPlan.weekdays, [1, 3, 5]);
  assert.equal(result.value.plan.opportunityPlan.localStartTime, "17:00");
  assert.equal("task" in result.value.plan, false);
  assert.equal("clock" in result.value.plan, false);
});

test("knee response is a separately accepted policy with an exact presentation-only action", () => {
  const result = buildFiveKGuardrailCapture({
    ownerUserId: owner,
    goalDefinitionId,
    sourceKey: "five-k:guardrail:1",
    acceptedAt: "2026-08-31T17:02:00-05:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.policyCapture.claim.claimType, "consequence_policy");
  const requirement = result.value.policyCapture.claim.value.requirements[0];
  assert.deepEqual(requirement.policy.subjectSelector, {
    subject: { domain: "body", kind: "body_region", id: "right_knee" },
  });
  assert.deepEqual(requirement.policy.stateMatch, {
    claim: {
      claimType: "condition_observation",
      lifecycleState: "observed",
      value: { conditionState: "aching_after_mile_2" },
    },
  });
  assert.equal(requirement.policy.actionSpec.effectKind, "rhythm_opportunity_presentation_overlay");
  assert.equal(requirement.policy.actionSpec.target.kind, "goal_requirement_next_opportunity");
  assert.equal(requirement.policy.actionSpec.target.goalDefinitionId, goalDefinitionId);
  assert.equal(requirement.policy.actionSpec.target.goalRequirementKey, FIVE_K_REQUIREMENT_KEY);
  assert.equal(requirement.policy.actionSpec.presentationOverlay.label, "Recovery-paced 5K run");
  assert.equal("task" in requirement.policy.actionSpec, false);
  assert.equal("clock" in requirement.policy.actionSpec, false);

  const definition = result.value.buildDefinition("33333333-3333-4333-8333-333333333333");
  assert.equal(definition.signal.source.domain, "claim_evidence");
  assert.equal(definition.signal.source.kind, "claim");
  assert.equal(definition.signal.signalKind, "consequence");
});

test("run distance capture remains observed evidence instead of completion authority", () => {
  const result = buildRunDistanceCapture({
    runSubject: { domain: "training", kind: "run", id: "goal:5k:1:five_k_run" },
    sourceKey: "five-k:run:1",
    observedAt: "2026-08-31T17:30:00-05:00",
    distanceKm: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.claim.claimType, "run_distance");
  assert.equal(result.value.claim.lifecycleState, "observed");
  assert.deepEqual(result.value.claim.value, { distanceKm: 3, unit: "km" });
  assert.equal("goalState" in result.value.claim.value, false);
});
