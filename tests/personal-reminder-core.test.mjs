import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPersonalReminderCapture,
  buildPersonalReminderCompletionCapture,
} from "../lib/atlas/personal-reminder-core.js";

const reminderId = "9c201907-0d7d-4c29-a58c-83076bc6162a";
const claimId = "7fd39d07-830f-46a4-b295-8593b536a070";

test("private reminder capture stays a person Claim rather than becoming a Task or Clock placement", () => {
  const built = buildPersonalReminderCapture({
    reminderId,
    label: "Clean the toilet",
    dueDate: "2026-09-02",
    recordedAt: "2026-08-31T22:00:00Z",
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.value.subject, { domain: "personal", kind: "reminder", id: reminderId });
  assert.equal(built.value.claim.claimType, "personal_reminder");
  assert.equal(built.value.claim.lifecycleState, "accepted");
  assert.equal(built.value.claim.metadata.privacy, "private");
  assert.equal(built.value.claim.value.state, "open");
  assert.equal("taskId" in built.value.claim.value, false);
  assert.equal("clockPlacement" in built.value.claim.value, false);
});

test("completing a private reminder supersedes its current claim and preserves the same subject", () => {
  const built = buildPersonalReminderCompletionCapture({
    reminderId,
    currentClaimId: claimId,
    currentValue: {
      reminderId,
      label: "Clean the toilet",
      note: "Downstairs bath",
      dueDate: "2026-09-02",
      state: "open",
    },
    completedAt: "2026-09-02T17:00:00Z",
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.value.subject, { domain: "personal", kind: "reminder", id: reminderId });
  assert.equal(built.value.claim.supersedesClaimId, claimId);
  assert.equal(built.value.claim.value.state, "done");
  assert.equal(built.value.evidence.kind, "personal_reminder_completion_report");
});

test("reminder capture rejects an invalid date rather than inventing timing truth", () => {
  const built = buildPersonalReminderCapture({
    reminderId,
    label: "Clean the toilet",
    dueDate: "tomorrow",
    recordedAt: "2026-08-31T22:00:00Z",
  });

  assert.equal(built.ok, false);
  assert.match(built.error, /YYYY-MM-DD/);
});

test("reminder capture rejects an overlong label", () => {
  const built = buildPersonalReminderCapture({
    reminderId,
    label: "x".repeat(241),
    recordedAt: "2026-08-31T22:00:00Z",
  });

  assert.equal(built.ok, false);
});
