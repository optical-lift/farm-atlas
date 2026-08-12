import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812210500_aug18_truthful_worker_packet_hold_v1.sql", import.meta.url),
  "utf8",
);

test("undefined basement work is held out of the Farm Hand packet instead of invented", () => {
  assert.match(migration, /Prepare Farm Work Area in Basement/);
  assert.match(migration, /visibility_scope='system_internal'/);
  assert.match(migration, /Owner definition required before this can return to the Farm Hand packet/);
  assert.match(migration, /owner_definition_required/);
});

test("spray work cannot release without the real product and application method", () => {
  assert.match(migration, /Spray product and application method are not recorded/);
  assert.match(migration, /worker_method_required/);
  assert.match(migration, /workerPacketHoldReason/);
});

test("iris child instructions use only the canonical rhizome and drift truth already recorded", () => {
  assert.match(migration, /Replant Front Iris Clump 2 in Lilac Haven/);
  assert.match(migration, /rhizome divisions from Front Iris Clump 2/);
  assert.match(migration, /Lilac Haven as part of the iris drift/);
  assert.match(migration, /operation_move','replant_division'/);
});
