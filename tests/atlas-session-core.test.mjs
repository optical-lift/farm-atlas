import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAtlasSession } from "../lib/atlas/session-core.js";

const user = { id: "user-1", email: "lex@example.com", user_metadata: {} };
const reality = {
  state: "ready",
  person: { id: "person-lex", stableKey: "lex", kind: "person", displayName: "Lex", identityState: "canonical" },
  personalAtlas: { id: "atlas-lex", personEntityId: "person-lex", state: "active", native: true },
  ledgerSeats: [
    {
      seatId: "seat-flower",
      seatState: "active",
      beganAt: "2026-09-25T00:00:00Z",
      ledgerId: "ledger-flower",
      ledgerStableKey: "elm-farm:flower",
      ledgerName: "Elm Farm Flower Ledger",
      ledgerState: "active",
      subjectEntity: { id: "entity-elm", stableKey: "elm-farm", kind: "business", displayName: "Elm Farm", identityState: "canonical" },
      legacyOperationalCompatibility: { organizationId: "legacy-elm-org" },
    },
  ],
  responsibilities: [
    {
      relationId: "responsibility-capacity",
      responsibilityKey: "institutional_worker_capacity_truth",
      title: "Establish worker capacity truth",
      jurisdiction: {
        kind: "entity",
        entityId: "entity-elm",
        entityStableKey: "elm-farm",
        entityKind: "business",
        entityDisplayName: "Elm Farm",
      },
      permittedOperations: ["worker_day_shape.author", "worker_day_shape.read_exception"],
      scope: { farmIds: ["farm-elm"] },
      beganAt: "2026-09-25T00:00:00Z",
    },
  ],
  compatibilityOrganizationIds: ["legacy-elm-org"],
};
const ownerMembership = {
  id: "membership-owner",
  farm_id: "farm-elm",
  role: "owner",
  worker_key: "lex",
  active: true,
  permissions: { all_farm_data: true },
  farm: { id: "farm-elm", stable_key: "elm_farm", name: "Elm Farm", status: "active" },
};

test("normalizes Reality identity, Personal Atlas, Ledger seats, and farm execution separately", () => {
  const session = normalizeAtlasSession({
    user,
    ...reality,
    profile: { display_name: "Legacy display", default_farm_id: "farm-elm", active: true },
    memberships: [ownerMembership],
    organizationMemberships: [],
  });

  assert.equal(session.personEntityId, "person-lex");
  assert.equal(session.personalAtlasId, "atlas-lex");
  assert.equal(session.displayName, "Lex");
  assert.equal(session.activeLedgerId, "ledger-flower");
  assert.equal(session.ledgerSeats[0].subjectEntity.id, "entity-elm");
  assert.equal(session.activeFarmId, "farm-elm");
  assert.equal(session.responsibilities[0].responsibilityKey, "institutional_worker_capacity_truth");
  assert.deepEqual(session.responsibilities[0].permittedOperations, [
    "worker_day_shape.author",
    "worker_day_shape.read_exception",
  ]);
  assert.equal(session.activeOrganizationId, "legacy-elm-org");
  assert.deepEqual(session.organizationMemberships, []);
});

test("an authenticated user without a Reality Person remains an onboarding session", () => {
  const session = normalizeAtlasSession({
    user,
    state: "person_binding_required",
    profile: null,
    memberships: [],
    organizationMemberships: [],
    person: null,
    personalAtlas: null,
    ledgerSeats: [],
    compatibilityOrganizationIds: [],
  });

  assert.equal(session.realityState, "person_binding_required");
  assert.equal(session.personEntityId, null);
  assert.equal(session.personalAtlasId, null);
});

test("legacy organization membership cannot manufacture canonical Reality identity", () => {
  const session = normalizeAtlasSession({
    user,
    state: "person_binding_required",
    profile: null,
    memberships: [],
    organizationMemberships: [{
      id: "legacy-membership",
      organization_id: "legacy-org",
      role: "owner",
      active: true,
      permissions: {},
      organization: { id: "legacy-org", stable_key: "legacy", name: "Legacy", status: "active" },
    }],
    person: null,
    personalAtlas: null,
    ledgerSeats: [],
    compatibilityOrganizationIds: [],
  });

  assert.equal(session.realityState, "person_binding_required");
  assert.equal(session.organizationMemberships.length, 1);
  assert.equal(session.personEntityId, null);
});
