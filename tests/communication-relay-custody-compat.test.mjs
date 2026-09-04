import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(process.cwd(), "lib/atlas/integrations/runtime/communication-relay.ts"), "utf8");

test("legacy relay compatibility is limited to one-event custody mapping", () => {
  assert.match(source, /receipt\.supplied !== 1/);
  assert.match(source, /exactly one custody outcome/);
  assert.match(source, /"admitted"/);
  assert.match(source, /"already_in_custody"/);
  assert.match(source, /"conflict"/);
});

test("receipt source identity must agree with the portable envelope", () => {
  assert.match(source, /receipt\.connectedSourceId !== envelope\.connectedSourceId/);
  assert.match(source, /receipt\.sourceKind !== envelope\.providerKey/);
  assert.match(source, /receipt\.sourceAccountRef !== envelope\.providerAccountKey/);
});

test("admitted or replayed events require a resolved evidence id", () => {
  assert.match(source, /disposition === "admitted" \|\| disposition === "already_in_custody"/);
  assert.match(source, /!identity\.eventId/);
  assert.match(source, /evidenceIds: identity\.eventId \? \[identity\.eventId\] : \[\]/);
});

test("compatibility mapper cannot import a database or hosting runtime", () => {
  assert.doesNotMatch(source, /supabase/i);
  assert.doesNotMatch(source, /@vercel|next\//i);
  assert.doesNotMatch(source, /postgres|fetch\(/i);
});
