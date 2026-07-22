import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const engine = read(
  "supabase/migrations/20260722022823_atlas_add_owner_capacity_assignment_engine.sql",
);
const snapshot = read(
  "supabase/migrations/20260722023200_atlas_add_owner_capacity_snapshot.sql",
);
const mutations = read(
  "supabase/migrations/20260722023535_atlas_add_owner_capacity_mutations.sql",
);
const reconcile = read(
  "supabase/migrations/20260722025101_atlas_reconcile_capacity_changes_and_bed_assignments.sql",
);
const route = read("app/api/atlas/production-capacity/route.ts");
const page = read("app/owner/production-readiness/page.tsx");
const client = read("app/owner/production-readiness/ProductionReadinessClient.tsx");
const helper = read("lib/atlas-data/production-capacity.ts");
const dashboard = read("app/owner/OwnerDashboardClient.tsx");

test("owner capacity planning adds structured bed assignments without replacing farm objects", () => {
  assert.match(engine, /create table atlas\.production_bed_assignments/);
  assert.match(engine, /object_id uuid not null references atlas\.growing_objects/);
  assert.match(engine, /requirement_id uuid not null references atlas\.production_capacity_requirements/);
  assert.match(engine, /Bed assignments require a measured growing bed/);
  assert.match(engine, /Bed assignment exceeds the selected bed length/);
  assert.match(mutations, /production_bed_assignments_one_active_object_uidx/);
  assert.match(mutations, /where assignment_status='assigned'/);
});

test("zero working grow lights is a valid measured count instead of missing data", () => {
  assert.match(engine, /measurement_kind='count' and value>=0/);
  assert.match(mutations, /functional_grow_light_sets/);
  assert.match(mutations, /v_min:=0;v_max:=1000/);
  assert.match(client, /working light sets/);
  assert.match(client, /min: 0/);
});

test("owner read and write paths remain membership scoped", () => {
  for (const sql of [snapshot, mutations]) {
    assert.match(sql, /atlas\.is_farm_owner\(p_farm_id\)/);
  }
  assert.match(page, /requireAtlasRole\(\["owner"\]\)/);
  assert.match(route, /requireAtlasApiAccess\(\{ allowedRoles: \["owner"\] \}\)/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /production-capacity-v1/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /service_role/i);
  assert.doesNotMatch(route, /\.from\("capacity_/);
});

test("internal capacity records stay sealed while owner RPCs are callable", () => {
  assert.match(engine, /revoke all on atlas\.production_bed_assignments from public,anon,authenticated/);
  assert.match(engine, /grant select,insert,update,delete on atlas\.production_bed_assignments to service_role/);
  assert.match(snapshot, /revoke execute on function atlas\.owner_production_capacity_snapshot_v1\(uuid\) from public,anon/);
  assert.match(mutations, /grant execute on function atlas\.owner_answer_capacity_question_v1/);
  assert.match(mutations, /grant execute on function atlas\.owner_assign_production_bed_v1/);
  assert.match(mutations, /grant execute on function atlas\.owner_release_production_bed_v1/);
});

test("answering one fact recalculates dependent January requirements", () => {
  assert.match(mutations, /refresh_grow_room_capacity_pools_v1/);
  assert.match(mutations, /refresh_snapdragon_capacity_requirements_v1/);
  assert.match(mutations, /refresh_snapdragon_tray_windows_v1/);
  assert.match(mutations, /sync_snapdragon_auto_capacity_reservations_v1/);
  assert.match(mutations, /sync_snapdragon_bed_preparation_tasks_v1/);
  assert.match(mutations, /confidence not in \('measured','confirmed','estimated'\)/);
  assert.match(mutations, /planned_seed_quantity_confirmed/);
  assert.match(mutations, /production_lot_events/);
});

test("tray, shelf, and light reservations carry dated occupancy windows", () => {
  assert.match(snapshot, /refresh_snapdragon_tray_windows_v1/);
  assert.match(snapshot, /window_end=r\.window_start\+\(ceil\(v_days\)::integer-1\)/);
  assert.match(engine, /req\.capacity_kind in \('trays','shelf_positions','lit_shelf_positions'\)/);
  assert.match(engine, /grow_room_tray_inventory/);
  assert.match(engine, /grow_room_shelf_positions/);
  assert.match(engine, /grow_room_lit_shelf_positions/);
});

test("recalculation releases stale reservations before creating the current window", () => {
  assert.match(reconcile, /capacity_requirement_recalculated/);
  assert.match(reconcile, /r\.window_start is distinct from req\.window_start/);
  assert.match(reconcile, /r\.window_end is distinct from req\.window_end/);
  assert.match(reconcile, /r\.quantity_reserved is distinct from req\.quantity_needed/);
  assert.match(reconcile, /reservation_status='released'/);
});

test("bed assignments create canonical preparation work linked to place and crop cohort", () => {
  assert.match(engine, /generated_from,'production_bed_assignment'/);
  assert.match(engine, /engine_instance_key/);
  assert.match(engine, /capacity-bed-prep:/);
  assert.match(engine, /insert into atlas\.task_objects/);
  assert.match(engine, /insert into atlas\.production_lot_tasks/);
  assert.match(engine, /'bed_preparation','capacity_planner'/);
  assert.match(engine, /assigned_membership_id/);
  assert.match(engine, /worker_key='anna'/);
});

test("releasing a bed uses the canonical changed-plan transition", () => {
  assert.match(reconcile, /record_task_transition_v1_internal/);
  assert.match(reconcile, /'changed_plan'/);
  assert.match(reconcile, /capacity-bed-release:/);
  assert.doesNotMatch(reconcile, /update atlas\.tasks set status='archived'/);
});

test("density changes reopen an over-assigned bed plan", () => {
  assert.match(reconcile, /refresh_snapdragon_bed_assignment_status_v1/);
  assert.match(reconcile, /assigned_quantity>req_quantity/);
  assert.match(reconcile, /over-assigned after recalculation/);
  assert.match(reconcile, /production_capacity_requirements_refresh_bed_assignments/);
});

test("bed placement does not invent a harvest or release date", () => {
  assert.match(engine, /expected_release_date date/);
  assert.doesNotMatch(mutations, /expected_release_date/);
  assert.match(mutations, /planned_transplant_date/);
});

test("owner API supports only the four explicit capacity mutations", () => {
  for (const action of ["answer_question", "assign_bed", "release_bed", "recalculate"]) {
    assert.match(route, new RegExp(`action === \\"${action}\\"`));
  }
  assert.match(route, /owner_answer_capacity_question_v1/);
  assert.match(route, /owner_assign_production_bed_v1/);
  assert.match(route, /owner_release_production_bed_v1/);
  assert.match(route, /owner_recalculate_production_capacity_v1/);
});

test("owner interface exposes real questions, capacities, lots, beds, and conflicts", () => {
  assert.match(helper, /OwnerProductionCapacitySnapshot/);
  assert.match(client, /Measure the real system/);
  assert.match(client, /What Elm can hold/);
  assert.match(client, /Assign each crop cohort/);
  assert.match(client, /capacityConflicts/);
  assert.match(client, /Assign \+ create prep work/);
  assert.match(client, /How certain is this\?/);
  assert.match(client, /Estimated answers remain labeled as estimates/);
});

test("owner dashboard links to production readiness without changing worker navigation", () => {
  assert.match(dashboard, /href="\/owner\/production-readiness"/);
  assert.match(dashboard, /Measure January capacity/);
  assert.match(dashboard, /seed · trays · lights · shelves · beds/);
});
