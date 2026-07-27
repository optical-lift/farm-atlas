import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/grow-room/page.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/atlas/grow-room/route.ts", import.meta.url), "utf8");
const roundApi = readFileSync(new URL("../app/api/atlas/grow-room/round/route.ts", import.meta.url), "utf8");
const contract = readFileSync(new URL("../lib/atlas/grow-room.ts", import.meta.url), "utf8");
const roomMigration = readFileSync(new URL("../supabase/migrations/20260727193000_trail_foundation_grow_room_v1.sql", import.meta.url), "utf8");
const roundMigration = readFileSync(new URL("../supabase/migrations/20260727213000_grow_room_focused_round_v1.sql", import.meta.url), "utf8");
const feedMigration = readFileSync(new URL("../supabase/migrations/20260727194500_home_task_cards_hide_grow_room_internal_v2.sql", import.meta.url), "utf8");
const homeApi = readFileSync(new URL("../app/api/atlas/home-task-cards/route.ts", import.meta.url), "utf8");
const focusLayout = readFileSync(new URL("../app/task-focus/[taskId]/layout.tsx", import.meta.url), "utf8");

test("Grow Room keeps its evidence-backed physical and biological foundation", () => {
  assert.match(roomMigration, /create table if not exists atlas\.growing_object_relationships/);
  assert.match(roomMigration, /create table if not exists atlas\.production_tray_batch_locations/);
  assert.match(roomMigration, /create or replace function atlas\.grow_room_state_v1/);
  assert.match(roomMigration, /create or replace function atlas\.grow_room_record_batch_action_v1/);
  assert.match(roomMigration, /tray_batch_id uuid references atlas\.production_tray_batches/);
  assert.match(contract, /Sown/);
  assert.match(contract, /Germinating/);
  assert.match(contract, /Live stand/);
  assert.match(contract, /Established/);
});

test("routine watering remains absent from worker evidence", () => {
  assert.match(api, /Routine Grow Room watering is an automatic habit and is not logged in Atlas/);
  assert.match(roomMigration, /Routine Grow Room watering is a habit and is not recorded as a Trail action/);
  assert.match(roundMigration, /ordinary_care_not_logged/);
  assert.match(roundMigration, /watering_logged', false/);
  assert.doesNotMatch(page, />Watered</);
  assert.doesNotMatch(page, /water|watering/i);
});

test("Grow Room Care opens the exact focused daily round", () => {
  assert.match(focusLayout, /visitTaskId=/);
  assert.match(focusLayout, /encodeURIComponent\(taskId\)/);
  assert.match(roundApi, /grow_room_round_v1/);
  assert.match(page, /Grow Room Care/);
  assert.match(page, /Finish Grow Room round/);
});

test("generic work feeds keep one Grow Room doorway instead of room-task clutter", () => {
  assert.match(feedMigration, /home_task_cards_v2/);
  assert.match(feedMigration, /one Grow Room doorway/i);
  assert.match(homeApi, /supabase\.rpc\("home_task_cards_v2"/);
  assert.match(focusLayout, /redirect\(`\/grow-room\?visitTaskId=/);
});

test("only explicit current requests appear on the worker surface", () => {
  assert.match(roundMigration, /limit 3/);
  assert.match(roundMigration, /coalesce\(t\.due_date, v_visit\.due_date\) <=/);
  assert.match(page, /Count what is alive/);
  assert.match(page, /Record live count/);
  assert.match(page, /No germination/);
  assert.match(page, /Not ready yet/);
  assert.doesNotMatch(page, /Room intake|Set up racks|Shelves and live batches|live batches|action steps|Establish real truth/i);
});
