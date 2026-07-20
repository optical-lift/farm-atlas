import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMembershipInviteInput } from "../lib/atlas/member-invite-core.js";

test("normalizes a Farm Hand invitation draft", () => {
  assert.deepEqual(
    normalizeMembershipInviteInput({
      farmId: "farm-elm",
      email: "  ANNA@example.com ",
      displayName: " Anna ",
      role: "farm_hand",
      workerKey: " Anna Farm Hand ",
    }),
    {
      ok: true,
      value: {
        farmId: "farm-elm",
        email: "anna@example.com",
        displayName: "Anna",
        role: "farm_hand",
        workerKey: "anna_farm_hand",
      },
    },
  );
});

test("allows a Manager invitation without a worker key", () => {
  const result = normalizeMembershipInviteInput({
    farmId: "farm-elm",
    email: "marshall@example.com",
    displayName: "Marshall",
    role: "manager",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.workerKey, null);
});

test("rejects missing Farm Hand worker keys and invalid roles", () => {
  assert.deepEqual(
    normalizeMembershipInviteInput({
      farmId: "farm-elm",
      email: "anna@example.com",
      displayName: "Anna",
      role: "farm_hand",
    }),
    { ok: false, error: "A Farm Hand worker key is required." },
  );

  assert.deepEqual(
    normalizeMembershipInviteInput({
      farmId: "farm-elm",
      email: "person@example.com",
      displayName: "Person",
      role: "owner",
    }),
    { ok: false, error: "Choose Manager or Farm Hand." },
  );
});

test("rejects malformed invitation drafts before the RPC is called", () => {
  assert.deepEqual(normalizeMembershipInviteInput(null), {
    ok: false,
    error: "Farm membership is required.",
  });

  assert.deepEqual(
    normalizeMembershipInviteInput({
      farmId: "farm-elm",
      email: "not-an-email",
      displayName: "Anna",
      role: "manager",
    }),
    { ok: false, error: "Enter a valid email address." },
  );
});
