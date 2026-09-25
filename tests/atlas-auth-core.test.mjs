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

test("successful login passes through the human onboarding gate", () => {
  assert.equal(atlasPostLoginPath(), "/onboarding");
});

for (const [label, fixture, role] of [
  ["owner", ATLAS_IDENTITY_FIXTURES.owner, "owner"],
  ["manager", ATLAS_IDENTITY_FIXTURES.manager, "manager"],
  ["farm hand", ATLAS_IDENTITY_FIXTURES.farmHand, "farm_hand"],
]) {
  test(`${label} fixture is active because Reality identity and Personal Atlas are ready`, () => {
    const session = fixtureSession(fixture);
    const state = classifyAtlasSession(session);
    assert.equal(state.status, "active");
    assert.equal(state.activeMembership.role, role);
    assert.equal(roleHomeForMembership(state.activeMembership), "/");
  });
}

test("logout and expired sessions resolve to anonymous", () => {
  assert.equal(classifyAtlasSession(null).status, "anonymous");
  assert.equal(classifyAtlasSession(undefined).status, "anonymous");
});

test("legacy organization membership alone cannot activate an Atlas account", () => {
  const session = fixtureSession({
    user: { id: "fixture-org-human", email: "org-human.fixture@atlas.invalid" },
    state: "person_binding_required",
    profile: null,
    memberships: [],
    organizationMemberships: [{
      id: "fixture-org-membership",
      organization_id: "fixture-org",
      role: "owner",
      active: true,
      permissions: {},
      organization: { id: "fixture-org", stable_key: "fixture", name: "Fixture", status: "active" },
    }],
    person: null,
    personalAtlas: null,
    ledgerSeats: [],
    compatibilityOrganizationIds: [],
  });

  const state = classifyAtlasSession(session);
  assert.equal(state.status, "onboarding");
  assert.equal(state.authenticated, true);
  assert.equal(state.activeOrganizationMembership.role, "owner");
});

test("Reality Person plus native Personal Atlas activates without organization membership", () => {
  const session = fixtureSession({
    user: { id: "reality-human", email: "reality@atlas.invalid" },
    state: "ready",
    person: { id: "person-reality", displayName: "Reality Human", kind: "person", identityState: "canonical" },
    personalAtlas: { id: "personal-reality", personEntityId: "person-reality", state: "active", native: true },
    ledgerSeats: [],
    compatibilityOrganizationIds: [],
    profile: null,
    memberships: [],
    organizationMemberships: [],
  });

  assert.equal(classifyAtlasSession(session).status, "active");
});

test("unknown farm roles never produce a route", () => {
  assert.equal(roleHomeForMembership({ role: "unknown" }), null);
  assert.equal(roleHomeForMembership(null), null);
});
