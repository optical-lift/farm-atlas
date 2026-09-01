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

const READING_NOTEBOOK = {
  id: "reading_12_books",
  sourcePrefix: "person-life-reading-test",
  sourceKeys: {
    requirement: "completion-count-v1",
    rhythm: "reading-rhythm-v1",
    policy: "interruption-response-v1",
    evidence: "book",
    condition: "reading-interruption",
  },
  goalMatch: {
    patterns: ["\\bread\\s+12\\s+books\\b"],
    flags: "i",
  },
  empty: {
    title: "No active reading Goal yet.",
    body: "Test-only foreign notebook shape.",
  },
  heading: {
    eyebrow: "READING NOTEBOOK",
    intro: "Test-only foreign notebook shape.",
  },
  requirement: {
    key: "complete_12_books",
    stepLabel: "01 · completion count",
    statement: "12 completed books counts as completion.",
    explanation: "Discrete completions accumulate rather than taking a maximum measurement.",
    acceptLabel: "Accept 12-book requirement",
    acceptedFeedback: "12 completed books is accepted.",
  },
  rhythm: {
    claimType: "goal_rhythm_plan",
    stepLabel: "02 · rhythm",
    statement: "Sunday evening.",
    explanation: "A reading opportunity is not a Task or Clock placement.",
    acceptLabel: "Accept reading rhythm",
    acceptedFeedback: "The reading rhythm is accepted.",
    sectionTitle: "Upcoming reading",
    fallbackPresentationLabel: "Reading session",
    acceptedWindowNoun: "reading window",
    defaults: {
      weekdays: [0],
      localStartTime: "19:00",
      windowMinutes: 60,
      fallbackTimezone: "America/Chicago",
    },
  },
  evidence: {
    claimType: "book_completed",
    progressReducer: "count_claims",
    inputField: {
      primitive: "text",
      id: "bookId",
      label: "book",
      placeholder: "title or book identifier",
    },
    targetValue: 12,
    unit: "books",
    progressFractionDigits: 0,
    progressHeading: "READING PROGRESS",
    emptyMetricLabel: "no completed books yet",
    timeInputLabel: "when you finished it",
    logLabel: "Log completed book",
    invalidDraftMessage: "Choose a completed book and time.",
    recordedFeedback: "Book completion Evidence recorded.",
    provenanceLabel: "book completion Evidence",
  },
  policy: {
    effectKind: "rhythm_opportunity_presentation_overlay",
    targetKind: "goal_requirement_next_opportunity",
    stepLabel: "03 · response policy",
    statement: "If a reading session is interrupted, adapt the next reading opportunity.",
    explanation: "The observation does not create the response rule.",
    acceptLabel: "Accept interruption response",
    acceptedFeedback: "The interruption response is accepted.",
    sectionTitle: "Reading interruption flow",
    condition: {
      subjectDomain: "learning",
      subjectKind: "reading_session",
      subjectId: "reading:session",
      conditionState: "interrupted",
      displayLabel: "reading session interrupted",
      emptyLabel: "No matching interruption is recorded.",
      recordLabel: "Record reading interruption",
    },
    observationOnlyCopy: "Without an accepted response policy, this remains observation only.",
    authorizedCopy: "An already-accepted policy may adapt only the next reading opportunity.",
    observationOnlyFeedback: "The interruption was recorded without creating a response rule.",
    authorizedFeedback: "The interruption was evaluated only against the accepted response policy.",
  },
  api: {
    acceptRequirementAction: "accept_reading_requirement_test_only",
    acceptRhythmAction: "accept_reading_rhythm_test_only",
    acceptPolicyAction: "accept_reading_policy_test_only",
    recordEvidenceAction: "record_book_completed_test_only",
    recordConditionAction: "record_reading_interruption_test_only",
  },
};

test("catalog goal matching is declarative instead of hard-coded into the page", () => {
  assert.equal(matchesPersonLifeNotebookGoal(goal, FIVE_K_PERSON_LIFE_NOTEBOOK), true);
  assert.equal(matchesPersonLifeNotebookGoal({ ...goal, lifeSignal: { state: { explicitUserEnd: "Write a novel" } } }, FIVE_K_PERSON_LIFE_NOTEBOOK), false);
  assert.equal(notebookPolicyMatchesGoal(policy, goal.definitionId, FIVE_K_PERSON_LIFE_NOTEBOOK), true);
});

