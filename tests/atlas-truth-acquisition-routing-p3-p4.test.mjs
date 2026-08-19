import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routing = readFileSync(
  "supabase/migrations/20260819235420_p3_p4_truth_acquisition_task_routing_v1.sql",
  "utf8",
);
const lane = readFileSync(
  "supabase/migrations/20260819235603_p3_p4_truth_acquisition_required_lane_v2.sql",
  "utf8",
);

test("truth acquisition has one optional task carrier without making the task requirement authority", () => {
  assert.match(routing, /carrier_task_id uuid null/);
  assert.match(routing, /references atlas\.tasks\(id\)/);
  assert.match(routing, /taskIsCarrierNotRequirement',true/);
});

test("crop transplant destination decisions route to the active Owner rather than the Farm Hand", () => {
  assert.match(routing, /v_instance\.action_key='choose_transplant_destination'/);
  assert.match(routing, /v_jurisdiction:='owner'/);
  assert.match(routing, /fm\.role='owner'/);
  assert.match(routing, /workerDoesNotReceiveOwnerDecision',true/);
  assert.match(routing, /assigned_membership_id=v_owner_membership_id/);
  assert.match(routing, /visibility_scope='owner'/);
});

test("routing adopts an existing destination carrier before creating another one", () => {
  assert.match(routing, /v_instance\.carrier_task_id is not null/);
  assert.match(routing, /t\.task_type='spatial_destination_resolution'/);
  assert.match(routing, /atlas\.ensure_crop_destination_resolution_v1\(v_cycle\.id\)/);
  assert.match(routing, /'adoptedExistingCarrier',true/);
});

test("the Owner carrier speaks the biological requirement before the missing decision", () => {
  assert.match(routing, /needs planted — choose where it goes/);
  assert.match(routing, /needs planted\. Atlas does not know where it goes yet\./);
  assert.match(routing, /'display_action','Choose where to plant it'/);
  assert.match(routing, /'requirement_statement',v_subject\|\|' needs planted\.'/);
  assert.match(routing, /'missing_truth_statement','Atlas does not know where it goes yet\.'/);
});

test("carrier is causally linked to the source requirement and inherits its time evidence", () => {
  assert.match(routing, /source_requirement_instance_id',v_requirement\.id/);
  assert.match(routing, /state_consequence_instance_id',v_instance\.id/);
  assert.match(routing, /v_known_active_by:=v_requirement\.requirement_known_active_by/);
  assert.match(routing, /requirement_known_active_by',v_known_active_by/);
  assert.match(routing, /requirement_time_class',v_requirement\.requirement_time_class/);
  assert.match(routing, /'inherited_urgency',true/);
});

test("choosing a destination cannot falsely record the physical transplant", () => {
  assert.match(routing, /destinationDecisionDoesNotRecordTransplant',true/);
  assert.match(routing, /workerExecutionRemainsUnreleased',true/);
  assert.match(routing, /'worker_execution_released',false/);
  assert.match(routing, /Transplant remains unreleased until destination warrant clears/);
});

test("consequential truth acquisition cannot be demoted by stale discretionary metadata", () => {
  assert.match(lane, /v_inherited_truth_urgency boolean/);
  assert.match(lane, /if v_inherited_truth_urgency then return 'required'; end if;/);
  assert.match(lane, /cannot be demoted by stale discretionary carrier metadata/);
});

test("bounded biological timing produces persistent commitment instead of a fabricated hard date", () => {
  assert.match(lane, /if v_inherited_truth_urgency then return 'persistent'; end if;/);
  assert.match(lane, /do not fabricate a hard-date contract/);
  assert.match(lane, /'date_commitment','persistent'/);
});

test("new routing helpers stay service-internal", () => {
  for (const signature of [
    "atlas.truth_acquisition_jurisdiction_v1(uuid)",
    "atlas.ensure_truth_acquisition_task_v1(uuid)",
    "atlas.sync_truth_acquisition_carrier_v1()",
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      routing,
      new RegExp(`revoke all on function ${escaped} from public,anon,authenticated`, "i"),
    );
    assert.match(
      routing,
      new RegExp(`grant execute on function ${escaped} to service_role`, "i"),
    );
  }
});
