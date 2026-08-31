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

test("successful login passes through the human onboarding gate", () => {
  assert.equal(atlasPostLoginPath(), "/onboarding");
});

for (const [label, fixture, role] of [
  ["owner", ATLAS_IDENTITY_FIXTURES.owner, "owner"],
  ["manager", ATLAS_IDENTITY_FIXTURES.manager, "manager"],
  ["farm hand", ATLAS_IDENTITY_FIXTURES.farmHand, "farm_hand"],
]) {
  test(`${label} fixture remains an active Atlas account`, () => {
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
    activeOrganizationMembership: null,
  });
  assert.equal(classifyAtlasSession(undefined).status, "anonymous");
});

test("a verified human with no farm or organization context enters onboarding instead of failing authorization", () => {
  const session = fixtureSession({
    user: {
      id: "fixture-new-human",
      email: "new-human.fixture@atlas.invalid",
      user_metadata: { display_name: "New Human" },
    },
    profile: null,
    memberships: [],
    organizationMemberships: [],
  });
  const state = classifyAtlasSession(session);

  assert.equal(session.userId, "fixture-new-human");
  assert.equal(session.activeFarmId, null);
  assert.equal(session.activeOrganizationId, null);
  assert.equal(session.onboardingState, "new");
  assert.equal(state.status, "onboarding");
  assert.equal(state.authenticated, true);
  assert.equal(state.activeMembership, null);
  assert.equal(state.activeOrganizationMembership, null);
});

test("organization membership alone is enough to be an active Atlas human", () => {
  const session = fixtureSession({
    user: {
      id: "fixture-org-human",
      email: "org-human.fixture@atlas.invalid",
      user_metadata: { display_name: "Organization Human" },
    },
    profile: {
      user_id: "fixture-org-human",
      display_name: "Organization Human",
      default_farm_id: null,
      default_organization_id: "fixture-org-camp",
      onboarding_state: "ready",
      active: true,
    },
    memberships: [],
    organizationMemberships: [
      {
        id: "fixture-org-membership-camp",
        organization_id: "fixture-org-camp",
        role: "owner",
        active: true,
        permissions: { manage_portfolio: true },
        organization: {
          id: "fixture-org-camp",
          stable_key: "fixture_camp_duffel",
          name: "Fixture Camp Duffel",
          status: "active",
        },
      },
    ],
  });
  const state = classifyAtlasSession(session);

  assert.equal(session.activeFarmId, null);
  assert.equal(session.activeOrganizationId, "fixture-org-camp");
  assert.equal(session.onboardingState, "ready");
  assert.equal(state.status, "active");
  assert.equal(state.activeMembership, null);
  assert.equal(state.activeOrganizationMembership.role, "owner");
});

test("preferred organization is selected only when the human actually has an active membership", () => {
  const session = fixtureSession({
    user: { id: "fixture-multi-org-human", email: "multi.fixture@atlas.invalid" },
    profile: {
      user_id: "fixture-multi-org-human",
      display_name: "Multi Org Human",
      default_farm_id: null,
      default_organization_id: "fixture-org-second",
      onboarding_state: "ready",
      active: true,
    },
    memberships: [],
    organizationMemberships: [
      {
        id: "fixture-org-membership-first",
        organization_id: "fixture-org-first",
        role: "member",
        active: true,
        permissions: {},
        organization: { id: "fixture-org-first", stable_key: "first", name: "First", status: "active" },
      },
      {
        id: "fixture-org-membership-second",
        organization_id: "fixture-org-second",
        role: "member",
        active: true,
        permissions: {},
        organization: { id: "fixture-org-second", stable_key: "second", name: "Second", status: "active" },
      },
    ],
  });

  assert.equal(session.organizationMemberships.length, 2);
  assert.equal(session.activeOrganizationId, "fixture-org-second");
});

test("unknown farm roles never produce a route", () => {
  assert.equal(roleHomeForMembership({ role: "unknown" }), null);
  assert.equal(roleHomeForMembership(null), null);
});
