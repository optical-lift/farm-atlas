import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPersonConditionObservationCapture,
  buildPersonGoalCapture,
  normalizePersonLifeCaptureInput,
} from "../lib/atlas/person-life-capture-core.js";

test("explicit 5K goal creates no requirements, rhythm, task, or placement claim", () => {
  const result = buildPersonGoalCapture({
    ownerUserId: "11111111-1111-1111-1111-111111111111",
    sourceKey: "goal:5k:1",
    text: "I want to run a 5K.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.signal.signalKind, "goal");
  assert.equal(result.value.signal.state.explicitUserEnd, "I want to run a 5K.");
  assert.deepEqual(result.value.signal.requirements, []);
  assert.deepEqual(result.value.signal.relations, []);
  assert.equal(result.value.signal.scope.kind, "person");
  assert.equal(result.value.signal.epistemic.interpretationAuthority, "person");
  assert.equal("rhythm" in result.value.signal.state, false);
  assert.equal("task" in result.value.signal.state, false);
  assert.equal("placement" in result.value.signal.state, false);
});

test("body observation preserves raw report and establishes neither cause nor diagnosis", () => {
  const result = buildPersonConditionObservationCapture({
    sourceKey: "condition:left-hip:1",
    bodyRegion: "left hip",
    observation: "felt tight afterward",
    observedAt: "2026-09-01T08:30:00-05:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.subjectDomain, "body");
  assert.equal(result.value.subjectKind, "body_region");
  assert.equal(result.value.subjectId, "left_hip");
  assert.equal(result.value.conditionState, "felt_tight_afterward");
  assert.equal(result.value.note, "felt tight afterward");
  assert.equal(result.value.metadata.causeEstablished, false);
  assert.equal(result.value.metadata.diagnosisEstablished, false);
  assert.equal("disposition" in result.value, false);
});

test("freeform capture is rejected unless the human declares the capture type", () => {
  const result = normalizePersonLifeCaptureInput(
    { sourceKey: "capture:1", text: "I want to run a 5K." },
    "11111111-1111-1111-1111-111111111111",
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /explicit person-life capture type/i);
});
