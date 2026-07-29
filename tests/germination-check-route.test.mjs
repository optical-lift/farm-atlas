import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("germination cards can read and record results in the selected worker context", () => {
  const route = read("app/api/atlas/germination-check/route.ts");
  const migration = read("supabase/migrations/20260729192345_atlas_owner_operator_worker_parity_and_germination.sql");

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /owner_operator_germination_check_source_v1/);
  assert.match(route, /owner_operator_record_germination_check_v1/);
  assert.match(route, /record_germination_check_for_member_v1/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /effectiveMembershipId/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);

  assert.match(migration, /owner_operator_record_germination_check_v1/);
  assert.match(migration, /effective_membership_id/);
  assert.match(migration, /actor_membership_id/);
  assert.match(migration, /task\.visibility_scope = 'management'/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/i);
});
