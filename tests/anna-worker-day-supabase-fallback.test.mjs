import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Supabase fallback keeps Worker Day truth in the delivery membrane", () => {
  const edge = read("supabase/functions/anna-worker-day/index.ts");

  assert.match(edge, /worker_week_projection/);
  assert.match(edge, /worker_week_projection_sources/);
  assert.match(edge, /worker_delivery_pilot_events/);
  assert.match(edge, /worker_delivery_pilot_active_attention/);
  assert.match(edge, /rollover_policy === "carry"/);
  assert.match(edge, /done_reported/);
  assert.match(edge, /not_delivered_today/);
  assert.doesNotMatch(edge, /\.update\([^)]*work_items|\.delete\([^)]*work_items/);
  assert.doesNotMatch(edge, /attention_events|execution_leases/);
});

test("fallback bearer authority is narrow, one-time, and fragment-friendly", () => {
  const edge = read("supabase/functions/anna-worker-day/index.ts");
  const shell = read("supabase/functions/anna-worker-day/static/index.html");

  assert.match(edge, /redeem_worker_delivery_pilot_capability_v1/);
  assert.match(edge, /worker_delivery_pilot_session_status_v1/);
  assert.match(edge, /authorization/);
  assert.match(edge, /Access-Control-Allow-Origin/);
  assert.match(edge, /https:\/\/raw\.githack\.com/);
  assert.match(shell, /#session=/);
  assert.match(shell, /kind==='edit'/);
  assert.match(shell, /authorization:'Bearer '/);
  assert.doesNotMatch(shell, /localStorage|sessionStorage/);
});

test("fallback phone shell preserves the quiet Worker Day experiment", () => {
  const shell = read("supabase/functions/anna-worker-day/static/index.html");

  assert.match(shell, /I finished it/);
  assert.match(shell, /I stopped working on it/);
  assert.match(shell, /Never mind — I’m still working on it/);
  assert.match(shell, /type="time"/);
  assert.match(shell, /\+ Add something I did/);
  assert.match(shell, /class="rail/);
  assert.doesNotMatch(shell, /elapsed|duration|hours worked|timesheet/i);
  assert.doesNotMatch(shell, /Monday, Sept|Tuesday, Sept|Friday, Sept/);
});
