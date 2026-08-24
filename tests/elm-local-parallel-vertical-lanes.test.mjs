import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260824032024_search_discovery_parallel_vertical_lanes_v1.sql';
const routePath = 'app/api/atlas/elm-local-discovery/route.ts';

test('Elm Local discovery has nine mutually exclusive vertical lanes', () => {
  const migration = read(migrationPath);
  for (const lane of [
    'healthcare_social_assistance',
    'education',
    'government_public_utilities',
    'finance_insurance',
    'manufacturing_distribution_construction',
    'nonprofit_religious_community',
    'tourism_hospitality_events',
    'professional_business_services',
    'retail_consumer_large_employers',
  ]) assert.match(migration, new RegExp(lane));
  assert.match(migration, /exclusive_primary_organization_vertical/);
  assert.match(migration, /exclude_primary_verticals/);
  assert.match(migration, /search_discovery_vertical_lanes/);
});

test('vertical lanes claim concurrently without weakening custody', () => {
  const migration = read(migrationPath);
  assert.match(migration, /claim_search_discovery_lane_v1/);
  assert.match(migration, /finish_search_discovery_lane_v1/);
  assert.match(migration, /requeue_search_discovery_lane_v1/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table local_intel\.search_discovery_vertical_lanes from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function local_intel\.claim_search_discovery_lane_v1\(uuid,\s*text\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon|authenticated)/i);
});

test('24-hour throughput envelope is explicit and bounded', () => {
  const migration = read(migrationPath);
  assert.match(migration, /'target_completion_hours',24/);
  assert.match(migration, /'discovery_batch_size',100/);
  assert.match(migration, /'maximum_discovery_batch_size',250/);
  assert.match(migration, /'subject_source_limit',4/);
  assert.match(migration, /'discovery_lane_workers',9/);
  assert.match(migration, /'subject_workers',12/);
});

test('executor separates discovery and subject work modes', () => {
  const route = read(routePath);
  assert.match(route, /const DEFAULT_BATCH_SIZE = 100/);
  assert.match(route, /const MAX_BATCH_SIZE = 250/);
  assert.match(route, /const SUBJECT_SOURCE_LIMIT = 4/);
  assert.match(route, /WORK_MODES/);
  assert.match(route, /claim_search_discovery_lane_v1/);
  assert.match(route, /finish_search_discovery_lane_v1/);
  assert.match(route, /requeue_search_discovery_lane_v1/);
  assert.doesNotMatch(route, /claim_search_discovery_batch_v1/);
  assert.match(route, /laneKey/);
  assert.match(route, /workMode/);
  assert.match(route, /lane_batch_complete/);
  assert.match(route, /max_output_tokens: 30000/);
});

test('vertical gatherer remains evidence-only and lane-exclusive', () => {
  const route = read(routePath);
  assert.match(route, /Stay inside this lane's exclusive primary organization vertical/);
  assert.match(route, /Prefer high-yield official directories/);
  assert.match(route, /Never infer, construct, guess, complete, or pattern-generate a missing value/);
  assert.match(route, /gateway_citation_verified: true/);
  assert.match(route, /vercel_ai_gateway_vertical_lane_v1/);
});
