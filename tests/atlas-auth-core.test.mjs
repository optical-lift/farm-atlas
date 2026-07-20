import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("owner fixture resolves to one active Owner membership", () => {
  const session = fixtureSession(ATLAS_IDENTITY_FIXTURES.owner);
  const state = classifyAtlasSession(session);

  assert.equal(state.status, "active");
  assert.equal(state.activeMembership.role, "owner");
  assert.equal(roleHomeForMembership(state.activeMembership), "/owner");
});

test("manager fixture resolves to one active Manager membership", () => {
  const session = fixtureSession(ATLAS_IDENTITY_FIXTURES.manager);
  const state = classifyAtlasSession(session);

  assert.equal(state.status, "active");
  assert.equal(state.activeMembership.role, "manager");
  assert.equal(roleHomeForMembership(state.activeMembership), "/manage");
});

test("farm-hand fixture resolves to one active Farm-Hand membership", () => {
  const session = fixtureSession(ATLAS_IDENTITY_FIXTURES.farmHand);
  const state = classifyAtlasSession(session);

  assert.equal(state.status, "active");
  assert.equal(state.activeMembership.role, "farm_hand");
  assert.equal(roleHomeForMembership(state.activeMembership), "/work/today");
});

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
