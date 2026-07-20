import assert from "node:assert/strict";
import test from "node:test";

import { ATLAS_IDENTITY_FIXTURES } from "../lib/atlas/identity-fixtures.js";
import { ownerMembershipForTask } from "../lib/atlas/owner-task-access-core.js";
import { normalizeAtlasSession } from "../lib/atlas/session-core.js";

function sessionFor(name) {
  return normalizeAtlasSession(ATLAS_IDENTITY_FIXTURES[name]);
}

test("Owner may act on a task in the owned farm", () => {
  const membership = ownerMembershipForTask(sessionFor("owner"), { farm_id: "farm-elm" });
  assert.equal(membership?.role, "owner");
  assert.equal(membership?.farmId, "farm-elm");
});

test("Manager and Farm Hand memberships cannot use the Owner mutation path", () => {
  assert.equal(
    ownerMembershipForTask(sessionFor("manager"), { farm_id: "farm-elm" }),
    null,
  );
  assert.equal(
    ownerMembershipForTask(sessionFor("farmHand"), { farm_id: "farm-elm" }),
    null,
  );
});

test("Owner membership does not cross farm boundaries", () => {
  assert.equal(
    ownerMembershipForTask(sessionFor("owner"), { farm_id: "farm-other" }),
    null,
  );
  assert.equal(ownerMembershipForTask(null, { farm_id: "farm-elm" }), null);
  assert.equal(ownerMembershipForTask(sessionFor("owner"), null), null);
});
