import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260803040100_replace_generic_grow_room_pot_up_with_linked_schedule.sql",
    import.meta.url,
  ),
  "utf8",
);

test("the generic winter-greens pot-up card is retired as a changed plan", () => {
  assert.match(migration, /Grow Room — Pot Up Winter Greens \+ Scallions as Needed/);
  assert.match(migration, /'changed_plan'/);
  assert.match(migration, /delete from atlas\.grow_room_round_requests/);
  assert.match(migration, /generic_pot_up_replaced_by_schedule_key/);
});

test("the existing crop-linked 200-cell cards become one Grow Room sequence", () => {
  assert.match(migration, /crop_linked_200_cell_pot_up_schedule_20260810/);
  assert.match(migration, /grow_room_round_linked/);
  assert.match(migration, /grow_room_round_sequence_key/);
  assert.match(migration, /grow_room_round_sequence_order/);
  assert.match(migration, /planned_work_occurrences[\s\S]*task_payload/);
});

test("a linked sequence replaces the ordinary three-request slice for its farm day", () => {
  assert.match(migration, /linked as \(/);
  assert.match(migration, /where linked_sequence/);
  assert.match(migration, /ordinary_rank <= 3/);
  assert.match(migration, /not exists \(select 1 from linked\)/);
  assert.match(migration, /linkedSequenceTasksVisible/);
  assert.match(migration, /maximumOrdinaryRequests/);
});
