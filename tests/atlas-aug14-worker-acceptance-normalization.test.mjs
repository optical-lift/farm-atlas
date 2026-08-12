import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260812155739_aug14_worker_acceptance_normalization_v1.sql");
const contract = read("lib/atlas/worker-execution-contract.ts");

test("Aug 14 florist batch stays truthful and executable without buyer-history leakage", () => {
  assert.match(migration, /Florist calls — batch 1/);
  assert.match(migration, /Expected five open florist child calls/);
  assert.match(migration, /availability as things come into harvest/);
  assert.doesNotMatch(migration, /We have sunflowers and other seasonal stems available/);
  assert.match(migration, /Linda''s Flowers — ask for Josh/);
  assert.match(migration, /Schaffitzel''s — ask buyer schedule/);
  assert.match(migration, /Blossoms Floral — ask for Mike\/current buyer/);
  assert.match(migration, /Casa Flowers — new buyer introduction/);
  assert.match(migration, /Cassidy Station — ask buying day \+ contact method/);
  assert.doesNotMatch(migration, /highest historical florist volume/);
  assert.doesNotMatch(migration, /MFE order\/budget/);
});

test("verified call contact facts cross the worker allow-list while strategy remains excluded", () => {
  for (const key of ["business_name", "business_phone", "business_address", "checklist_label", "step_order"]) {
    assert.match(contract, new RegExp(`"${key}"`));
  }
  for (const privateKey of ["buyer_relationship_stable_key", "relationship_status", "volume_tier", "purchase_history_summary", "pursuit_recommendation"]) {
    assert.doesNotMatch(contract, new RegExp(`"${privateKey}"`));
  }
  assert.match(migration, /417-883-6861/);
  assert.match(migration, /417-866-6222/);
  assert.match(migration, /417-865-8787/);
  assert.match(migration, /417-350-5835/);
});

test("Aug 14 pot-up and relocation packets preserve exact canonical quantities", () => {
  assert.match(migration, /Echinacea — tray 1 — 130/);
  assert.match(migration, /Pot up 130 Echinacea plants into one 200-cell plug tray/);
  assert.match(migration, /batch_total_quantity'\)::integer,-1\)<>480/);
  assert.match(migration, /Tray 1 · 200/);
  assert.match(migration, /Tray 2 · 200/);
  assert.match(migration, /Tray 3 · 80/);
  assert.match(migration, /All 3 trays \/ 480 Creeping thyme plants are potted up/);
  assert.match(migration, /Pathway beside pool → MG Center Diamond/);
  assert.match(migration, /Sutton’s Apricot foxglove — tray 1 — 190/);
  assert.match(migration, /Pot up 190 Sutton’s Apricot foxglove plants into one 200-cell plug tray/);
});
