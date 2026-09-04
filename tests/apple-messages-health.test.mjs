import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(process.cwd(), "lib/atlas/integrations/providers/apple-messages-health.ts"), "utf8");

test("Apple health validates connected source identity", () => {
  assert.match(source, /row\.connectedSourceId !== source\.sourceId/);
  assert.match(source, /row\.providerKey !== source\.providerKey/);
  assert.match(source, /row\.providerAccountKey !== source\.providerAccountKey/);
});

test("Apple health never invents complete historical coverage", () => {
  assert.match(source, /complete: false/);
  assert.doesNotMatch(source, /complete: true/);
});

test("Apple provider adapter exposes source health without transport coupling", () => {
  assert.match(source, /createAppleMessagesProviderAdapter/);
  assert.match(source, /async health\(source\)/);
  assert.doesNotMatch(source, /supabase|fetch\(|@vercel|next\//i);
});
