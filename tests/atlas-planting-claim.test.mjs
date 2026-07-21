import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlantingClaimResult,
  validatePlantingClaimInput,
} from "../lib/atlas/planting-claim-core.js";

const objectId = "68fbd32a-4a5f-48df-a23c-e45d29e62287";
const profileId = "b1b7ea90-778b-447b-b71a-34c544dcbc82";

test("normalizes a complete management planting claim", () => {
  const claim = validatePlantingClaimInput({
    plantedDate: "2026-07-21",
    cropLabel: " Sunflower ",
    variety: " mixed pollenless sunflower ",
    plantingMethod: "DIRECT_SOW",
    amount: "270",
    unit: " seeds ",
    objectIds: [objectId, objectId],
    cropProfileId: profileId,
    coverageKind: "full_bed",
    bedLengthFt: "30",
    bedWidthFt: 3,
    confidence: "field_logged",
    note: " Full bed succession. ",
    idempotencyKey: "planting-device-1-0001",
  });

  assert.deepEqual(claim, {
    plantedDate: "2026-07-21",
    cropLabel: "Sunflower",
    variety: "mixed pollenless sunflower",
    plantingMethod: "direct_sow",
    amount: 270,
    unit: "seeds",
    objectIds: [objectId],
    cropProfileId: profileId,
    coverageKind: "full_bed",
    bedLengthFt: 30,
    bedWidthFt: 3,
    confidence: "field_logged",
    note: "Full bed succession.",
    idempotencyKey: "planting-device-1-0001",
  });
});

test("requires real farm objects, positive quantity, and supported method", () => {
  assert.throws(
    () =>
      validatePlantingClaimInput({
        plantedDate: "2026-07-21",
        cropLabel: "Sunflower",
        plantingMethod: "direct_sow",
        amount: 270,
        unit: "seeds",
        objectIds: [],
        idempotencyKey: "planting-0002",
      }),
    /1 to 50 records/,
  );

  assert.throws(
    () =>
      validatePlantingClaimInput({
        plantedDate: "2026-07-21",
        cropLabel: "Sunflower",
        plantingMethod: "imaginary_method",
        amount: 270,
        unit: "seeds",
        objectIds: [objectId],
        idempotencyKey: "planting-0003",
      }),
    /unsupported/,
  );

  assert.throws(
    () =>
      validatePlantingClaimInput({
        plantedDate: "2026-07-21",
        cropLabel: "Sunflower",
        plantingMethod: "direct_sow",
        amount: 0,
        unit: "seeds",
        objectIds: [objectId],
        idempotencyKey: "planting-0004",
      }),
    /greater than zero/,
  );
});

test("rejects malformed profile and object identifiers", () => {
  assert.throws(
    () =>
      validatePlantingClaimInput({
        plantedDate: "2026-07-21",
        cropLabel: "Sunflower",
        plantingMethod: "direct_sow",
        amount: 270,
        unit: "seeds",
        objectIds: ["not-an-object"],
        idempotencyKey: "planting-0005",
      }),
    /invalid identifier/,
  );

  assert.throws(
    () =>
      validatePlantingClaimInput({
        plantedDate: "2026-07-21",
        cropLabel: "Sunflower",
        plantingMethod: "direct_sow",
        amount: 270,
        unit: "seeds",
        objectIds: [objectId],
        cropProfileId: "not-a-profile",
        idempotencyKey: "planting-0006",
      }),
    /Crop profile is invalid/,
  );
});

test("projects linked farm memory and profile-derived timing", () => {
  const result = buildPlantingClaimResult({
    planting_claim_id: "claim-1",
    field_log_id: "log-1",
    actor_membership_id: "membership-owner",
    actor_role: "owner",
    object_count: "1",
    object_content_count: 1,
    crop_cycle_count: 1,
    expected_germination_start: "2026-07-25",
    expected_germination_end: "2026-07-31",
    expected_harvest_watch_start: "2026-09-09",
    expected_harvest_watch_end: "2026-09-24",
    expected_clear_date: "2026-09-29",
    replayed: false,
  });

  assert.deepEqual(result, {
    plantingClaimId: "claim-1",
    fieldLogId: "log-1",
    actorMembershipId: "membership-owner",
    actorRole: "owner",
    objectCount: 1,
    objectContentCount: 1,
    cropCycleCount: 1,
    timing: {
      germinationStart: "2026-07-25",
      germinationEnd: "2026-07-31",
      harvestWatchStart: "2026-09-09",
      harvestWatchEnd: "2026-09-24",
      expectedClearDate: "2026-09-29",
    },
    replayed: false,
  });
});
