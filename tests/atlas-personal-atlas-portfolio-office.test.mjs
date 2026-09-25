import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const route = read("app/api/atlas/principal/authoring/route.ts");
const authorPage = read("app/principal/author/page.tsx");
const officePage = read("app/principal/author/office/page.tsx");

test("Portfolio Office authoring is rooted in Reality Person plus Personal Atlas", () => {
  assert.match(route, /requirePersonalAtlas/);
  assert.match(route, /session\.personEntityId/);
  assert.match(route, /session\.personalAtlasId/);
  assert.match(route, /session\.realityState !== "ready"/);
  assert.doesNotMatch(route, /organizationMemberships\.find/);
  assert.doesNotMatch(route, /principal_owner_required/);
});

test("all seven authoring kinds use one Personal Atlas projection membrane", () => {
  assert.match(route, /personal_portfolio_office_author_self_api_v1/);
  assert.match(route, /p_kind: kind/);
  assert.match(route, /owner_obligation/);
  assert.match(route, /portfolio_thesis/);
  assert.match(route, /attention_policy/);
  assert.match(route, /operating_function/);
  assert.match(route, /great_game_scorecard/);
  assert.match(route, /capital_request/);
  assert.match(route, /investment_opportunity/);
  assert.doesNotMatch(route, /principal_upsert_owner_obligation_api_v1/);
  assert.doesNotMatch(route, /principal_upsert_operating_function_api_v1/);
  assert.doesNotMatch(route, /principal_upsert_capital_request_api_v1/);
});

test("Portfolio Office UI states the projection boundary", () => {
  assert.match(authorPage, /Personal Atlas projection/);
  assert.match(authorPage, /does not create institutional authority/i);
  assert.match(officePage, /canonical institutional Reality/);
  assert.match(officePage, /capital request is not an approval or spend/i);
});
