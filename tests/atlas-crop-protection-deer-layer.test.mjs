import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layer = read("supabase/migrations/20260812024500_crop_protection_deer_layer_v1.sql");
const resourceFix = read("supabase/migrations/20260812024600_crop_protection_resource_attachment_fix_v1.sql");
const normalized = layer.replace(/\s+/g, " ").trim();

test("deer protection is durable crop state with policy, enrollment, and event history", () => {
  assert.match(layer, /create table if not exists atlas\.crop_protection_policies/);
  assert.match(layer, /create table if not exists atlas\.crop_protection_enrollments/);
  assert.match(layer, /create table if not exists atlas\.crop_protection_events/);
  assert.match(layer, /green_confirmed_on date/);
  assert.match(layer, /last_treated_on date/);
  assert.match(layer, /next_due_on date/);
});

test("green emergence enrolls active outdoor crop cycles without inventing a worker task before method truth exists", () => {
  assert.match(layer, /crop_observation_confirms_green_v1/);
  assert.match(layer, /after insert or update of stage,condition on atlas\.crop_observations/);
  assert.match(layer, /zone\.zone_type/);
  assert.match(layer, /scope_zone_type=v_placement\.zone_type/);
  assert.match(layer, /case when v_policy\.method_status='ready' and v_policy\.interval_days is not null then 'active' else 'waiting_method' end/);
  assert.match(layer, /if v_policy\.method_status='ready' and v_policy\.interval_days is not null then\s*perform atlas\.plan_crop_protection_occurrence_v1/);
});

test("Elm seed records only the Owner-confirmed garlic concentrate and hand-pump sprayer facts", () => {
  assert.match(layer, /'deer_garlic_concentrate','Garlic concentrate','pest_control','deer_repellent','available'/);
  assert.match(layer, /'hand_pump_sprayer','Hand pump sprayer','equipment','sprayer','available'/);
  assert.match(layer, /'label_method_status','not_yet_recorded'/);
  assert.match(layer, /'label_required'/);
  assert.doesNotMatch(layer, /tablespoon|teaspoon|ounce|gallon|dilut|mix \d|every \d+ days/i);
});

test("an exact product-label method and interval are required before release", () => {
  assert.match(layer, /owner_configure_crop_protection_policy_v1/);
  assert.match(layer, /Only the farm Owner may configure a crop protection method/);
  assert.match(layer, /Product-label method, exact worker instructions, and reapplication interval are required/);
  assert.match(layer, /method_authority','owner_confirmed_product_label'/);
  assert.match(layer, /method_status='ready'/);
  assert.match(layer, /interval_days=p_interval_days/);
});

test("configured protection recurs from actual treatment completion", () => {
  assert.match(layer, /record_crop_protection_completion_v1/);
  assert.match(layer, /event_kind.*treatment_applied/s);
  assert.match(layer, /next_due_on=v_today\+v_policy\.interval_days/);
  assert.match(layer, /perform atlas\.plan_crop_protection_occurrence_v1\(v_enrollment\.id\)/);
  assert.match(layer, /completionIndependentSchedule',false/);
});

test("protection tasks carry canonical resources with allowed requirement vocabulary", () => {
  assert.match(resourceFix, /requirement_source,\s*quantity_needed/);
  assert.match(resourceFix, /'system_generated'/);
  assert.match(resourceFix, /'material'::text,'treatment'/);
  assert.match(resourceFix, /'equipment'::text,'applicator'/);
  assert.doesNotMatch(resourceFix, /insert into atlas\.task_resource_requirements\(farm_id/);
  assert.doesNotMatch(resourceFix, /'crop_protection_policy'/);
  assert.doesNotMatch(resourceFix, /'treatment'::text,'treatment'/);
});

test("green observation events deduplicate without collapsing treatment history", () => {
  assert.match(resourceFix, /crop_protection_green_observation_event_uidx/);
  assert.match(resourceFix, /where event_kind='green_confirmed'/);
  assert.doesNotMatch(resourceFix, /where event_kind='treatment_applied'/);
});

test("crop protection storage stays internal while only the Owner configuration RPC is authenticated", () => {
  assert.match(normalized, /alter table atlas\.crop_protection_policies enable row level security/);
  assert.match(normalized, /revoke all on atlas\.crop_protection_policies,atlas\.crop_protection_enrollments,atlas\.crop_protection_events from public,anon,authenticated/);
  assert.match(layer, /grant execute on function atlas\.owner_configure_crop_protection_policy_v1\(uuid,text,text\[\],integer\) to authenticated/);
});

test("worker treatment prose can never fall back to vague optional deer advice", () => {
  assert.doesNotMatch(layer + resourceFix, /if practical/i);
  assert.doesNotMatch(layer + resourceFix, /if available,? protect/i);
  assert.match(layer, /execution_how',to_jsonb\(v_policy\.method_instructions\)/);
});
