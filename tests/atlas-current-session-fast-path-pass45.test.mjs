import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const sessionServer = read("lib/atlas/session.ts");
const sessionCore = read("lib/atlas/session-core.js");
const authCore = read("lib/atlas/auth-core.js");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");

test("all application session hydration uses the Reality-rooted v2 RPC", () => {
  assert.match(sessionServer, /\.rpc\("current_session_context_api_v2"\)/);
  assert.doesNotMatch(sessionServer, /\.rpc\("current_session_context_api_v1"\)/);
  assert.doesNotMatch(sessionServer, /from\("organization_memberships"\)/);
  assert.doesNotMatch(sessionServer, /from\("farm_memberships"\)/);
  assert.match(sessionServer, /return getAtlasSessionFast\(timing\)/);
});

test("session activation is Reality Person plus Personal Atlas, not legacy organization membership", () => {
  assert.match(authCore, /session\.realityState !== "ready"/);
  assert.match(authCore, /session\.personEntityId/);
  assert.match(authCore, /session\.personalAtlasId/);
  assert.doesNotMatch(authCore, /if \(!activeMembership && !activeOrganizationMembership\)/);
  assert.match(sessionCore, /personEntityId/);
  assert.match(sessionCore, /personalAtlasId/);
  assert.match(sessionCore, /ledgerSeats/);
});

test("Worker Day keeps using the fast session reader", () => {
  const sequenceStart = sequenceServer.indexOf("export async function readWorkerDaySequence");
  const sequenceBody = sequenceServer.slice(sequenceStart);
  assert.match(sequenceBody, /getAtlasSessionFast\(timing\.sessionPhases\)/);
});
