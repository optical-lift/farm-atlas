import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("current exact-date worker specimens carry literal execution packets", () => {
  const migration = read("supabase/migrations/20260812150000_current_worker_acceptance_normalization_v1.sql");

  assert.match(migration, /anna_chicken_chore_20260812/);
  assert.match(migration, /anna_chicken_chore_20260811/);
  assert.match(migration, /Give 4 scoops of feed\./);
  assert.match(migration, /Refresh the water bucket\./);
  assert.match(migration, /Gather eggs\./);

  assert.match(migration, /zinnia_2026_s5_house_south_sow/);
  assert.match(migration, /House South Foundation Border — West Section/);
  assert.match(migration, /rows_per_3ft_bed/);
  assert.match(migration, /in_row_spacing_in/);
  assert.match(migration, /Use 3 rows\./);
  assert.match(migration, /9-inch spacing/);

  assert.match(migration, /anna_20260713_mow_corral_weekly/);
  assert.match(migration, /Mow the Corral\./);
  assert.match(migration, /Use the riding mower\./);
  assert.doesNotMatch(migration, /borrowed mower blade bent/);

  assert.match(migration, /Hang conference-room café lights \+ porch solar lights/);
  assert.match(migration, /Conference room \+ porches/);
});

test("current and Thursday note-backed work is deliberately promoted into worker fields", () => {
  const migration = read("supabase/migrations/20260812151500_aug12_aug13_worker_packet_normalization_v1.sql");

  assert.match(migration, /Expected 13 current worker acceptance tasks/);
  assert.match(migration, /Clean Interior Windows \+ Glass Doors/);
  assert.match(migration, /Kid Chore — Sweep Porches/);
  assert.match(migration, /Pick Up Sticks \+ Put Away Hoses Before Mowing/);
  assert.match(migration, /Home Depot — 2104 E Independence, Springfield, MO 65804/);
  assert.match(migration, /Harvest copious lemon basil\./);
  assert.match(migration, /seven sister-garden florist buckets/);
  assert.match(migration, /Basement restroom route/);
  assert.match(migration, /Round table by the windows/);
  assert.match(migration, /cold brew carafe/);
  assert.match(migration, /exactly 3 inches of clean water/);
  assert.match(migration, /5 new snips/);
  assert.match(migration, /Sharpie for writing each guest’s name/);
  assert.match(migration, /'execution_do',v_do/);
  assert.match(migration, /'execution_how',v_how/);
});

test("the current Weed Card gets a shared-shell brief without replacing its specialty instrument", () => {
  const migration = read("supabase/migrations/20260812152500_current_weed_card_worker_packet_v1.sql");
  const client = read("components/atlas/canonical-assigned-task-detail-client.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");

  assert.match(migration, /weed:mg11/);
  assert.match(migration, /current_condition<>'heavy'/);
  assert.match(migration, /target_condition<>'clear'/);
  assert.match(migration, /Work MG11 toward the Weed Card target: clear\./);
  assert.match(migration, /Partly finished/);

  assert.match(client, /if \(isWeedTask\(props\.task\)\) return <WeedCardTaskLoader/);
  assert.match(focus, /<AssignedTaskExecutionShell/);
  assert.match(focus, /methodInstrument=\{methodInstrument\}/);
  assert.match(focus, /resultInstrument=\{resultInstrument\}/);
});
