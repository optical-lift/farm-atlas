import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("5K notebook keeps measurement, rhythm, and response policy as separate governed acceptances", async () => {
  const [core, catalog, client] = await Promise.all([
    read("lib/atlas/person-life-training-core.js"),
    read("lib/atlas/person-life-notebook-catalog.js"),
    read("app/owner/life/PersonLifeCaptureClient.tsx"),
  ]);

  assert.match(core, /claimType: "goal_requirement"/);
  assert.match(core, /claimType: "goal_rhythm_plan"/);
  assert.match(core, /claimType: "consequence_policy"/);
  assert.match(core, /effectKind: "rhythm_opportunity_presentation_overlay"/);
  assert.match(core, /kind: "goal_requirement_next_opportunity"/);
  assert.match(catalog, /01 · measurement/);
  assert.match(catalog, /02 · rhythm/);
  assert.match(catalog, /03 · response policy/);
  assert.match(catalog, /The observation never invents this rule/);
  assert.match(client, /selectCatalogPersonLifeNotebook/);
  assert.doesNotMatch(client, /const FIVE_K_REQUIREMENT_KEY/);
  assert.doesNotMatch(client, /function isFiveKGoal/);
});

test("run occurrence uses the accepted Rhythm opportunity and canonical Evidence feedback loop", async () => {
  const route = await read("app/api/atlas/person-life/route.ts");

  assert.match(route, /person_rhythm_opportunities_self_api_v1/);
  assert.match(route, /person_claim_evidence_state_api_v1/);
  assert.match(route, /claimType !== "goal_rhythm_plan"/);
  assert.match(route, /record_person_rhythm_occurrence_api_v1/);
  assert.match(route, /evidenceKind: "run_distance"/);
  assert.doesNotMatch(route, /create_person_task/i);
  assert.doesNotMatch(route, /create.*clock.*placement/i);
});

test("knee observation can only alter presentation through an already-authorized consequence", async () => {
  const [route, core] = await Promise.all([
    read("app/api/atlas/person-life/route.ts"),
    read("lib/atlas/person-life-training-core.js"),
  ]);

  assert.match(route, /record_person_condition_observation_api_v1/);
  assert.match(route, /fiveKGuardrailDefinitionForGoal/);
  assert.match(route, /evaluate_person_consequence_from_evidence_api_v1/);
  assert.match(route, /apply_person_consequence_to_next_rhythm_opportunity_api_v1/);
  assert.match(core, /presentationOverlay/);
  assert.match(core, /Recovery-paced 5K run/);
  assert.doesNotMatch(core, /taskGenerationAuthority:\s*true/);
  assert.doesNotMatch(core, /clockPlacementAuthority:\s*true/);
});

test("catalog-driven notebook exposes provenance while retaining generic governed capture instruments", async () => {
  const [client, catalog] = await Promise.all([
    read("app/owner/life/PersonLifeCaptureClient.tsx"),
    read("lib/atlas/person-life-notebook-catalog.js"),
  ]);

  assert.match(client, /href="\/owner\/input\/person-goal"/);
  assert.match(client, /href="\/owner\/input\/body-observation"/);
  assert.match(client, /Why is this here/);
  assert.match(client, /accepted plan Claim/);
  assert.match(client, /spec\.evidence\.provenanceLabel/);
  assert.match(client, /Consequence/);
  assert.match(client, /Rhythm opportunities are not Tasks/);
  assert.match(catalog, /PERSON_LIFE_NOTEBOOK_CATALOG/);
});
