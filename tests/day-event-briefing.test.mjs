import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260811185000_atlas_event_day_briefing_v1.sql");
const delivery = read("app/day/DayCueDelivery.tsx");

test("event briefing is derived from linked worker work rather than a copied task list", () => {
  assert.match(migration, /event_day_briefing_body_v1/);
  assert.match(migration, /project_task_links/);
  assert.match(migration, /assigned_membership_id=p_membership_id/);
  assert.match(migration, /visibility_scope='assigned_worker'/);
  assert.match(migration, /status in \('open','blocked'\)/);
  assert.match(migration, /Lebanon harvest this morning\. Elm setup afterward\./);
  assert.match(migration, /moves make tonight ready/);
});

test("first-open body recalculates from what remains whenever Day is read", () => {
  assert.match(migration, /dynamicProjectId/);
  assert.match(migration, /atlas\.event_day_briefing_body_v1/);
  assert.match(migration, /Everything assigned to you for tonight is already finished/);
  assert.match(migration, /Elm setup is what remains/);
  assert.match(delivery, /cueKind === "briefing"/);
});

test("the Bloom Bar briefing is short, first-open, and expires instead of becoming overdue", () => {
  assert.match(migration, /Tonight at Elm — Bouquet Bar/);
  assert.match(migration, /'first_open'/);
  assert.match(migration, /'actionLabel','Start today'/);
  assert.match(migration, /'expire'/);
  assert.match(migration, /America\/Chicago/);
  assert.doesNotMatch(migration, /overdue/i);
});
