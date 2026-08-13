import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
const editor = read("components/atlas/owner-day-cue-editor.tsx");
const projection = read("components/atlas/owner-interleaved-day-projection.tsx");
const route = read("app/api/atlas/owner-day-cue/route.ts");
const migration = read("supabase/migrations/20260813160500_timed_day_cue_guard_v1.sql");

test("Pick a time exposes an Elm Farm clock input and persists scheduledAt", () => {
  assert.match(editor, /data-owner-day-cue-time-picker="true"/);
  assert.match(editor, /type="time"/);
  assert.match(editor, /Time · Elm Farm/);
  assert.match(editor, /scheduledAtForFarmTime/);
  assert.match(editor, /America\/Chicago/);
  assert.match(editor, /scheduledAt,/);
  assert.match(editor, /Pick a time for this cue\./);
});

test("timed cues show the saved farm-local time and refresh their rail position after save", () => {
  assert.match(editor, /farmTimeLabel\(cue\.scheduledAt\)/);
  assert.match(editor, /atlas-owner-day-sequence-refresh/);
  assert.match(projection, /atlas-owner-day-sequence-refresh/);
  assert.match(projection, /setSequenceVersion/);
  assert.match(projection, /data-cue-id=/);
});

test("the cue API rejects missing or cross-service-day timestamps", () => {
  assert.match(route, /owner_day_cue_time_required/);
  assert.match(route, /farmDateForInstant/);
  assert.match(route, /America\/Chicago/);
  assert.match(route, /owner_day_cue_service_day_mismatch/);
});

test("database guards make at_time-without-time impossible for new or edited cues", () => {
  assert.match(migration, /worker_day_cues_timed_requires_time_ck/);
  assert.match(migration, /anchor_kind <> 'at_time' or scheduled_at is not null/);
  assert.match(migration, /worker_day_cues_timed_service_day_ck/);
  assert.match(migration, /scheduled_at at time zone 'America\/Chicago'/);
  assert.match(migration, /not valid/);
});