test("generic notebook projector preserves 5K max-value Evidence progress", () => {
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
      {
        claimId: "44444444-4444-4444-8444-444444444445",
        claimType: "run_distance",
        lifecycleState: "observed",
        subject: { domain: "training", kind: "run", id: "run:1" },
        value: { distanceKm: 4, unit: "km" },
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
  assert.equal(FIVE_K_PERSON_LIFE_NOTEBOOK.evidence.inputField.primitive, "quantity");
  assert.equal(FIVE_K_PERSON_LIFE_NOTEBOOK.evidence.inputField.id, "distanceKm");
  assert.equal(FIVE_K_PERSON_LIFE_NOTEBOOK.evidence.progressFractionDigits, 2);
  assert.equal(model.progressValue, 4);
  assert.equal("bestMetric" in model, false);
  assert.equal(model.progressPercent, 80);
  assert.equal(model.satisfiedCount, 1);
  assert.equal(model.opportunities.length, 1);
  assert.equal(model.matchingCondition.condition_state, "aching_after_mile_2");
});

test("foreign reading shape accumulates governed completion Evidence through the same notebook core", () => {
  const readingGoal = {
    definitionId: "77777777-7777-4777-8777-777777777777",
    signalKind: "goal",
    status: "active",
    lifeSignal: {
      state: { explicitUserEnd: "I want to read 12 books" },
      requirements: [{
        requirementKey: "complete_12_books",
        evidenceSelector: { subject: { domain: "learning", kind: "reading_goal", id: "reading:1" } },
      }],
    },
  };
  const readingPolicy = {
    definitionId: "88888888-8888-4888-8888-888888888888",
    signalKind: "consequence",
    status: "active",
    lifeSignal: {
      requirements: [{
        policy: {
          actionSpec: {
            effectKind: "rhythm_opportunity_presentation_overlay",
            target: {
              kind: "goal_requirement_next_opportunity",
              goalDefinitionId: readingGoal.definitionId,
              goalRequirementKey: "complete_12_books",
            },
          },
        },
      }],
    },
  };
  const readingPlanClaimId = "99999999-9999-4999-8999-999999999999";
  const readingSubject = { domain: "learning", kind: "reading_goal", id: "reading:1" };
  const state = {
    definitions: [readingGoal, readingPolicy],
    currentClaims: [
      {
        claimId: readingPlanClaimId,
        claimType: "goal_rhythm_plan",
        lifecycleState: "accepted",
        value: { goalDefinitionId: readingGoal.definitionId, goalRequirementKey: "complete_12_books" },
      },
      {
        claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        claimType: "book_completed",
        lifecycleState: "observed",
        subject: readingSubject,
        value: { bookId: "book:1" },
      },
      {
        claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        claimType: "book_completed",
        lifecycleState: "observed",
        subject: readingSubject,
        value: { bookId: "book:2" },
      },
      {
        claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        claimType: "book_completed",
        lifecycleState: "observed",
        subject: readingSubject,
        value: { bookId: "book:3" },
      },
      {
        claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        claimType: "book_completed",
        lifecycleState: "observed",
        subject: { domain: "learning", kind: "reading_goal", id: "reading:someone-else" },
        value: { bookId: "book:wrong-subject" },
      },
      {
        claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        claimType: "book_completed",
        lifecycleState: "accepted",
        subject: readingSubject,
        value: { bookId: "book:not-observed" },
      },
    ],
    rhythmOpportunities: [{
      opportunityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      planClaimId: readingPlanClaimId,
      projectionState: "satisfied",
      startsAt: "2026-09-06T00:00:00Z",
    }],
    conditions: [{
      subject_domain: "learning",
      subject_kind: "reading_session",
      subject_id: "reading:session",
      condition_state: "interrupted",
    }],
  };

  const selected = selectPersonLifeNotebook([FIVE_K_PERSON_LIFE_NOTEBOOK, READING_NOTEBOOK], state);
  assert.equal(selected?.spec.id, "reading_12_books");
  assert.equal(selected?.spec.evidence.inputField.primitive, "text");
  assert.equal(selected?.spec.evidence.inputField.id, "bookId");
  assert.equal(selected?.spec.evidence.progressFractionDigits, 0);
  assert.equal(selected?.model.goal.definitionId, readingGoal.definitionId);
  assert.equal(selected?.model.requirementAccepted, true);
  assert.equal(selected?.model.rhythmAccepted, true);
  assert.equal(selected?.model.policyAccepted, true);
  assert.equal(selected?.model.evidenceClaims.length, 3);
  assert.equal(selected?.model.progressValue, 3);
  assert.equal("bestMetric" in selected.model, false);
  assert.equal(selected?.model.progressPercent, 25);
  assert.equal(selected?.model.satisfiedCount, 1);
  assert.equal(selected?.model.matchingCondition.condition_state, "interrupted");
  assert.equal("metricPath" in READING_NOTEBOOK.evidence, false);
});
