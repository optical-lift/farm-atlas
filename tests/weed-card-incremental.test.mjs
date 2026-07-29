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

test("pass logging and day completion are separate Weed Card mutations", () => {
  const migration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");

  assert.match(migration, /record_weed_card_pass_v1/);
  assert.match(migration, /finish_weed_card_day_v1/);
  assert.match(migration, /'taskClosed',p_condition_after='clear'/);
  assert.match(migration, /'task_kept_open',p_condition_after<>'clear'/);
  assert.match(migration, /weed_card_day_close_key/);
  assert.match(migration, /release_weed_card_continuation_v1/);
  assert.doesNotMatch(migration, /display_detail.*Continue clearing/);
});

test("time is optional evidence while physical condition remains required", () => {
  const migration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");
  const contract = read("lib/atlas/weed-card-contract.ts");

  assert.match(migration, /v_minutes integer := coalesce\(p_minutes,0\)/);
  assert.match(migration, /minutes_known/);
  assert.match(migration, /Add time, change the condition, or add a note/);
  assert.match(contract, /minutes\?: number \| null/);
  assert.match(contract, /taskClosed: boolean/);
});

test("the Weed Card uses the known task footer and identifies the place once", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");
  const client = read("lib/atlas/weed-card-client.ts");
  const passApi = read("app/api/atlas/weed-card-session/route.ts");
  const dayApi = read("app/api/atlas/weed-card-day/route.ts");

  assert.match(canonical, /isWeedTask/);
  assert.match(canonical, /WeedCardTaskLoader/);
  assert.match(loader, /\/api\/atlas\/weed-card\?taskId=/);
  assert.match(focus, /const actionTitle = `Weed \$\{shortObjectLabel\(card\.objectKey, card\.objectLabel\)\}`/);
  assert.match(focus, /showZoneLabel=\{false\}/);
  assert.match(focus, /showSubjectLabel=\{false\}/);
  assert.match(focus, /<CropOccupancyList groups=\{card\.occupancyGroups\} \/>/);
  assert.match(focus, /atlas-task-result-actions atlas-task-result-actions-simple atlas-weed-day-actions/);
  assert.match(focus, /className="done"/);
  assert.match(focus, />\s*Unfinished\s*</);
  assert.match(focus, />Log a pass</);
  assert.match(focus, /That’s all for today/);
  assert.ok(focus.indexOf("<span>Condition</span>") < focus.indexOf("<span>Time</span>"));
  assert.match(focus, /postAtlasFinishWeedCardDay/);
  assert.match(focus, /conditionAfter === "clear" \? "Finish pass" : "Save pass"/);
  assert.doesNotMatch(focus, /Continue the recovery|Return the row to production|<small>Weed Card<\/small>/);
  assert.match(trail, /showZoneLabel\?: boolean/);
  assert.match(trail, /moveDetails\?: ReactNode/);
  assert.match(client, /weed-card-pass-v1/);
  assert.match(client, /weed-card-day-v1/);
  assert.match(passApi, /record_weed_card_pass_v1/);
  assert.match(dayApi, /finish_weed_card_day_v1/);
});

test("unfinished day close gets one same-card replacement without increasing farm workload", () => {
  const finalMigration = read("supabase/migrations/20260729014000_weed_card_final_contract_v1.sql");
  const grazerMigration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");

  assert.match(finalMigration, /release_weed_card_continuation_v1/);
  assert.match(finalMigration, /The prior Weed Card session must be done/);
  assert.match(finalMigration, /replacement_source_task_id/);
  assert.match(grazerMigration, /planned_by','finish_weed_card_day_v1/);
  assert.match(grazerMigration, /v_next_task_id := atlas\.release_weed_card_continuation_v1/);
});

test("clear closes the pass and returns the permanent card to its maintenance rhythm", () => {
  const migration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");

  assert.match(migration, /status=case when p_condition_after='clear' then 'closed'/);
  assert.match(migration, /next_review_on=case when p_condition_after='clear'/);
  assert.match(migration, /active=p_condition_after='clear'/);
  assert.match(migration, /when 'clear' then 'maintained'/);
});