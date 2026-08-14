import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const session = read("lib/atlas/session.ts");
const sequence = read("lib/atlas/worker-day-sequence-server.ts");
const route = read("app/api/atlas/worker-day-sequence/route.ts");

test("Atlas session timing separates user validation from concurrent identity reads", () => {
  for (const field of ["clientMs", "authUserMs", "profileMs", "farmMembershipsMs", "organizationMembershipsMs", "normalizeMs", "totalMs"]) {
    assert.match(session, new RegExp(`${field}: number`));
  }
  assert.match(session, /measured\(\(\) => createAtlasServerClient\(\)\)/);
  assert.match(session, /measured\(\(\) => supabase\.auth\.getUser\(\)\)/);
  assert.match(session, /Promise\.all\(\[/);
  assert.match(session, /user_profiles/);
  assert.match(session, /farm_memberships/);
  assert.match(session, /organization_memberships/);
});

test("session timing is opt-in and does not change ordinary Atlas session callers", () => {
  assert.match(session, /getAtlasSessionContext\(timing\?: AtlasSessionTiming\)/);
  assert.match(session, /getAtlasSession\(timing\?: AtlasSessionTiming\)/);
  assert.match(session, /if \(timing\) timing\.totalMs = elapsedMs\(totalStartedAt\)/);
  assert.doesNotMatch(session, /console\.(info|log|warn|error)/);
});

test("Worker Day diagnostic carries session phases without exposing them in the API response", () => {
  assert.match(sequence, /sessionPhases: AtlasSessionTiming/);
  assert.match(sequence, /getAtlasSessionFast\(timing\.sessionPhases\)/);
  assert.match(sequence, /clientMs: 0/);
  assert.match(sequence, /authUserMs: 0/);
  assert.match(sequence, /sessionContextRpcMs: 0/);
  assert.match(sequence, /farmMembershipsMs: 0/);
  assert.match(sequence, /organizationMembershipsMs: 0/);
  assert.doesNotMatch(route, /sessionPhases|authUserMs|sessionContextRpcMs|farmMembershipsMs|organizationMembershipsMs/);
});
