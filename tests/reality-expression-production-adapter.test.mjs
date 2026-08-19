import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationNames = [
  "20260817231535_production_reality_expression_packet_v1.sql",
  "20260817231620_production_reality_expression_packet_task_link_fix_v1.sql",
  "20260817231644_production_reality_expression_packet_link_schema_fix_v2.sql",
];

const migrations = migrationNames.map((name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
);

const [adapter, taskLinkFix, cropLinkFix] = migrations;
const adapterFunction = adapter.match(
  /create or replace function atlas\.reality_expression_packet_v1[\s\S]*?\$function\$;/i,
)?.[0];

assert.ok(adapterFunction, "Production Reality Expression adapter must exist");

test("Phase 3 adapter is read-only and service-internal", () => {
  assert.match(adapter, /stable\s+security invoker/i);
  assert.match(
    adapter,
    /revoke execute on function atlas\.reality_expression_packet_v1\(uuid\) from authenticated;/i,
  );
  assert.match(
    adapter,
    /grant execute on function atlas\.reality_expression_packet_v1\(uuid\) to service_role;/i,
  );
  assert.doesNotMatch(adapterFunction, /\binsert\s+into\b/i);
  assert.doesNotMatch(adapterFunction, /\bupdate\s+atlas\./i);
  assert.doesNotMatch(adapterFunction, /\bdelete\s+from\b/i);
});

test("the adapter reads canonical Production Lot truth instead of rebuilding state", () => {
  for (const source of [
    "atlas.production_lots",
    "atlas.production_programs",
    "atlas.production_lot_events",
    "atlas.production_lot_crop_cycles",
    "atlas.production_lot_tasks",
    "atlas.seed_lot_allocations",
    "atlas.seed_lots",
    "atlas.seed_lot_inventory_v1",
    "atlas.production_bed_assignments",
    "atlas.production_capacity_reservations",
    "atlas.production_seed_readiness_v1",
    "atlas.production_capacity_readiness_v1",
  ]) {
    assert.ok(adapter.includes(source), `missing canonical source ${source}`);
  }

  assert.match(adapter, /'duplicatesCanonicalState',false/);
  assert.match(adapter, /'taskIsNotReality',true/);
});

test("planned quantity never substitutes for unknown current quantity", () => {
  assert.match(
    adapter,
    /Production lot current quantity is not recorded\. Planned input quantity is preserved separately and is not substituted as current quantity\./,
  );
  assert.match(adapter, /'currentQuantity'/);
  assert.match(adapter, /'plannedInput'/);
  assert.match(adapter, /'plannedIsNotObserved',true/);
});

test("Phase 3 packet exposes every master-build lane", () => {
  for (const lane of [
    "'subject'",
    "'source'",
    "'witness'",
    "'currentState'",
    "'flowBuffer'",
    "'locationCustody'",
    "'inputs'",
    "'claims'",
    "'spatialReadiness'",
    "'fittingOperation'",
    "'jurisdiction'",
    "'timing'",
    "'expectedTransition'",
    "'continuity'",
    "'truthBoundary'",
  ]) {
    assert.ok(adapter.includes(lane), `missing packet lane ${lane}`);
  }
});

test("missing readiness, destination, custody, and lineage remain typed gaps", () => {
  for (const gap of [
    "current_quantity_unknown",
    "seed_readiness_unrepresented",
    "seed_readiness_blocked",
    "capacity_readiness_unrepresented",
    "capacity_readiness_not_ready",
    "destination_bed_unresolved",
    "input_storage_location_unknown",
    "sown_lot_missing_crop_body_link",
  ]) {
    assert.ok(adapter.includes(`'${gap}'`), `missing continuity gap ${gap}`);
  }
  assert.match(adapter, /'insufficientWarrantAllowed',true/);
});

test("the adapter does not manufacture a worker assignment", () => {
  assert.match(
    adapter,
    /system_jurisdiction_established_human_carrier_not_inferred/,
  );
  assert.match(
    adapter,
    /This adapter does not convert a production requirement into a human assignment/,
  );
  assert.match(adapter, /canonical obligation\/release\/Clock path/);
});

test("readiness can demand preparation before the sow window without inventing sow work", () => {
  assert.match(adapter, /v_fitting_function := 'resolve_readiness'/);
  assert.match(adapter, /'prepare_before_window'/);
  assert.match(
    adapter,
    /Atlas cannot lawfully express a confident sow operation yet/,
  );
});

test("linked living bodies delegate operation fitness to crop reality", () => {
  assert.match(adapter, /atlas\.crop_cycle_reality_expression_v4\(cycle\.id\)/);
  assert.match(adapter, /v_fitting_function := 'continue_linked_crop_body'/);
  assert.match(adapter, /delegate_to_linked_crop_reality/);
});

test("production RPC registry is atomic with the EXECUTE change", () => {
  assert.match(adapter, /atlas\.authenticated_rpc_registry/i);
  assert.match(adapter, /'atlas\.reality_expression_packet_v1\(uuid\)'/);
  assert.match(adapter, /'service_internal','verified','active',false,false,true/);
});

test("production migration history preserves the two schema corrections in order", () => {
  assert.ok(migrationNames[0] < migrationNames[1]);
  assert.ok(migrationNames[1] < migrationNames[2]);

  assert.match(taskLinkFix, /'linkRole',link\.link_role/);
  assert.match(cropLinkFix, /'relationRole',link\.relation_role/);
  assert.match(cropLinkFix, /'confidence',link\.confidence/);
});
