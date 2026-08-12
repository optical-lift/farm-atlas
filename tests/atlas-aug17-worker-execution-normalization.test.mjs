import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812203500_aug17_worker_execution_normalization_v1.sql", import.meta.url),
  "utf8",
);

test("Aug 17 repair and Entry Billboard reset have literal worker execution contracts", () => {
  assert.match(migration, /Repair the Curve Garden Arch 3 beds and the small Follow Me Arch 2 right bed/);
  assert.match(migration, /All three raised-bed frames are square, fastened, stable, and ready to fill/);
  assert.match(migration, /Reset Entry Billboard Beds 1–6 for the fall lettuce and spinach starts/);
  assert.match(migration, /EB1–EB6 are level, clear, and planting-ready for the fall lettuce and spinach starts/);
});

test("Aug 17 lettuce and spinach remain blocked continuations with explicit transplant instructions", () => {
  assert.match(migration, /Wait until the EB1–EB6 reset is complete/);
  assert.match(migration, /do not invent a bed-by-bed split in advance/);
  assert.match(migration, /coolest workable morning or evening/);
  assert.match(migration, /water every start in thoroughly/);
  assert.match(migration, /operation_move','transplant'/);
});
