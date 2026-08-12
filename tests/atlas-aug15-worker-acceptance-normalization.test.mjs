import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260812160432_aug15_worker_acceptance_normalization_v1.sql");
const contract = read("lib/atlas/worker-execution-contract.ts");
const selector = read("components/atlas/decision-selector-task-detail.tsx");
const dispatcher = read("components/atlas/canonical-assigned-task-detail-client.tsx");

test("Aug 15 single-tray pot-up work is literal", () => {
  assert.match(migration, /Golden yarrow — tray 1 — 130/);
  assert.match(migration, /Pot up 130 Golden yarrow plants into one 200-cell plug tray/);
  assert.match(migration, /Violet salvia — tray 1 — 130/);
  assert.match(migration, /Pot up 130 Violet salvia plants into one 200-cell plug tray/);
});

test("Grey Couch remains a specialty decision selector inside the common execution shell", () => {
  assert.match(migration, /Grey Couch in Garage/);
  assert.match(migration, /grey_couch_decision_v1/);
  assert.match(migration, /Choose the option below that matches your decision/);
  assert.match(migration, /One couch decision is saved/);

  assert.match(dispatcher, /if \(isDecisionSelectorTask\(props\.task\)\) return <DecisionSelectorTaskDetail/);
  assert.match(selector, /<AssignedTaskExecutionShell/);
  assert.match(selector, /resultInstrument=\{resultInstrument\}/);
  assert.match(selector, /task\.metadata\?\.decision_question/);
  assert.match(selector, /task\.metadata\?\.decision_options/);
});

test("decision choices cross the Farm Hand boundary but Owner reasoning does not", () => {
  for (const key of [
    "decision_selector_key",
    "decision_question",
    "decision_options",
    "display_instruction",
    "personal_display_label",
  ]) {
    assert.match(contract, new RegExp(`"${key}"`));
  }

  assert.doesNotMatch(contract, /"why_now"/);
  assert.doesNotMatch(contract, /"state_effect"/);
  assert.match(migration, /Personal · not paid Elm work/);
  assert.match(migration, /List on FB Marketplace with the kitty litter box/);
  assert.match(migration, /Move to detached garage after creating a space along one wall in the back/);
  assert.match(migration, /I’ve made a decision that doesn’t require an Atlas task/);
});
