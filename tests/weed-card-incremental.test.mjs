import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("beds own persistent Weed Cards with passes and append-only sessions", () => {
  const migration = read("supabase/migrations/20260729005856_weed_cards_incremental_sessions_v1.sql");

  assert.match(migration, /create table if not exists atlas\.weed_cards/);
  assert.match(migration, /create table if not exists atlas\.weed_passes/);
  assert.match(migration, /create table if not exists atlas\.weed_sessions/);
  assert.match(migration, /weed_passes_one_active_per_card_uidx/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /where go\.stable_key in \('fr_4','fr_5','fr_6'\)/);
  assert.match(migration, /documented_maintenance_partial_backfill/);
});

test("a Weed Card session closes today's task without declaring the bed clear", () => {
  const migration = read("supabase/migrations/20260729005856_weed_cards_incremental_sessions_v1.sql");

  assert.match(migration, /'done'.*'Weed Card session logged'/s);
  assert.match(migration, /'weed', 'weed_session'/);
  assert.match(migration, /if p_condition_after <> 'clear' then/);
  assert.match(migration, /v_next_date := p_work_date \+ 1/);
  assert.match(migration, /last_weeded_at = case when p_condition_after = 'clear'/);
  assert.doesNotMatch(migration, /total_minutes\s*\/\s*remaining_effort_minutes/);
});

test("the linked task serves the card instead of the generic binary footer", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const api = read("app/api/atlas/weed-card-session/route.ts");

  assert.match(canonical, /weed_card_session_task/);
  assert.match(canonical, /WeedCardTaskLoader/);
  assert.match(loader, /\/api\/atlas\/weed-card\?taskId=/);
  assert.match(focus, /QUICK_MINUTES = \[10, 20, 30, 45\]/);
  assert.match(focus, /ATLAS_WEED_CONDITIONS/);
  assert.match(focus, /Log session/);
  assert.match(focus, /Finish pass/);
  assert.match(api, /record_weed_card_session_v1/);
});

test("time invested and physical condition remain separate signals", () => {
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const contract = read("lib/atlas/weed-card-contract.ts");

  assert.match(focus, /card\.totalMinutes/);
  assert.match(focus, /card\.condition/);
  assert.match(focus, /atlas-weed-invested-rail/);
  assert.match(focus, /atlas-weed-condition-scale/);
  assert.match(contract, /medium_pressure/);
  assert.match(contract, /row_readable/);
  assert.match(contract, /mostly_clear/);
});
