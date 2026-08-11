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

test("pass logging and day completion remain separate canonical mutations", () => {
  const grazer = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");
  const partial = read("supabase/migrations/20260729154000_weed_card_clear_partial_buttons_v1.sql");

  assert.match(grazer, /record_weed_card_pass_v1/);
  assert.match(grazer, /finish_weed_card_day_v1/);
  assert.match(grazer, /'taskClosed',p_condition_after='clear'/);
  assert.match(grazer, /'task_kept_open',p_condition_after<>'clear'/);
  assert.match(partial, /finish_partial_weed_card_day_v1/);
  assert.match(partial, /record_weed_card_pass_v1/);
  assert.match(partial, /finish_weed_card_day_v1/);
  assert.match(partial, /Use the Clear action when the bed is clear/);
  assert.match(partial, /'taskClosed', true/);
  assert.match(partial, /'passClosed', false/);
});

test("legacy time remains optional evidence while the live Weed Card is state-first", () => {
  const migration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");
  const contract = read("lib/atlas/weed-card-contract.ts");
  const focus = read("components/atlas/weed-card-task-focus.tsx");

  assert.match(migration, /v_minutes integer := coalesce\(p_minutes,0\)/);
  assert.match(migration, /minutes_known/);
  assert.match(contract, /minutes\?: number \| null/);
  assert.match(focus, /minutes: null/);
  assert.match(focus, /Bed now/);
  assert.match(focus, /Save state/);
  assert.doesNotMatch(focus, /QUICK_MINUTES|Add time|<span>Time<\/span>|atlas-weed-invested/);
});

test("the Weed Card keeps its state outcomes while entering the universal execution shell", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const client = read("lib/atlas/weed-card-client.ts");
  const setAsideClient = read("lib/atlas/task-set-aside-client.ts");
  const passApi = read("app/api/atlas/weed-card-session/route.ts");
  const partialApi = read("app/api/atlas/weed-card-partial/route.ts");

  assert.match(canonical, /isWeedTask/);
  assert.match(canonical, /WeedCardTaskLoader/);
  assert.match(loader, /\/api\/atlas\/weed-card\?taskId=/);
  assert.match(loader, /childTasks=\{childTasks\}/);
  assert.match(focus, /AssignedTaskExecutionShell/);
  assert.match(focus, /methodInstrument=\{methodInstrument\}/);
  assert.match(focus, /resultInstrument=\{resultInstrument\}/);
  assert.match(focus, /data-atlas-method-instrument="weed-card"/);
  assert.match(focus, /data-atlas-result-instrument="weed-card"/);
  assert.doesNotMatch(focus, /TaskDominionTrail/);
  assert.doesNotMatch(focus, /atlas-phone-shell|atlas-task-page-shell/);
  assert.match(shell, /methodInstrument \? methodInstrument\(instrumentContext\)/);
  assert.match(shell, /resultInstrument \? resultInstrument\(instrumentContext\)/);

  assert.match(focus, /<CropOccupancyList groups=\{card\.occupancyGroups\} \/>/);
  assert.doesNotMatch(focus, /CropOccupancyBedMap|variant="notebook"/);
  assert.match(focus, /MaintenanceDirectiveStrip taskId=\{task\.task_id\}/);
  assert.match(focus, /atlas-task-result-actions atlas-task-result-actions-simple atlas-weed-day-actions/);
  assert.match(focus, /className="done"/);
  assert.match(focus, /"Clear"/);
  assert.match(focus, />\s*Partly finished\s*</);
  assert.match(focus, /postAtlasFinishPartialWeedCardDay/);
  assert.match(focus, /conditionAfter: "clear"/);
  assert.match(focus, /atlas-task-move-drawer atlas-weed-move-drawer/);
  assert.match(focus, />\s*Set aside\s*</);
  assert.match(focus, />\s*Tomorrow\s*</);
  assert.match(focus, /Choose return date/);
  assert.match(focus, /type="date"/);
  assert.match(focus, /postAtlasTaskSetAsideToday\(task\.task_id, requestedReturnDate\)/);
  assert.doesNotMatch(focus, />\s*Do tomorrow\s*</);
  assert.doesNotMatch(focus, /That’s all for today|>\s*Unfinished\s*<|>Log a pass/);

  assert.match(client, /weed-card-partial-v1/);
  assert.match(client, /\/api\/atlas\/weed-card-partial/);
  assert.match(setAsideClient, /task-set-aside-v2/);
  assert.match(passApi, /record_weed_card_pass_v1/);
  assert.match(partialApi, /finish_partial_weed_card_day_v1/);
  assert.match(partialApi, /conditionAfter === "clear"/);
});

