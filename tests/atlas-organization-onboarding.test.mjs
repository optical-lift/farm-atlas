import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOrganizationOnboardingInput } from "../lib/atlas/organization-onboarding-core.js";

test("organization onboarding accepts only the organization name", () => {
  const result = normalizeOrganizationOnboardingInput({
    name: "  Optical   Lift  ",
    farmId: "must-not-travel",
    userId: "must-not-travel",
    membershipRole: "must-not-travel",
    sourceId: "must-not-travel",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: "Optical Lift" });
  assert.equal("farmId" in result.value, false);
  assert.equal("userId" in result.value, false);
  assert.equal("membershipRole" in result.value, false);
  assert.equal("sourceId" in result.value, false);
});

test("organization onboarding refuses empty names", () => {
  const result = normalizeOrganizationOnboardingInput({ name: " " });
  assert.equal(result.ok, false);
});
