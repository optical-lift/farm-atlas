import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationsEnabled,
  isValidInviteId,
  membershipHomeForRole,
  safeInviteRedirect,
  validateInvitePassword,
} from "../lib/atlas/invite-flow-core.js";

const INVITE_ID = "8b6ddf06-a780-4e97-9d10-443e32794824";

test("accepts only valid invitation UUIDs", () => {
  assert.equal(isValidInviteId(INVITE_ID), true);
  assert.equal(isValidInviteId("not-a-uuid"), false);
  assert.equal(isValidInviteId(null), false);
});

test("allows only same-origin onboarding invitation redirects", () => {
  const origin = "https://atlas.elmfarm.co";
  assert.equal(
    safeInviteRedirect(
      origin,
      `${origin}/onboarding/invite?invite=${INVITE_ID}`,
    ).toString(),
    `${origin}/onboarding/invite?invite=${INVITE_ID}`,
  );

  assert.equal(
    safeInviteRedirect(origin, "https://example.com/onboarding/invite").toString(),
    `${origin}/onboarding/invite`,
  );
  assert.equal(
    safeInviteRedirect(origin, `${origin}/owner`).toString(),
    `${origin}/onboarding/invite`,
  );
});

test("maps accepted memberships to their protected perspective", () => {
  assert.equal(membershipHomeForRole("owner"), "/owner");
  assert.equal(membershipHomeForRole("manager"), "/manage");
  assert.equal(membershipHomeForRole("farm_hand"), "/work/today");
  assert.equal(membershipHomeForRole("unknown"), "/");
});

test("invitation sending remains disabled unless explicitly enabled", () => {
  assert.equal(invitationsEnabled(undefined), false);
  assert.equal(invitationsEnabled("false"), false);
  assert.equal(invitationsEnabled("TRUE"), false);
  assert.equal(invitationsEnabled("true"), true);
});

test("requires a matching twelve-character password during acceptance", () => {
  assert.deepEqual(validateInvitePassword("too-short", "too-short"), {
    ok: false,
    error: "Use at least 12 characters for the Atlas password.",
  });
  assert.deepEqual(validateInvitePassword("long-enough-password", "different-password"), {
    ok: false,
    error: "The passwords do not match.",
  });
  assert.deepEqual(
    validateInvitePassword("long-enough-password", "long-enough-password"),
    { ok: true, password: "long-enough-password" },
  );
});