test("Weed-specific field truth is an instrument beneath the shared Task Move instead of a second trail", () => {
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const cohesion = read("components/atlas/weed-card-cohesion.module.css");
  const map = read("components/atlas/crop-occupancy-bed-map.tsx");
  const mapCss = read("components/atlas/crop-occupancy-bed-map.module.css");

  assert.match(focus, /atlas-weed-card-occupancy/);
  assert.match(focus, /atlas-weed-condition-summary/);
  assert.match(focus, /atlas-weed-condition-scale/);
  assert.match(focus, /Recent bed states/);
  assert.match(focus, /card\.sessions\.slice\(0, 4\)/);
  assert.doesNotMatch(focus, /presentation="weed-sheet"|moveDetails=|instruction=\{/);
  assert.doesNotMatch(focus, /Today ·/);
  assert.match(cohesion, /\.cohesive :global\(\.atlas-task-dominion-weed-meta\)/);
  assert.match(map, /compactCropLabel/);
  assert.match(map, /return "FMN"/);
  assert.match(mapCss, /\.notebook \.bed/);
  assert.match(mapCss, /rgba\(190, 185, 174, 0\.62\)/);
});

test("Partly finished closes one daily serving and releases one same-card continuation", () => {
  const finalMigration = read("supabase/migrations/20260729014000_weed_card_final_contract_v1.sql");
  const grazerMigration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");
  const partialMigration = read("supabase/migrations/20260729154000_weed_card_clear_partial_buttons_v1.sql");

  assert.match(finalMigration, /release_weed_card_continuation_v1/);
  assert.match(finalMigration, /The prior Weed Card session must be done/);
  assert.match(finalMigration, /replacement_source_task_id/);
  assert.match(grazerMigration, /planned_by','finish_weed_card_day_v1/);
  assert.match(grazerMigration, /v_next_task_id := atlas\.release_weed_card_continuation_v1/);
  assert.match(partialMigration, /p_idempotency_key \|\| ':pass'/);
  assert.match(partialMigration, /p_idempotency_key \|\| ':day'/);
});

test("Clear closes the pass and returns the permanent card to its maintenance rhythm", () => {
  const migration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");

  assert.match(migration, /status=case when p_condition_after='clear' then 'closed'/);
  assert.match(migration, /next_review_on=case when p_condition_after='clear'/);
  assert.match(migration, /active=p_condition_after='clear'/);
  assert.match(migration, /when 'clear' then 'maintained'/);
});

test("legacy weed work is backfilled only into still-open physical passes", () => {
  const migration = read("supabase/migrations/20260729193000_legacy_weed_history_backfill_v1.sql");

  assert.match(migration, /wc\.current_condition <> 'clear'/);
  assert.match(migration, /mh\.outcome = 'partially_completed'/);
  assert.match(migration, /mh\.actual_minutes is not null and mh\.actual_minutes > 0 as minutes_known/);
  assert.match(migration, /Historical weed work · time unrecorded/);
  assert.match(migration, /legacy_weed_history_backfill_v1/);
  assert.match(migration, /backfill:maintenance_history:/);
  assert.match(migration, /backfill:task_outcome:/);
  assert.match(migration, /ws\.metadata ->> 'maintenance_history_id'/);
  assert.match(migration, /sum\(ws\.minutes\)::integer as total_minutes/);
  assert.match(migration, /day_closed/);
  assert.match(migration, /reopened/);
  assert.match(migration, /legacy_weed_history_unmapped_reason/);
  assert.doesNotMatch(migration, /estimated_minutes/);
});
