import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804101500_fixed_routines_and_marshall_order_v1.sql", import.meta.url),
  "utf8",
);
const hardDateMigration = readFileSync(
  new URL("../supabase/migrations/20260804101600_fixed_calendar_hard_date_contract_v1.sql", import.meta.url),
  "utf8",
);

function position(value) {
  const found = migration.indexOf(value);
  assert.notEqual(found, -1, `${value} must exist in the migration`);
  return found;
}

test("Marshall's departure project follows the handwritten order", () => {
  const orderedKeys = [
    "marshall_20260804_router_departure_trim",
    "marshall_20260804_replace_part_on_elm_mower",
    "marshall_20260804_call_hamptons_sheila_mower",
    "marshall_20260804_stain_departure_trim",
    "owner_20260804_reimburse_melody",
    "marshall_20260804_cut_departure_trim_pieces",
    "marshall_20260804_fix_basement_sink_plumbing",
    "marshall_20260804_hang_venue_mirrors_acrylic",
    "marshall_20260804_remove_damaged_flooring_for_patches",
    "marshall_20260804_install_working_basement_dryer",
    "marshall_20260804_buy_20ft_dryer_vent_hose",
    "marshall_20260804_buy_card_table_bolts_washers",
    "marshall_20260804_move_hutch_library_to_entry",
    "marshall_20260804_install_existing_trim_rooms",
    "marshall_20260802_install_venue_toilet",
    "marshall_20260804_fix_basement_wall_elbow",
    "marshall_20260804_replace_leaky_basement_ceiling_pipe",
    "marshall_20260804_replace_valve_sealant",
    "marshall_20260805_install_flooring_patches",
    "marshall_20260805_install_new_trim_bathroom_kitchen",
    "marshall_20260725_install_attic_bathroom_door",
    "marshall_20260804_move_mini_fridge_attic_kitchenette",
  ];

  let previous = -1;
  for (const key of orderedKeys) {
    const current = position(`('${key}'`);
    assert.ok(current > previous, `${key} must follow the preceding handwritten item`);
    previous = current;
  }

  assert.match(migration, /appearance_order_source','marshall_handwritten_list_20260804'/);
  assert.match(migration, /update atlas\.project_task_links/);
});

test("the existing raised-bed repair moves to Wednesday morning without duplication", () => {
  assert.match(migration, /marshall_20260804_repair_curve3_and_small_fm_beds/);
  assert.match(migration, /Marshall — Fix Curve Garden \+ FM Raised Beds/);
  assert.match(migration, /due_date = date '2026-08-05'/);
  assert.match(migration, /day_work_order_label','Wednesday morning'/);
  assert.match(migration, /The canonical Curve Garden and Follow Me raised-bed repair task was not found/);
});

test("Anna's indoor plants are a fixed Saturday rhythm", () => {
  assert.match(migration, /anna_water_indoor_plants_saturday/);
  assert.match(migration, /generate_series\(date '2026-08-08', date '2030-12-31', interval '7 days'\)/);
  assert.match(migration, /'repeat_weekday','Saturday'/);
  assert.match(migration, /'completion_independent_schedule',true/);
  assert.match(migration, /'recreate_on_done', false/);
});

test("outdoor planters follow a four-day base cadence and never land on Sunday", () => {
  assert.match(migration, /anna_water_outdoor_planters_every_4_days/);
  assert.match(migration, /generate_series\(date '2026-08-05', date '2030-12-31', interval '4 days'\)/);
  assert.match(migration, /extract\(dow from v_base_date\)=0 then v_base_date\+1/);
  assert.match(migration, /move_to_monday_keep_base_cadence/);
  assert.match(migration, /'recreate_on_done', false/);
});

test("harvest is one fixed Thursday series independent of completion", () => {
  assert.match(migration, /anna_harvest_thursday_weekly_2026/);
  assert.match(migration, /generate_series\(date '2026-08-06', date '2026-11-12', interval '7 days'\)/);
  assert.match(migration, /'repeat_weekday','Thursday'/);
  assert.match(migration, /'schedule_source','fixed_calendar'/);
  assert.match(migration, /'completion_independent_schedule',true/);
  assert.match(migration, /'recreate_on_done', false/);
  assert.match(migration, /anna_harvest_tuesday_weekly_2026/);
  assert.match(migration, /anna_harvest_friday_weekly_2026/);
  assert.match(migration, /Replaced by fixed Thursday harvest rhythm/);
  assert.match(migration, /Bundle conditioned Thursday harvest/);
});

test("fixed calendar tasks keep authored dates and canonical recurrence identity", () => {
  assert.match(hardDateMigration, /commitment_kind', 'hard_date'/);
  assert.match(hardDateMigration, /dateBehavior', 'hard_date'/);
  assert.match(hardDateMigration, /hydrate_fixed_calendar_task_identity_v1/);
  assert.match(hardDateMigration, /new\.task_series_key := coalesce/);
  assert.match(hardDateMigration, /new\.engine_instance_key := coalesce/);
  assert.match(hardDateMigration, /completion_independent_schedule', true/);
});
