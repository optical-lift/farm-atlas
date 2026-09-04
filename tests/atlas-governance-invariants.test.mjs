import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const constitution = read("docs/governance/constitution.md");
const integrationContract = read("lib/atlas/integrations/contract.ts");
const integrationAdapter = read("lib/atlas/integrations/adapter.ts");
const integrationPipeline = read("lib/atlas/integrations/pipeline.ts");

// C-02: evidence and interpretation remain distinct.
test("constitutional evidence boundary remains represented in integration contracts", () => {
  assert.match(constitution, /C-02 — Evidence and interpretation remain distinct/);
  assert.match(integrationContract, /IntegrationEvidenceDraft/);
  assert.match(integrationAdapter, /IntegrationEvidenceAdapter/);
  assert.match(integrationAdapter, /IntegrationDomainAdapter/);
  assert.match(integrationPipeline, /evidence_only/);
  assert.match(integrationPipeline, /not_authorized/);
});

// C-09 and C-11: external providers and the current UI cannot define Atlas internals.
test("portable integration foundation remains provider-edge and interface independent", () => {
  assert.match(constitution, /C-09 — External networks are replaceable boundaries/);
  assert.match(constitution, /C-11 — The current interface is not Atlas/);

  const source = `${integrationContract}\n${integrationAdapter}\n${integrationPipeline}`;
  assert.doesNotMatch(source, /from\s+["']next(?:\/|["'])/i);
  assert.doesNotMatch(source, /from\s+["']react(?:\/|["'])/i);
  assert.doesNotMatch(source, /@vercel\//i);
  assert.doesNotMatch(source, /app\/api\//i);
});

// C-12 and C-15 are horizon-preserving rules. Portable contracts must not hard-code
// a cloud runtime as the only possible place Atlas can exist.
test("portable contracts do not hard-code a cloud hosting runtime", () => {
  assert.match(constitution, /C-12 — Cloud custody is not the only possible custody/);
  assert.match(constitution, /C-15 — Present architecture must not foreclose user-held hardware/);

  const source = `${integrationContract}\n${integrationAdapter}\n${integrationPipeline}`;
  assert.doesNotMatch(source, /supabase-js|createClient\(|process\.env\.VERCEL|EdgeRuntime/i);
});
