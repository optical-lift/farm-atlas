import assert from "node:assert/strict";
import test from "node:test";

import { ATLAS_IDENTITY_FIXTURES } from "../lib/atlas/identity-fixtures.js";
import { ownerMembershipForTask } from "../lib/atlas/owner-task-access-core.js";
import { normalizeAtlasSession } from "../lib/atlas/session-core.js";

const FIXTURE_FARM_ID = "fixture-farm-elm";

function sessionFor(name) {
  return normalizeAtlasSession(ATLAS_IDENTITY_FIXTURES[name]);
}

test("Owner may act on a task in the owned farm", () => {
  const membership = ownerMembershipForTask(sessionFor("owner"), {
    farm_id: FIXTURE_FARM_ID,
  });
  assert.equal(membership?.role, "owner");
  assert.equal(membership?.farmId, FIXTURE_FARM_ID);
});

test("Manager and Farm Hand memberships cannot use the Owner mutation path", () => {
  assert.equal(
    ownerMembershipForTask(sessionFor("manager"), { farm_id: FIXTURE_FARM_ID }),
    null,
  );
  assert.equal(
    ownerMembershipForTask(sessionFor("farmHand"), { farm_id: FIXTURE_FARM_ID }),
    null,
  );
});

test("Owner membership does not cross farm boundaries", () => {
  assert.equal(
    ownerMembershipForTask(sessionFor("owner"), { farm_id: "fixture-farm-other" }),
    null,
  );
  assert.equal(ownerMembershipForTask(null, { farm_id: FIXTURE_FARM_ID }), null);
  assert.equal(ownerMembershipForTask(sessionFor("owner"), null), null);
});
