import assert from "node:assert/strict";
import test from "node:test";

import { ATLAS_IDENTITY_FIXTURES } from "../lib/atlas/identity-fixtures.js";
import { resolveRoleAccess } from "../lib/atlas/role-access-core.js";
import { normalizeAtlasSession } from "../lib/atlas/session-core.js";

function sessionFor(name) {
  return normalizeAtlasSession(ATLAS_IDENTITY_FIXTURES[name]);
}

test("Owner membership opens the Owner route group", () => {
  const access = resolveRoleAccess(sessionFor("owner"), ["owner"]);
  assert.equal(access.status, "authorized");
  assert.equal(access.membership.role, "owner");
  assert.equal(access.redirectTo, null);
});

test("Manager membership opens management but not Owner routes", () => {
  const session = sessionFor("manager");
  assert.equal(resolveRoleAccess(session, ["owner", "manager"]).status, "authorized");
  assert.deepEqual(resolveRoleAccess(session, ["owner"]), {
    status: "wrong_role",
    membership: null,
    redirectTo: "/manage",
  });
});

test("Farm-Hand membership opens worker routes only", () => {
  const session = sessionFor("farmHand");
  assert.equal(resolveRoleAccess(session, ["owner", "manager", "farm_hand"]).status, "authorized");
  assert.deepEqual(resolveRoleAccess(session, ["owner", "manager"]), {
    status: "wrong_role",
    membership: null,
    redirectTo: "/work/today",
  });
});

test("anonymous and membership-less sessions receive neutral redirects", () => {
  assert.deepEqual(resolveRoleAccess(null, ["owner"]), {
    status: "anonymous",
    membership: null,
    redirectTo: "/login",
  });

  assert.deepEqual(
    resolveRoleAccess(
      {
        userId: "verified-user",
        email: "verified@example.invalid",
        displayName: "Verified User",
        activeFarmId: null,
        memberships: [],
      },
      ["owner"],
    ),
    {
      status: "no_membership",
      membership: null,
      redirectTo: "/",
    },
  );
});
