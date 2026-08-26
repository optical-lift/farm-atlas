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

test("legacy time remains optional evidence while the live Weed action is state-first", () => {
  const migration = read("supabase/migrations/20260729022500_weed_card_grazer_logging_v1.sql");
  const contract = read("lib/atlas/weed-card-contract.ts");
  const focus = read("components/atlas/weed-card-task-focus.tsx");

  assert.match(migration, /v_minutes integer := coalesce\(p_minutes,0\)/);
  assert.match(migration, /minutes_known/);
  assert.match(contract, /minutes\?: number \| null/);
  assert.match(focus, /minutes: null/);
  assert.match(focus, /Bed now/);
  assert.match(focus, /How’d we do\?/);
  assert.match(focus, /WEED_RESULTS/);
  assert.match(focus, /Save result/);
  assert.doesNotMatch(focus, /QUICK_MINUTES|Add time|<span>Time<\/span>|atlas-weed-invested/);
});

test("the bed-work card keeps canonical Weed mutations inside the approved standalone Task Card family", () => {
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
  assert.match(focus, /AtlasTaskCardFrame/);
  assert.match(focus, /const actionLabel = clearMode \? "Clear" : "Weed"/);
  assert.match(focus, /const actionDetail = selectedCrop \|\| card\.bedUseCategory/);
  assert.match(focus, /data-atlas-weed-card-template="task-card-lab-v4-spatial-result"/);
  assert.doesNotMatch(focus, /AssignedTaskExecutionShell|methodInstrument=|resultInstrument=/);
  assert.doesNotMatch(focus, /TaskDominionTrail|atlas-phone-shell|atlas-task-page-shell/);

  assert.match(focus, />Active Crops</);
  assert.match(focus, /card\.occupancyGroups/);
  assert.match(focus, /CropOccupancyBedMap/);
  assert.match(focus, /variant="notebook"/);
  assert.match(focus, /card\.bedMap/);
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

test("Weed-specific field truth now lives directly in the approved card instead of a second generic execution instrument", () => {
  const focus = read("components/atlas/weed-card-task-focus.tsx");

  assert.match(focus, /card\.bedTrail/);
  assert.match(focus, /card\.occupancyGroups/);
  assert.match(focus, /card\.mainCropLabel/);
  assert.match(focus, /Unknown main crop/);
  assert.doesNotMatch(focus, /card\.lastLoggedCondition/);
  assert.doesNotMatch(focus, /card\.lastLoggedOn/);
  assert.match(focus, /Recent passes/);
  assert.match(focus, /card\.sessions\.slice\(0, 3\)/);
  assert.match(focus, /Log it/);
  assert.match(focus, /aria-expanded=\{logOpen\}/);
  assert.match(focus, /Needs field confirmation/);
  assert.doesNotMatch(focus, /card\.targetCondition|Target ·/);
});
