import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const pipeline = read("lib/atlas/integrations/pipeline.ts");
const adapter = read("lib/atlas/integrations/adapter.ts");
const apple = read("lib/atlas/integrations/providers/apple-messages.ts");

test("custody precedes every domain promotion", () => {
  const custodyCall = pipeline.indexOf("await custody.admit(envelope, evidence)");
  const promotionCall = pipeline.indexOf("await domainAdapter.promote(envelope, evidence, receipt.evidenceIds)");
  assert.ok(custodyCall >= 0, "pipeline must admit evidence");
  assert.ok(promotionCall > custodyCall, "promotion must occur after evidence custody");
});

test("replay, conflict, and rejection dispositions terminate before promotion", () => {
  const shortCircuit = pipeline.indexOf('receipt.disposition !== "admitted"');
  const promotionCall = pipeline.indexOf("await domainAdapter.promote");
  assert.ok(shortCircuit >= 0 && shortCircuit < promotionCall);
  assert.match(pipeline, /domainPromotion: "not_attempted"/);
});

test("evidence-only envelopes can never invoke a domain adapter", () => {
  const authorityGate = pipeline.indexOf('envelope.authority === "evidence_only"');
  const promotionCall = pipeline.indexOf("await domainAdapter.promote");
  assert.ok(authorityGate >= 0 && authorityGate < promotionCall);
  assert.match(pipeline, /domainPromotion: "not_authorized"/);
});

test("domain adapter cannot own evidence admission", () => {
  assert.match(adapter, /interface IntegrationEvidenceAdapter/);
  assert.match(adapter, /interface IntegrationDomainAdapter/);
  assert.match(adapter, /promote\(/);
  assert.doesNotMatch(adapter, /IntegrationDomainAdapter[\s\S]*\bingest\(/);
});

test("portable custody pipeline remains hosting and UI independent", () => {
  assert.doesNotMatch(pipeline, /from\s+["']next(?:\/|["'])/i);
  assert.doesNotMatch(pipeline, /from\s+["']react(?:\/|["'])/i);
  assert.doesNotMatch(pipeline, /@vercel\//i);
  assert.doesNotMatch(pipeline, /supabase/i);
  assert.doesNotMatch(pipeline, /PrincipalClock|principal_clock|governing_state/i);
});

test("Apple Messages normalizes to evidence and stops at custody", () => {
  assert.match(apple, /appleMessagesEnvelopeToEvidence/);
  assert.match(apple, /subjectKind: "source_event"/);
  assert.match(apple, /evidenceKind: "communication_event"/);
  assert.match(apple, /learnedAt: envelope\.time\.receivedAt/);
  assert.match(apple, /observedAt: envelope\.time\.observedAt \?\? null/);
  assert.match(apple, /processIntegrationEnvelope\(\{/);
  assert.doesNotMatch(apple, /domainAdapter\s*:/);
});
