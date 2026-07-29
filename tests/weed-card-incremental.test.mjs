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
  const finalMigration = read("supabase/migrations/20260729014000_weed_card_final_contract_v1.sql");

  assert.match(finalMigration, /'done',p_idempotency_key\|\|':task'/);
  assert.match(finalMigration, /'weed_session','weed_session'/);
  assert.match(finalMigration, /if p_condition_after<>'clear' then/);
  assert.match(finalMigration, /greatest\(p_work_date,coalesce\(v_task\.due_date,p_work_date\)\)\+1/);
  assert.match(finalMigration, /t\.id<>v_task\.id/);
  assert.match(finalMigration, /last_weeded_at=case when p_condition_after='clear'/);
  assert.doesNotMatch(finalMigration, /total_minutes\s*\/\s*remaining_effort_minutes/);
});

test("unfinished work gets one same-card replacement without increasing the farm workload", () => {
  const finalMigration = read("supabase/migrations/20260729014000_weed_card_final_contract_v1.sql");

  assert.match(finalMigration, /plan_work_occurrence_v1/);
  assert.match(finalMigration, /release_weed_card_continuation_v1/);
  assert.match(finalMigration, /The prior Weed Card session must be done/);
  assert.match(finalMigration, /same_card_daily_session/);
  assert.match(finalMigration, /replacement_source_task_id/);
  assert.match(finalMigration, /restore_task_relation_payload_v1/);
});

test("clear closes the pass and returns the permanent card to its maintenance rhythm", () => {
  const finalMigration = read("supabase/migrations/20260729014000_weed_card_final_contract_v1.sql");

  assert.match(finalMigration, /status=case when p_condition_after='clear' then 'closed'/);
  assert.match(finalMigration, /next_review_on=case when p_condition_after='clear'/);
  assert.match(finalMigration, /active=p_condition_after='clear'/);
  assert.match(finalMigration, /when 'clear' then 'maintained'/);
  assert.match(finalMigration, /enrich_weed_card_occurrence_v1/);
  assert.match(finalMigration, /weed_card_session_task',true/);
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
