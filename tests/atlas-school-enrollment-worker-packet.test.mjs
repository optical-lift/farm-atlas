import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260812171420_school_enrollment_worker_packet_v1.sql");

test("School and Preschool Enrollment follows the current literal next work", () => {
  assert.match(migration, /anna_20260805_school_preschool_enrollment/);
  assert.match(migration, /Request the needed records from JSE/);
  assert.match(migration, /Email the enrollment documents that are ready to send/);
  assert.match(migration, /Look for the birth certificates needed for enrollment/);
  assert.match(migration, /birth certificates are either found or recorded as still missing/);
});

test("school enrollment normalization changes execution copy, not schedule truth", () => {
  assert.doesNotMatch(migration, /set\s+due_date\s*=/i);
  assert.doesNotMatch(migration, /commitment_kind\s*=/i);
  assert.doesNotMatch(migration, /work_lane\s*=/i);
  assert.match(migration, /stable_key = 'elm_farm'/);
  assert.doesNotMatch(migration, /7628fa29-d019-4d89-baa3-3535ed172f7f/);
});
