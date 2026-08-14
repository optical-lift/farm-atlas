import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260814060300_atlas_day_reservations_v1.sql");
const reservationContract = read("lib/atlas/day-reservations.ts");
const reservationServer = read("lib/atlas/day-reservations-server.ts");
const choreographyServer = read("lib/atlas/day-choreography-server.ts");
const projection = read("lib/atlas/day-projection.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const clockReservations = read("lib/atlas/clock-reservations.ts");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const reservationBlock = read("components/atlas/clock/ClockReservationBlock.tsx");
const planningTimeline = read("components/atlas/clock/clock-planning-timeline.tsx");

test("Pass 20 creates one exact-time non-task reservation primitive instead of overloading absence or cues", () => {
  assert.match(migration, /create table atlas\.day_reservations/);
  assert.match(migration, /kind in \('routine', 'meal', 'external_commitment'\)/);
  assert.match(migration, /starts_at timestamptz not null/);
  assert.match(migration, /ends_at timestamptz not null/);
  assert.match(migration, /ends_at > starts_at/);
  assert.match(migration, /Whole-day absence remains in member_unavailability/);
  assert.doesNotMatch(migration, /alter table atlas\.member_unavailability/);
  assert.doesNotMatch(migration, /alter table atlas\.worker_day_cues/);
});

test("reservation reads are scoped by farm, membership, service day, and active state", () => {
  assert.match(reservationServer, /\.from\("day_reservations"\)/);
  assert.match(reservationServer, /\.eq\("farm_id", input\.farmId\)/);
  assert.match(reservationServer, /\.eq\("membership_id", input\.membershipId\)/);
  assert.match(reservationServer, /\.eq\("service_date", input\.serviceDate\)/);
  assert.match(reservationServer, /\.eq\("active", true\)/);
  assert.match(migration, /day_reservations_read_authorized/);
  assert.match(migration, /membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /atlas\.can_read_farm_operations\(farm_id\)/);
  assert.doesNotMatch(migration, /grant insert on atlas\.day_reservations to authenticated/i);
  assert.doesNotMatch(migration, /grant update on atlas\.day_reservations to authenticated/i);
});

test("the shared Day choreography read carries reservations into the server projection for both roles", () => {
  assert.match(choreographyServer, /readAtlasDayReservations/);
  assert.match(choreographyServer, /farmId: target\.farmId/);
  assert.match(choreographyServer, /membershipId: target\.membershipId/);
  assert.match(choreographyServer, /serviceDate: dateIso/);
  assert.match(choreographyServer, /reservations,/);
  assert.match(sequenceServer, /reservations: sameTarget \? choreographyResult\.reservations : \[\]/);
  assert.match(sequenceServer, /buildAtlasWorkerDayProjection/);
  assert.match(projectionClient, /projection: body\.projection/);
  assert.doesNotMatch(projectionClient, /AtlasDayReservation|choreographyBody\.reservations/);
});

test("real-day reservations are projection state and participate in deterministic revisioning", () => {
  assert.match(reservationContract, /AtlasDayReservationKind = "routine" \| "meal" \| "external_commitment"/);
  assert.match(projection, /reservations: AtlasDayReservation\[\]/);
  assert.match(projection, /projectionFingerprint\(\{ identity, sequence: input\.sequence, reservations \}\)/);
  assert.doesNotMatch(reservationContract, /taskId|task_id|due_date|status/);
  assert.doesNotMatch(reservationServer, /tasks|task_transition|record_task_transition/);
});

test("Clock consumes projection reservations as blocking spans without converting them into work", () => {
  assert.match(clockReservations, /"timed_cue" \| "routine" \| "meal" \| "external_commitment"/);
  assert.match(orchestrator, /projection\?\.reservations\?\?\[\]/);
  assert.match(orchestrator, /source:reservation\.kind/);
  assert.match(orchestrator, /buildAtlasClockReservations\(\{timedCues,commitments,timeZone:DEFAULT_ATLAS_FARM_TIME_ZONE\}\)/);
  assert.match(orchestrator, /buildAtlasClockProposal\(committed,\{reservations:dayReservations\}\)/);
  assert.match(timeline, /ClockReservationBlock/);
  assert.match(reservationBlock, /data-clock-non-task="true"/);
  assert.match(planningTimeline, /ClockReservationBlock/);
  assert.match(reservationBlock, /data-clock-reservation-source=\{reservation\.source\}/);
  assert.doesNotMatch(clockReservations, /committed_task/);
});
