import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260814212629_current_session_context_fast_path_v1.sql");
const sessionServer = read("lib/atlas/session.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");

test("current session projection has no caller-supplied identity and validates the live auth session", () => {
  assert.match(migration, /function atlas\.current_session_context_api_v1\(\)/);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/);
  assert.match(migration, /v_claims jsonb := auth\.jwt\(\)/);
  assert.match(migration, /v_session_id := nullif\(v_claims ->> 'session_id', ''\)::uuid/);
  assert.match(migration, /from auth\.sessions session/);
  assert.match(migration, /session\.id = v_session_id/);
  assert.match(migration, /session\.user_id = v_uid/);
  assert.match(migration, /session\.not_after is null or session\.not_after > now\(\)/);
  assert.doesNotMatch(migration, /p_user_id|p_session_id|p_membership_id|p_farm_id/);
});

test("current session projection preserves live user and Atlas membership truth", () => {
  assert.match(migration, /from auth\.users user_row/);
  assert.match(migration, /user_row\.id = v_uid/);
  assert.match(migration, /user_row\.deleted_at is null/);
  assert.match(migration, /user_row\.banned_until is null or user_row\.banned_until <= now\(\)/);
  assert.match(migration, /from atlas\.user_profiles profile/);
  assert.match(migration, /from atlas\.farm_memberships membership/);
  assert.match(migration, /membership\.user_id = v_uid/);
  assert.match(migration, /membership\.active = true/);
  assert.match(migration, /from atlas\.organization_memberships membership/);
  assert.match(migration, /organizationMemberships/);
});

test("current session projection is an authenticated governed endpoint", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to 'pg_catalog', 'atlas', 'auth'/);
  assert.match(migration, /revoke all on function atlas\.current_session_context_api_v1\(\) from public/);
  assert.match(migration, /revoke all on function atlas\.current_session_context_api_v1\(\) from anon/);
  assert.match(migration, /grant execute on function atlas\.current_session_context_api_v1\(\) to authenticated/);
  assert.match(migration, /grant execute on function atlas\.current_session_context_api_v1\(\) to service_role/);
  assert.match(migration, /atlas\.authenticated_rpc_registry/);
  assert.match(migration, /atlas\.current_session_context_api_v1\(\)/);
});

test("Worker Day uses one fast session RPC while full session context keeps fresh Supabase User semantics", () => {
  const fastStart = sessionServer.indexOf("export async function getAtlasSessionFast");
  const fastEnd = sessionServer.indexOf("export async function getAtlasSession(", fastStart);
  const fastBody = sessionServer.slice(fastStart, fastEnd);
  const fullStart = sessionServer.indexOf("export async function getAtlasSessionContext");
  const fullEnd = fastStart;
  const fullBody = sessionServer.slice(fullStart, fullEnd);

  assert.match(fastBody, /\.rpc\("current_session_context_api_v1"\)/);
  assert.equal((fastBody.match(/current_session_context_api_v1/g) ?? []).length, 1);
  assert.doesNotMatch(fastBody, /auth\.getUser\(\)/);
  assert.match(fastBody, /normalizeAtlasSession\(/);
  assert.match(fastBody, /profile\?\.active === false/);

  assert.match(fullBody, /supabase\.auth\.getUser\(\)/);
  assert.match(fullBody, /Promise\.all\(\[/);
  assert.match(fullBody, /from\("user_profiles"\)/);
  assert.match(fullBody, /from\("farm_memberships"\)/);
  assert.match(fullBody, /from\("organization_memberships"\)/);

  const sequenceStart = sequenceServer.indexOf("export async function readWorkerDaySequence");
  const sequenceBody = sequenceServer.slice(sequenceStart);
  assert.match(sequenceBody, /getAtlasSessionFast\(timing\.sessionPhases\)/);
  assert.doesNotMatch(sequenceBody, /getAtlasSession\(timing\.sessionPhases\)/);
  assert.match(sequenceServer, /sessionContextRpcMs: 0/);
});
