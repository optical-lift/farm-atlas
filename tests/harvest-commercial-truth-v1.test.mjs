import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260815143000_harvest_flower_commercial_truth_v1.sql");
const ownerHardening = read("supabase/migrations/20260815143050_harvest_flower_commercial_owner_context_hardening_v1.sql");
const registry = read("supabase/migrations/20260815143100_harvest_flower_commercial_truth_rpc_registry_v1.sql");
const commerceRoute = read("app/api/atlas/flower-commerce/route.ts");
const fulfillmentContext = read("app/api/atlas/flower-fulfillment-context/route.ts");
const fulfillmentRoute = read("app/api/atlas/flower-fulfillment/route.ts");
const fulfillmentFocus = read("app/task-focus/[taskId]/FlowerFulfillmentFocusPage.tsx");
const fulfillmentLoader = read("components/atlas/flower-fulfillment-task-loader.tsx");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const commercialSurface = read("app/harvest/FlowerCommercialSection.tsx");
const harvestedSurface = read("app/harvest/HarvestedOutputSection.tsx");
const audit = read("docs/HARVEST_COMMERCIAL_TRUTH_AUDIT.md");

test("commercial truth has append-only sale, Ready claim, and fulfillment facts", () => {
  assert.match(migration, /create table atlas\.flower_sale_orders/i);
  assert.match(migration, /create table atlas\.flower_sale_order_lines/i);
  assert.match(migration, /create table atlas\.flower_fulfillment_events/i);
  assert.match(migration, /ready_lot_id uuid not null references atlas\.flower_ready_inventory_lots/i);
  assert.match(migration, /flower_sale_orders_append_only_v1/i);
  assert.match(migration, /flower_sale_order_lines_append_only_v1/i);
  assert.match(migration, /flower_fulfillment_events_append_only_v1/i);
});

test("Ready birth truth remains immutable and availability is derived from explicit claims", () => {
  assert.match(migration, /Sale would claim more than the Ready quantity still available/i);
  assert.match(migration, /Sale line must preserve Ready product kind and unit exactly/i);
  assert.doesNotMatch(migration, /update\s+atlas\.flower_ready_inventory_lots/i);
  assert.doesNotMatch(commerceRoute, /\.update\([^\n]*flower_ready_inventory_lots|from\("flower_ready_inventory_lots"\)\.update/i);
  assert.match(commerceRoute, /birthQuantity - committedQuantity/);
  assert.match(commercialSurface, /title="Available"/);
  assert.match(commercialSurface, /Ready birth quantity minus explicit sale claims/);
});

test("outreach and community registration remain upstream or separate from flower sale truth", () => {
  assert.match(audit, /Buyer contact quantity\/price is not a sale/);
  assert.match(audit, /Registration payments are not flower sales/);
  for (const source of [migration, commerceRoute, fulfillmentRoute]) {
    assert.doesNotMatch(source, /insert into atlas\.buyer_contact_events|from\("buyer_contact_events"\)/i);
    assert.doesNotMatch(source, /community_registrations|community_registration_payments|community_registration_offerings/i);
  }
});

test("future fulfillment uses the planned-work membrane but does not place Clock time", () => {
  assert.match(migration, /ensure_flower_fulfillment_task_v1/i);
  assert.match(migration, /p_task_type=>'flower_fulfillment'/i);
  assert.match(migration, /p_maximum_active_instances=>1/i);
  assert.match(migration, /signal_work_occurrence_v1/i);
  assert.match(migration, /sale_commitment_recorded/i);
  assert.match(migration, /Worker Day\/Clock owns exact placement/i);
  assert.doesNotMatch(migration, /planned_start_at\s*=/i);
});

test("sale and fulfillment remain separate truths while immediate handoff records both atomically", () => {
  assert.match(migration, /fulfillment_mode='immediate_handoff'/i);
  assert.match(migration, /insert into atlas\.flower_fulfillment_events/i);
  assert.match(migration, /sale does not imply handoff/i);
  assert.match(fulfillmentFocus, /Were these flowers actually handed off\?/);
  assert.match(fulfillmentFocus, /due date, and this task prove commitment only/);
  assert.match(commercialSurface, /title="Going out"/);
  assert.match(commercialSurface, /title="Fulfilled"/);
});

test("scheduled fulfillment has specialized Worker Day Task Focus and canonical completion", () => {
  assert.match(canonical, /isFlowerFulfillmentTask/);
  assert.match(canonical, /FlowerFulfillmentTaskLoader/);
  assert.match(fulfillmentLoader, /flower-fulfillment-context/);
  assert.match(fulfillmentContext, /from\("flower_sale_orders"\)/);
  assert.match(fulfillmentContext, /from\("flower_sale_order_lines"\)/);
  assert.match(fulfillmentRoute, /record_flower_fulfillment_for_member_v1/);
  assert.match(fulfillmentRoute, /owner_operator_record_flower_fulfillment_v1/);
  assert.match(migration, /record_task_transition_v1_internal/i);
});

test("commercial writes are membership scoped with explicit authenticated registry entries", () => {
  for (const name of [
    "record_flower_sale_for_member_v1",
    "owner_operator_record_flower_sale_v1",
    "record_flower_fulfillment_for_member_v1",
    "owner_operator_record_flower_fulfillment_v1",
  ]) {
    assert.match(migration + ownerHardening + registry, new RegExp(name));
    assert.match(registry, new RegExp(name));
  }
  assert.match(registry, /app_endpoint/);
  assert.match(registry, /owner_admin_endpoint/);
  assert.doesNotMatch(commerceRoute + fulfillmentRoute, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  assert.match(ownerHardening, /v_context->>'farmId'/);
  assert.doesNotMatch(ownerHardening, /effective,farmId/);
});

test("Harvest surface extends truth chain after Ready without replacing Ready birth history", () => {
  assert.match(harvestedSurface, /FlowerCommercialSection/);
  for (const title of ["Available", "Record sale", "Going out", "Fulfilled"]) assert.match(commercialSurface, new RegExp(`title=\\"${title}\\"`));
  assert.match(commercialSurface, /Buyer outreach, quoted quantity, or a task note is not a sale/);
  assert.match(commercialSurface, /A due date is not fulfillment proof/);
});

test("commercial path does not revive unused stem-count custody engine", () => {
  for (const source of [migration, commerceRoute, fulfillmentContext, fulfillmentRoute, commercialSurface]) {
    assert.doesNotMatch(source, /production_harvest_lots|production_harvest_stand_entries|production_harvest_container_assignments|production_postharvest_gates|postharvest_containers|postharvest_container_events/);
  }
});
