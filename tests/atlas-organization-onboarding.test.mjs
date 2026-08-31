import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOrganizationEstablishmentInput } from "../lib/atlas/organization-onboarding-core.js";

test("organization establishment accepts only the organization name", () => {
  const result = normalizeOrganizationEstablishmentInput({
    name: "  Optical   Lift  ",
    farmId: "must-not-travel",
    userId: "must-not-travel",
    sourceId: "must-not-travel",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: "Optical Lift" });
  assert.equal("farmId" in result.value, false);
  assert.equal("userId" in result.value, false);
  assert.equal("sourceId" in result.value, false);
});

test("organization establishment refuses empty names", () => {
  const result = normalizeOrganizationEstablishmentInput({ name: " " });
  assert.equal(result.ok, false);
});
