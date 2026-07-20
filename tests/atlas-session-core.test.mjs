import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAtlasSession } from "../lib/atlas/session-core.js";

const user = {
  id: "user-1",
  email: "lex@example.com",
  user_metadata: {},
};

const ownerMembership = {
  id: "membership-owner",
  farm_id: "farm-elm",
  role: "owner",
  worker_key: "lex",
  active: true,
  permissions: { all_farm_data: true },
  farm: {
    id: "farm-elm",
    stable_key: "elm_farm",
    name: "Elm Farm",
    status: "active",
  },
};

test("normalizes one authoritative Atlas session shape", () => {
  const session = normalizeAtlasSession({
    user,
    profile: {
      display_name: "Lex",
      default_farm_id: "farm-elm",
      active: true,
    },
    memberships: [ownerMembership],
  });

  assert.deepEqual(session, {
    userId: "user-1",
    email: "lex@example.com",
    displayName: "Lex",
    activeFarmId: "farm-elm",
    memberships: [
      {
        membershipId: "membership-owner",
        farmId: "farm-elm",
        farmKey: "elm_farm",
        farmName: "Elm Farm",
        farmStatus: "active",
        role: "owner",
        workerKey: "lex",
        permissions: { all_farm_data: true },
      },
    ],
  });
});

test("accepts Supabase relation rows returned as arrays", () => {
  const session = normalizeAtlasSession({
    user,
    profile: null,
    memberships: [
      {
        ...ownerMembership,
        farm: [ownerMembership.farm],
      },
    ],
  });

  assert.equal(session.memberships[0].farmName, "Elm Farm");
  assert.equal(session.displayName, "lex@example.com");
});

test("filters inactive memberships and falls back to a valid active farm", () => {
  const session = normalizeAtlasSession({
    user,
    profile: { display_name: "Lex", default_farm_id: "inactive-farm" },
    memberships: [
      {
        ...ownerMembership,
        id: "inactive-membership",
        farm_id: "inactive-farm",
        active: false,
      },
      ownerMembership,
    ],
  });

  assert.equal(session.activeFarmId, "farm-elm");
  assert.equal(session.memberships.length, 1);
});

test("orders owner, manager, and farm-hand memberships consistently", () => {
  const session = normalizeAtlasSession({
    user,
    profile: null,
    memberships: [
      {
        ...ownerMembership,
        id: "hand",
        role: "farm_hand",
        farm_id: "farm-hand",
        farm: { ...ownerMembership.farm, id: "farm-hand", name: "Hand Farm" },
      },
      {
        ...ownerMembership,
        id: "manager",
        role: "manager",
        farm_id: "farm-manager",
        farm: { ...ownerMembership.farm, id: "farm-manager", name: "Manager Farm" },
      },
      ownerMembership,
    ],
  });

  assert.deepEqual(
    session.memberships.map((membership) => membership.role),
    ["owner", "manager", "farm_hand"],
  );
});
