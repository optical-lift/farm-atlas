import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesPersonLifeNotebookGoal,
  notebookPolicyMatchesGoal,
  projectPersonLifeNotebook,
  selectPersonLifeNotebook,
} from "../lib/atlas/person-life-notebook-core.js";
import { FIVE_K_PERSON_LIFE_NOTEBOOK } from "../lib/atlas/person-life-notebook-catalog.js";

const goal = {
  definitionId: "11111111-1111-4111-8111-111111111111",
  signalKind: "goal",
  status: "active",
  lifeSignal: {
    state: { explicitUserEnd: "I want to run a 5K" },
    requirements: [{
      requirementKey: "complete_5k",
      evidenceSelector: { subject: { domain: "training", kind: "run", id: "run:1" } },
    }],
  },
};

const policy = {
  definitionId: "22222222-2222-4222-8222-222222222222",
  signalKind: "consequence",
  status: "active",
  lifeSignal: {
    requirements: [{
      policy: {
        actionSpec: {
          effectKind: "rhythm_opportunity_presentation_overlay",
          target: {
            kind: "goal_requirement_next_opportunity",
            goalDefinitionId: goal.definitionId,
            goalRequirementKey: "complete_5k",
          },
        },
      },
    }],
  },
};

test("catalog goal matching is declarative instead of hard-coded into the page", () => {
  assert.equal(matchesPersonLifeNotebookGoal(goal, FIVE_K_PERSON_LIFE_NOTEBOOK), true);
  assert.equal(matchesPersonLifeNotebookGoal({ ...goal, lifeSignal: { state: { explicitUserEnd: "Write a novel" } } }, FIVE_K_PERSON_LIFE_NOTEBOOK), false);
  assert.equal(notebookPolicyMatchesGoal(policy, goal.definitionId, FIVE_K_PERSON_LIFE_NOTEBOOK), true);
});

test("generic notebook projector derives accepted authority and Evidence progress without creating it", () => {
  const state = {
    definitions: [goal, policy],
    currentClaims: [
      {
        claimId: "33333333-3333-4333-8333-333333333333",
        claimType: "goal_rhythm_plan",
        lifecycleState: "accepted",
        value: { goalDefinitionId: goal.definitionId, goalRequirementKey: "complete_5k" },
      },
      {
        claimId: "44444444-4444-4444-8444-444444444444",
        claimType: "run_distance",
        lifecycleState: "observed",
        subject: { domain: "training", kind: "run", id: "run:1" },
        value: { distanceKm: 3.25, unit: "km" },
      },
    ],
    rhythmOpportunities: [
      {
        opportunityId: "55555555-5555-4555-8555-555555555555",
        planClaimId: "33333333-3333-4333-8333-333333333333",
        projectionState: "satisfied",
        startsAt: "2026-08-31T22:00:00Z",
      },
      {
        opportunityId: "66666666-6666-4666-8666-666666666666",
        planClaimId: "33333333-3333-4333-8333-333333333333",
        projectionState: "withdrawn",
        startsAt: "2026-09-02T22:00:00Z",
      },
    ],
    conditions: [{
      subject_domain: "body",
      subject_kind: "body_region",
      subject_id: "right_knee",
      condition_state: "aching_after_mile_2",
    }],
  };

  const model = projectPersonLifeNotebook(FIVE_K_PERSON_LIFE_NOTEBOOK, state);
  assert.equal(model.goal.definitionId, goal.definitionId);
  assert.equal(model.requirementAccepted, true);
  assert.equal(model.rhythmAccepted, true);
  assert.equal(model.policyAccepted, true);
  assert.equal(model.bestMetric, 3.25);
  assert.equal(model.progressPercent, 65);
  assert.equal(model.satisfiedCount, 1);
  assert.equal(model.opportunities.length, 1);
  assert.equal(model.matchingCondition.condition_state, "aching_after_mile_2");
});

test("notebook selection can grow by catalog entry without adding another page", () => {
  const alternate = {
    ...FIVE_K_PERSON_LIFE_NOTEBOOK,
    id: "writing_goal",
    goalMatch: { patterns: ["\\bwrite a novel\\b"], flags: "i" },
  };
  const writingGoal = {
    definitionId: "77777777-7777-4777-8777-777777777777",
    signalKind: "goal",
    status: "active",
    lifeSignal: { state: { explicitUserEnd: "Write a novel" }, requirements: [] },
  };

  const selected = selectPersonLifeNotebook([FIVE_K_PERSON_LIFE_NOTEBOOK, alternate], {
    definitions: [writingGoal],
    currentClaims: [],
    rhythmOpportunities: [],
    conditions: [],
  });
  assert.equal(selected?.spec.id, "writing_goal");
  assert.equal(selected?.model.goal.definitionId, writingGoal.definitionId);
  assert.equal(selected?.model.requirementAccepted, false);
});
