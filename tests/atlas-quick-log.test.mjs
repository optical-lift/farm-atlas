import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuickLogResult,
  validateQuickLogInput,
} from "../lib/atlas/quick-log-core.js";

const zoneId = "466cd2f3-74b2-4eea-b489-e708426e8dc3";
const objectId = "0bff25f3-8dff-4eab-8bbb-7a87ea058e24";

test("normalizes a flexible farm Quick Log without flattening action language", () => {
  const input = validateQuickLogInput({
    logDate: "2026-07-21",
    actionTypes: [" Water ", "germination_check", "water"],
    summarySentence: "  Checked and watered Field Row 1.  ",
    note: "  Seedlings are holding.  ",
    zoneIds: [zoneId, zoneId],
    objectIds: [objectId],
    idempotencyKey: "quick-log-device-1-0001",
  });

  assert.deepEqual(input, {
    logDate: "2026-07-21",
    actionTypes: ["germination_check", "water"],
    summarySentence: "Checked and watered Field Row 1.",
    note: "Seedlings are holding.",
    zoneIds: [zoneId],
    objectIds: [objectId],
    idempotencyKey: "quick-log-device-1-0001",
  });
});

test("rejects invalid targets and empty action sets before database access", () => {
  assert.throws(
    () =>
      validateQuickLogInput({
        logDate: "2026-07-21",
        actionTypes: [],
        summarySentence: "Checked the bed.",
        idempotencyKey: "quick-log-0002",
      }),
    /1 to 12 actions/,
  );

  assert.throws(
    () =>
      validateQuickLogInput({
        logDate: "2026-07-21",
        actionTypes: ["observed"],
        summarySentence: "Checked the bed.",
        objectIds: ["not-a-uuid"],
        idempotencyKey: "quick-log-0003",
      }),
    /invalid identifier/,
  );
});

test("rejects journal overflow and malformed action tokens", () => {
  assert.throws(
    () =>
      validateQuickLogInput({
        logDate: "2026-07-21",
        actionTypes: ["observed; drop table"],
        summarySentence: "Checked the bed.",
        idempotencyKey: "quick-log-0004",
      }),
    /unsupported characters/,
  );

  assert.throws(
    () =>
      validateQuickLogInput({
        logDate: "2026-07-21",
        actionTypes: ["observed"],
        summarySentence: "Checked the bed.",
        note: "x".repeat(4001),
        idempotencyKey: "quick-log-0005",
      }),
    /4000 characters/,
  );
});

test("projects first writes and idempotent replays consistently", () => {
  const first = buildQuickLogResult({
    field_log_id: "log-1",
    actor_membership_id: "membership-anna",
    actor_role: "farm_hand",
    zone_link_count: 1,
    object_link_count: 1,
    replayed: false,
  });
  const replay = buildQuickLogResult({
    field_log_id: "log-1",
    actor_membership_id: "membership-anna",
    actor_role: "farm_hand",
    zone_link_count: "1",
    object_link_count: "1",
    replayed: true,
  });

  assert.deepEqual(first, {
    fieldLogId: "log-1",
    actorMembershipId: "membership-anna",
    actorRole: "farm_hand",
    zoneLinkCount: 1,
    objectLinkCount: 1,
    replayed: false,
  });
  assert.equal(replay.fieldLogId, first.fieldLogId);
  assert.equal(replay.zoneLinkCount, first.zoneLinkCount);
  assert.equal(replay.objectLinkCount, first.objectLinkCount);
  assert.equal(replay.replayed, true);
});
