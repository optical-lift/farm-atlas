import assert from "node:assert/strict";
import test from "node:test";

import {
  atlasPostLoginPath,
  classifyAtlasSession,
  normalizeAtlasLoginCredentials,
  roleHomeForMembership,
} from "../lib/atlas/auth-core.js";
import { ATLAS_IDENTITY_FIXTURES } from "../lib/atlas/identity-fixtures.js";
import { normalizeAtlasSession } from "../lib/atlas/session-core.js";

function fixtureSession(fixture) {
  return normalizeAtlasSession(fixture);
}

test("login normalization is account-neutral and preserves the supplied password", () => {
  assert.deepEqual(
    normalizeAtlasLoginCredentials({ email: "  OWNER@EXAMPLE.COM ", password: "Exact Password 123" }),
    { email: "owner@example.com", password: "Exact Password 123" },
  );
});

test("blank login credentials are rejected before Supabase is called", () => {
  assert.equal(normalizeAtlasLoginCredentials({ email: "", password: "secret" }), null);
  assert.equal(normalizeAtlasLoginCredentials({ email: "person@example.com", password: "" }), null);
  assert.equal(normalizeAtlasLoginCredentials(null), null);
});

test("successful login always opens the shared Atlas home", () => {
  assert.equal(atlasPostLoginPath(), "/");
});

for (const [label, fixture, role] of [
  ["owner", ATLAS_IDENTITY_FIXTURES.owner, "owner"],
  ["manager", ATLAS_IDENTITY_FIXTURES.manager, "manager"],
  ["farm hand", ATLAS_IDENTITY_FIXTURES.farmHand, "farm_hand"],
]) {
  test(`${label} fixture enters the shared Atlas home`, () => {
    const session = fixtureSession(fixture);
    const state = classifyAtlasSession(session);

    assert.equal(state.status, "active");
    assert.equal(state.activeMembership.role, role);
    assert.equal(roleHomeForMembership(state.activeMembership), "/");
  });
}

test("logout and expired sessions both resolve to anonymous", () => {
  assert.deepEqual(classifyAtlasSession(null), {
    status: "anonymous",
    authenticated: false,
    activeMembership: null,
  });
  assert.equal(classifyAtlasSession(undefined).status, "anonymous");
});

test("a verified user without an active farm membership remains distinct from anonymous", () => {
  const session = fixtureSession({
    ...ATLAS_IDENTITY_FIXTURES.owner,
    memberships: [],
  });
  const state = classifyAtlasSession(session);

  assert.equal(state.status, "no_membership");
  assert.equal(state.authenticated, true);
  assert.equal(state.activeMembership, null);
});

test("unknown roles never produce a route", () => {
  assert.equal(roleHomeForMembership({ role: "unknown" }), null);
  assert.equal(roleHomeForMembership(null), null);
});
