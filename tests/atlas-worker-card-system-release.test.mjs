import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const [
  weedCard,
  weedSessionRoute,
  weedPartialRoute,
  router,
  venueCard,
  venueMigration,
  sprayMigration,
  farmRoundMigration,
  sowCard,
  thinCard,
  germinationCard,
  cropMoveCard,
  taskBedMapRoute,
  taskBedMap,
  occupancyMap,
  squareFootCss,
  workToday,
  workCss,
  mowerBody,
] = await Promise.all([
  source('components/atlas/weed-card-task-focus.tsx'),
  source('app/api/atlas/weed-card-session/route.ts'),
  source('app/api/atlas/weed-card-partial/route.ts'),
  source('components/atlas/canonical-assigned-task-detail.tsx'),
  source('components/atlas/venue-task-detail.tsx'),
  source('supabase/migrations/20260822021726_venue_event_identity_and_dynamic_blooms_v2.sql'),
  source('supabase/migrations/20260822021904_spray_target_object_contract_v2.sql'),
  source('supabase/migrations/20260822021759_farm_round_indoor_plants_v1.sql'),
  source('app/task-focus/[taskId]/DirectSowFocusPage.tsx'),
  source('app/task-focus/[taskId]/ThinCropCycleFocusPage.tsx'),
  source('app/task-focus/[taskId]/GerminationFocusPage.tsx'),
  source('components/atlas/crop-move-task-detail.tsx'),
  source('app/api/atlas/task-bed-map/route.ts'),
  source('components/atlas/task-bed-map.tsx'),
  source('components/atlas/crop-occupancy-bed-map.tsx'),
  source('components/atlas/square-foot-bed-map.module.css'),
  source('app/work/today/page.tsx'),
  source('app/work/today/work.module.css'),
  source('components/atlas/mowing-task-card-body.tsx'),
]);

test('Weed cannot save a result without both condition and observation on client or server', () => {
  assert.match(weedCard, /completionNeedsNote = !clearMode/);
  assert.match(weedCard, /completionNeedsNote && !note\.trim\(\)/);
  assert.match(weedCard, /Log what you observed before saving the Weed result/);
  assert.match(weedCard, /"Save result"/);
  assert.match(weedCard, /Log it/);
  assert.match(weedCard, /Blocked/);
  for (const route of [weedSessionRoute, weedPartialRoute]) {
    assert.match(route, /if \(!note\)/);
    assert.match(route, /weed_card_observation_required/);
  }
});

test('spray and clean-restore work route through reusable task families', () => {
  assert.match(router, /action_key === "spray" && task\.operation_class === "apply_treatment"/);
  assert.match(router, /return <VegetationControlTaskDetail/);
  assert.match(router, /task\.operation_class !== "clean_restore"/);
  assert.match(router, /exterior_cleaning/);
  assert.match(router, /pressure_wash/);
  assert.match(router, /lounge\|library\|conference/i);
  assert.match(router, /return <VenueResetTaskDetail/);
});

test('Venue cards use event identity and dynamic Blooms rather than hardcoded bouquet counts', () => {
  assert.match(venueCard, /community_event_display_title/);
  assert.match(venueCard, /display_due_label/);
  assert.match(venueCard, /interaction === "information"/);
  assert.match(venueMigration, /ticketed_seasonal_evening[^\n]*then 'Thursdays at Elm'/);
  assert.match(venueMigration, /blooms_unscheduled/);
  assert.match(venueMigration, /'Blooms','Unscheduled'/);
  assert.doesNotMatch(venueMigration, /12 posies/i);
  assert.doesNotMatch(venueMigration, /6 bouquets/i);
});

test('canonical bed maps are shared by crop-cycle cards instead of copied per task', () => {
  for (const card of [sowCard, thinCard, germinationCard, cropMoveCard]) {
    assert.match(card, /TaskBedMap/);
  }
  assert.match(taskBedMapRoute, /task_objects/);
  assert.match(taskBedMapRoute, /object_crop_bed_map_v1/);
  assert.match(taskBedMapRoute, /map: null/);
});

test('worker bed maps use the approved square-foot mockup grammar when dimensions are known', () => {
  assert.match(taskBedMap, /data-atlas-task-bed-map="square-foot-mockup-v1"/);
  assert.match(taskBedMap, /one mark = 1 sq ft/);
  assert.match(taskBedMap, /variant="notebook"/);
  assert.match(occupancyMap, /data-atlas-square-foot-bed-map="mockup-v2"/);
  assert.match(occupancyMap, /const blockFt = Math\.min\(3, lengthFt\)/);
  assert.match(occupancyMap, /0 ft/);
  assert.match(occupancyMap, /tap another section to inspect it/);
  assert.match(occupancyMap, /const mark = placements\.length \? \(exact \? "o" : "·"\) : ""/);
  assert.match(squareFootCss, /\.bedRectangle/);
  assert.match(squareFootCss, /\.mapBlockActive/);
  assert.match(squareFootCss, /rgba\(214, 225, 177, 0\.34\)/);
  assert.match(squareFootCss, /border-right: 1px dashed/);
  assert.match(weedCard, /bedMaps\.map/);
  assert.match(weedCard, /CropOccupancyBedMap map=\{map\} variant="notebook"/);
});

test('treatment target and Saturday Farm Round membership are source-controlled', () => {
  assert.match(sprayMigration, /apply_treatment_target_v1/);
  assert.match(sprayMigration, /go\.stable_key='bb_10'/);
  assert.match(farmRoundMigration, /anna_water_indoor_plants_saturday/);
  assert.match(farmRoundMigration, /'house','House',10,30/);
});

test('worker list opens the exact canonical task from the whole card without swallowing controls', () => {
  assert.match(workToday, /taskFocusHref\(taskId: string\)/);
  assert.match(workToday, /\/task-focus\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(workToday, /Open task/);
  assert.match(workCss, /\.task\s*\{[\s\S]*position: relative/);
  assert.match(workCss, /\.task h3 a::after\s*\{[\s\S]*position: absolute;[\s\S]*inset: 0/);
  assert.match(workCss, /\.actions\s*\{[\s\S]*z-index: 2/);
  assert.match(workCss, /\.openTask\s*\{[\s\S]*z-index: 2/);
  assert.match(mowerBody, /Battery push mower/i);
  assert.match(mowerBody, /2 charged batteries required/);
});
