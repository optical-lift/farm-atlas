import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260824134617_universal_worker_day_placement_authority_v1.sql", import.meta.url), "utf8");

const resolverStart = migration.indexOf("create or replace function atlas.worker_task_effective_placement_v1");
const standingStart = migration.indexOf("create or replace function atlas.owner_set_work_definition_day_placement_api_v1");
const feedStart = migration.indexOf("create or replace function atlas.worker_day_feed_plan_live_v1");
const resolver = migration.slice(resolverStart, standingStart);
const feed = migration.slice(feedStart);

test("Worker Day resolves one-off placement before standing definition and fallback", () => {
  assert.ok(resolverStart >= 0);
  assert.ok(standingStart > resolverStart);
  assert.match(resolver, /from atlas\.worker_day_task_placements p/);
  assert.match(resolver, /'source','manual_occurrence_placement'/);
  assert.match(resolver, /metadata->'dayPlacement'/);
  assert.match(resolver, /'source','work_definition'/);
  assert.match(resolver, /atlas\.worker_task_day_window_v1\(v_task\.action_key,v_task\.task_type,v_task\.metadata\)/);
  assert.match(resolver, /'operational_fallback'/);

  const manual = resolver.indexOf("'source','manual_occurrence_placement'");
  const standing = resolver.indexOf("'source','work_definition'");
  const fallback = resolver.indexOf("v_window:=atlas.worker_task_day_window_v1");
  assert.ok(manual < standing && standing < fallback);
});

test("canonical Worker Day feed consumes the universal placement resolver", () => {
  assert.match(feed, /atlas\.worker_task_effective_placement_v1\(p_farm_id,p_membership_id,t\.id,p_day\)/);
  assert.match(feed, /'placementAuthority',resolved\.placement->>'source'/);
  assert.doesNotMatch(feed, /coalesce\(placement\.day_window,atlas\.worker_task_day_window_v1/);
});

test("universal resolver contains no Farm Round identity exception", () => {
  assert.doesNotMatch(resolver, /farm_round/i);
  assert.doesNotMatch(resolver, /stewardship_round/i);
});

test("standing placement has a generic owner authoring boundary", () => {
  assert.match(migration, /owner_set_work_definition_day_placement_api_v1/);
  assert.match(migration, /'dayPlacementAuthority','work_definition'/);
  assert.match(migration, /Active work definition was not found on this farm/);
});
