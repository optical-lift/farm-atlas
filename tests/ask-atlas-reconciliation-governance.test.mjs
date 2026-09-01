import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("worker reports are evidence-only and cannot mutate governing state", () => {
  const runtime = read("lib/noel-runtime/reconciliation.ts");

  assert.match(runtime, /sourceAuthority: "reporting_only"/);
  assert.match(runtime, /permittedStateEffect: "append_source_attributed_evidence_only"/);
  assert.match(runtime, /governingStateChanged: false/);
  assert.match(runtime, /claim\.statementType === "recommendation" \|\| claim\.statementType === "intention"/);
  assert.match(runtime, /\? "none"/);
  assert.doesNotMatch(runtime, /sourceAuthority: "directive"/);
});

test("Ask Atlas reconciliation does not offer directive as a worker statement type", () => {
  const runtime = read("lib/noel-runtime/reconciliation.ts");
  const route = read("app/api/owner/ask-atlas/reconcile/route.ts");

  assert.match(runtime, /"completed_action"/);
  assert.match(runtime, /"in_progress_action"/);
  assert.match(runtime, /"intention"/);
  assert.match(runtime, /"observation"/);
  assert.match(runtime, /"recommendation"/);
  assert.doesNotMatch(runtime, /"directive",/);

  assert.match(route, /Directive is intentionally unavailable/);
  assert.match(route, /“I wouldn’t rush to fix it” is recommendation/);
  assert.match(route, /recommendation MUST NOT be treated as a priority change or directive/);
});

test("Ask Atlas reconciliation is read-only even when it detects stale or missing work", () => {
  const route = read("app/api/owner/ask-atlas/reconcile/route.ts");

  assert.match(route, /possible_stale_record/);
  assert.match(route, /possible_unrepresented_work/);
  assert.match(route, /No Atlas record, priority, directive, or resource state changed/);
  assert.match(route, /noRecordsChanged: true/);
  assert.match(route, /proposalFirewall: "blocked"/);
  assert.doesNotMatch(route, /\.rpc\(/);
  assert.doesNotMatch(route, /createServerSupabaseClient|SUPABASE_SERVICE_ROLE_KEY/);
});

test("the Owner notebook exposes reconciliation without giving Ask Atlas authority over live Today", () => {
  const fixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
  const page = read("app/owner/ask-atlas/page.tsx");
  const client = read("app/owner/AskAtlasOwner.tsx");

  assert.match(fixture, /label: "Ask Atlas"/);
  assert.match(fixture, /href: "\/owner\/ask-atlas"/);
  assert.match(fixture, /Today is hybrid: fixture planning \+ live Principal decisions/);
  assert.match(fixture, /partial coverage only · no Clock arbitration/);
  assert.match(page, /<AskAtlasOwner/);
  assert.match(client, /\/api\/owner\/ask-atlas\/reconcile/);
  assert.match(client, /No records changed\./);
  assert.match(client, /Recommendations cannot become priority changes or managing directives/);
});
