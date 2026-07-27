import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/grow-room/page.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/atlas/grow-room/route.ts", import.meta.url), "utf8");
const contract = readFileSync(new URL("../lib/atlas/grow-room.ts", import.meta.url), "utf8");
const roomMigration = readFileSync(new URL("../supabase/migrations/20260727193000_trail_foundation_grow_room_v1.sql", import.meta.url), "utf8");
const feedMigration = readFileSync(new URL("../supabase/migrations/20260727194500_home_task_cards_hide_grow_room_internal_v2.sql", import.meta.url), "utf8");
const homeApi = readFileSync(new URL("../app/api/atlas/home-task-cards/route.ts", import.meta.url), "utf8");
const focusLayout = readFileSync(new URL("../app/task-focus/[taskId]/layout.tsx", import.meta.url), "utf8");

test("Grow Room is a prepared physical room with living batch locations", () => {
  assert.match(roomMigration, /create table if not exists atlas\.growing_object_relationships/);
  assert.match(roomMigration, /create table if not exists atlas\.production_tray_batch_locations/);
  assert.match(roomMigration, /create or replace function atlas\.grow_room_state_v1/);
  assert.match(roomMigration, /create or replace function atlas\.grow_room_record_batch_action_v1/);
  assert.match(roomMigration, /tray_batch_id uuid references atlas\.production_tray_batches/);
});

test("routine watering is deliberately not a Grow Room result", () => {
  assert.match(api, /Routine Grow Room watering is an automatic habit and is not logged in Atlas/);
  assert.match(roomMigration, /Routine Grow Room watering is a habit and is not recorded as a Trail action/);
  assert.match(roomMigration, /lower\(p_action_key\) in \('water', 'watered', 'watering', 'moisture_check'\)/);
  assert.doesNotMatch(page, />Watered</);
  assert.doesNotMatch(page, /recordAction\(batch, "water"/);
});

test("the digital room exposes a green biological Trail and action-bearing moves", () => {
  assert.match(page, /Preserve the green Trail/);
  assert.match(page, /Room actions/);
  assert.match(page, /Shelves and live batches/);
  assert.match(page, /Record live stand/);
  assert.match(page, /Needs pot-up/);
  assert.match(page, /Start hardening/);
  assert.match(page, /Ready to plant/);
  assert.match(contract, /Sown/);
  assert.match(contract, /Germinating/);
  assert.match(contract, /Live stand/);
  assert.match(contract, /Plant out/);
  assert.match(contract, /Established/);
  assert.match(contract, /Harvest/);
});

test("generic work feeds keep one Grow Room doorway instead of room-task clutter", () => {
  assert.match(feedMigration, /home_task_cards_v2/);
  assert.match(feedMigration, /one Grow Room doorway/i);
  assert.match(homeApi, /supabase\.rpc\("home_task_cards_v2"/);
  assert.match(focusLayout, /redirect\("\/grow-room"\)/);
});

test("planned starts do not masquerade as living tray inventory", () => {
  assert.match(page, /No verified tray batches are entered yet/);
  assert.match(page, /Planned sowings do not count as living plants/);
});
