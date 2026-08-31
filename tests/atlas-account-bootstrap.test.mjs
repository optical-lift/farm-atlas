import assert from "node:assert/strict";
import test from "node:test";

import {
  atlasAuthConfirmationNext,
  humanSignupEnabled,
  normalizeHumanSignupInput,
} from "../lib/atlas/account-bootstrap-core.js";

test("human signup remains closed unless explicitly enabled", () => {
  assert.equal(humanSignupEnabled(undefined), false);
  assert.equal(humanSignupEnabled("false"), false);
  assert.equal(humanSignupEnabled("TRUE"), true);
});

test("human bootstrap requires identity fields but no farm or organization", () => {
  const result = normalizeHumanSignupInput({
    displayName: "New Human",
    email: "Human@Example.com ",
    password: "a-very-long-password",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    displayName: "New Human",
    email: "human@example.com",
    password: "a-very-long-password",
  });
  assert.equal("farmId" in result.value, false);
  assert.equal("organizationId" in result.value, false);
  assert.equal("source" in result.value, false);
});

test("human bootstrap refuses short passwords", () => {
  const result = normalizeHumanSignupInput({
    displayName: "New Human",
    email: "human@example.com",
    password: "short",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /12 characters/);
});

test("auth confirmation cannot be used as an open redirect", () => {
  assert.equal(atlasAuthConfirmationNext("/onboarding"), "/onboarding");
  assert.equal(atlasAuthConfirmationNext("https://evil.example"), "/onboarding");
  assert.equal(atlasAuthConfirmationNext("/owner"), "/onboarding");
});
