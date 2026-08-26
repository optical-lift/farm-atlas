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
  assert.match(focus, /How’d we do\?/);
  assert.match(focus, /BED_WORK_RESULTS/);
  assert.match(focus, /Save result/);
  assert.doesNotMatch(focus, /QUICK_MINUTES|Add time|<span>Time<\/span>|atlas-weed-invested/);
});

test("the Weed Card keeps canonical state mutations inside the shared standalone bed-work Task Card family", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const client = read("lib/atlas/weed-card-client.ts");
  const passApi = read("app/api/atlas/weed-card-session/route.ts");
  const partialApi = read("app/api/atlas/weed-card-partial/route.ts");

  assert.match(canonical, /isWeedTask/);
  assert.match(canonical, /WeedCardTaskLoader/);
  assert.match(loader, /\/api\/atlas\/weed-card\?taskId=/);
  assert.match(loader, /childTasks=\{childTasks\}/);
  assert.equal((focus.match(/<AtlasTaskCardFrame/g) || []).length, 1);
  assert.match(focus, /const family = isClear \? "Clear" : "Weed"/);
  assert.match(focus, /card\?\.bedUseCategory/);
  assert.match(focus, /data-atlas-weed-card-template="task-card-lab-v4-spatial-result"/);
  assert.doesNotMatch(focus, /AssignedTaskExecutionShell|methodInstrument=|resultInstrument=/);
  assert.doesNotMatch(focus, /TaskDominionTrail|atlas-phone-shell|atlas-task-page-shell/);

  assert.match(focus, />Active Crops</);
  assert.match(focus, /card\?\.occupancyGroups/);
  assert.match(focus, /CropOccupancyBedMap/);
  assert.match(focus, /variant="notebook"/);
  assert.match(focus, /card\?\.bedMap/);
  assert.match(focus, /MaintenanceDirectiveStrip taskId=\{task\.task_id\}/);
  assert.match(focus, /Still rough/);
  assert.match(focus, /Mostly clear/);
  assert.match(focus, /All clear/);
  assert.match(focus, /Save result/);
  assert.match(focus, />Blocked<\/button>/);
  assert.match(focus, /postAtlasFinishPartialWeedCardDay/);
  assert.match(focus, /postAtlasWeedCardSession/);
  assert.match(focus, /conditionAfter: "clear"/);
  assert.doesNotMatch(focus, /Finish Weed/);
  assert.doesNotMatch(focus, /Move this card|Choose return date|postAtlasTaskSetAsideToday/);

  assert.match(client, /weed-card-partial-v1/);
  assert.match(client, /\/api\/atlas\/weed-card-partial/);
  assert.match(passApi, /record_weed_card_pass_v1/);
  assert.match(partialApi, /finish_partial_weed_card_day_v1/);
  assert.match(partialApi, /conditionAfter === "clear"/);
});

test("Weed-specific field truth feeds the shared bed-work card instead of a second generic execution instrument", () => {
  const focus = read("components/atlas/weed-card-task-focus.tsx");

  assert.match(focus, /card\?\.bedTrail/);
  assert.match(focus, /card\?\.occupancyGroups/);
  assert.match(focus, /card\?\.mainCropLabel/);
  assert.match(focus, /Unknown main crop/);
  assert.doesNotMatch(focus, /card\.lastLoggedCondition/);
  assert.doesNotMatch(focus, /card\.lastLoggedOn/);
  assert.match(focus, /Recent passes/);
  assert.match(focus, /sessions\.slice\(0, 3\)/);
  assert.match(focus, /Log it/);
  assert.match(focus, /aria-expanded=\{logOpen\}/);
  assert.match(focus, /Needs field confirmation/);
  assert.doesNotMatch(focus, /card\?\.targetCondition|Target ·/);
  assert.doesNotMatch(focus, /presentation="weed-sheet"|moveDetails=|instruction=\{/);
  assert.doesNotMatch(focus, /Field Row 13|ProCut Orange|12 ft|3 rows|Jun 10/);
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
