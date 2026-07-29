import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("crop occupancy keeps cohorts, placements, cells, observations, and evidence separate", () => {
  const schema = read("supabase/migrations/20260729151500_crop_occupancy_schema_v1.sql");

  assert.match(schema, /create table if not exists atlas\.crop_placements/);
  assert.match(schema, /create table if not exists atlas\.crop_placement_cells/);
  assert.match(schema, /create table if not exists atlas\.crop_observations/);
  assert.match(schema, /create table if not exists atlas\.crop_occupancy_evidence/);
  assert.match(schema, /'full_rows','partial_rows','square_foot_block','individual_plants','edge_strip'/);
  assert.match(schema, /expected_quantity_kind text not null default 'unknown'/);
  assert.match(schema, /stand_percent numeric/);
  assert.match(schema, /coverage_fraction numeric/);
  assert.match(schema, /add column if not exists plants_per_sqft/);
});

test("existing Atlas data is backfilled without turning observation dates into planting dates", () => {
  const backfill = read("supabase/migrations/20260729151600_crop_occupancy_backfill_v1.sql");
  const dateFix = read("supabase/migrations/20260729151650_crop_occupancy_observed_date_fix_v1.sql");

  assert.match(backfill, /ensure_crop_cycle_for_content_v1/);
  assert.match(backfill, /backfill_crop_placement_v1/);
  assert.match(backfill, /backfill_crop_observation_v1/);
  assert.match(backfill, /rebuild_crop_occupancy_v1/);
  assert.match(backfill, /row_count/);
  assert.match(backfill, /placement_breakdown|distribution/);
  assert.match(backfill, /rows × row length ÷ in-row spacing/);
  assert.match(backfill, /square feet × plants per square foot/);
  assert.match(backfill, /crop_placement_cells/);
  assert.match(dateFix, /v_start_date := coalesce\(v_content\.planted_date,v_claim\.planted_date\)/);
  assert.doesNotMatch(dateFix, /v_start_date := coalesce\([^;]*v_observed_date/);
  assert.match(dateFix, /'first_observed_date',v_observed_date/);
});

test("one canonical reader groups cohorts by date, observation, perennial, or unknown", () => {
  const reader = read("supabase/migrations/20260729151700_crop_occupancy_reader_v1.sql");

  assert.match(reader, /object_crop_occupancy_v1/);
  assert.match(reader, /when ce\.is_perennial then 'perennial'/);
  assert.match(reader, /when ce\.establishment_date is not null then 'dated'/);
  assert.match(reader, /when ce\.first_observed_date is not null then 'observed'/);
  assert.match(reader, /else 'unknown'/);
  assert.match(reader, /expectedQuantityKind/);
  assert.match(reader, /observedQuantity/);
  assert.match(reader, /placementSummary/);
  assert.match(reader, /standPercent/);
  assert.match(reader, /'occupancyGroups'/);
});

test("haphazard owner notes have one idempotent structured ingestion contract", () => {
  const ingest = read("supabase/migrations/20260729151800_crop_occupancy_ingest_v1.sql");

  assert.match(ingest, /record_crop_occupancy_note_v1\(p_payload jsonb\)/);
  assert.match(ingest, /objectKey and cropLabel are required/);
  assert.match(ingest, /raw_note/);
  assert.match(ingest, /establishmentKind/);
  assert.match(ingest, /placementMode/);
  assert.match(ingest, /expectedQuantity/);
  assert.match(ingest, /observedQuantity/);
  assert.match(ingest, /idempotencyKey/);
  assert.match(ingest, /'unknowns',v_unknowns/);
  assert.match(ingest, /jsonb_typeof\(v_placement_payload->'cells'\)='array'/);
  assert.match(ingest, /Only the farm owner may record crop occupancy/);
});

test("the Weed Card presents farm facts without explanatory prose", () => {
  const component = read("components/atlas/crop-occupancy-list.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");

  assert.match(component, /group\.groupLabel/);
  assert.match(component, /cohort\.displayLabel/);
  assert.match(component, /cohort\.placementSummary/);
  assert.match(component, /~\$\{amount\} expected/);
  assert.match(component, /cohort\.stageLabel/);
  assert.match(focus, /moveDetails=\{<CropOccupancyList groups=\{card\.occupancyGroups\} \/>\}/);
  assert.doesNotMatch(component, /Plants in this bed|Keep|Protect|Current move|This means/);
});