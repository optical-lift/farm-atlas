import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");
const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/atlas/maintenance-directive-composer.tsx", import.meta.url), "utf8");
const strip = readFileSync(new URL("../components/atlas/maintenance-directive-strip.tsx", import.meta.url), "utf8");
const objectPage = readFileSync(new URL("../app/objects/[objectKey]/page.tsx", import.meta.url), "utf8");
const weedCard = readFileSync(new URL("../components/atlas/weed-card-task-focus.tsx", import.meta.url), "utf8");
const mowingCard = readFileSync(new URL("../app/task-focus/[taskId]/MowingFocusPage.tsx", import.meta.url), "utf8");

const migrations = `${core}\n${authoring}\n${completion}`;

test("maintenance directives attach to persistent card identity instead of rival maintenance tasks", () => {
  assert.match(core, /maintenance_kind text not null check \(maintenance_kind in \('weed','mow'\)\)/);
  assert.match(core, /weed_card_id uuid references atlas\.weed_cards/);
  assert.match(core, /rhythm_state_id uuid references atlas\.rhythm_state/);
  assert.match(authoring, /ensure_weed_card_for_object_v1\(v_object\.id, null\)/);
  assert.match(authoring, /ensure_rhythm_task_v1\(v_rhythm_state\.id, 'due', v_due_at\)/);
  assert.match(authoring, /manual_directive_brought_forward/);
  assert.doesNotMatch(authoring, /title[^\n]*btrim\(p_title\)[\s\S]{0,260}'weed'[^\n]*'maintenance'/i);
});

test("instruction effect policy preserves physical-result truth", () => {
  assert.match(core, /bring_forward_only/);
  assert.match(core, /target_condition/);
  assert.match(core, /full_maintenance/);
  assert.match(core, /inspection_only/);
  assert.match(completion, /p_result_value='clear'/);
  assert.match(completion, /p_result_value='mowed_full'/);
  assert.match(completion, /weed_condition_rank_v1\(p_result_value\)/);
  assert.match(completion, /after insert on atlas\.weed_sessions/);
  assert.match(completion, /after insert on atlas\.mowing_events/);
});

test("prerequisites block and then return the same perpetual card", () => {
  assert.match(authoring, /maintenance_prerequisite_task_id/);
  assert.match(authoring, /set status = 'blocked'/);
  assert.match(completion, /release_maintenance_prerequisite_v1/);
  assert.match(completion, /set status='open', blocker_text=null/);
  assert.match(completion, /prerequisite_task_id=new\.id/);
});

test("object composer uses sentence pills, real crops, assignees, dates, windows, and checklist steps", () => {
  assert.match(objectPage, /MaintenanceDirectiveComposer/);
  assert.match(composer, /className=\{styles\.sentence\}/);
  assert.match(composer, /cardName} · \{context\.object\.label/);
  assert.match(composer, /Attach crop cycles/);
  assert.match(composer, /assignedMembershipId/);
  assert.match(composer, /workWindowKey/);
  assert.match(composer, /Checklist/);
  assert.match(authoring, /maintenance_directive_crop_cycles/);
  assert.match(authoring, /task_crop_cycles/);
  assert.match(authoring, /maintenance_directive_steps/);
});

test("temporary instructions appear inside Weed and Mowing result cards", () => {
  assert.match(weedCard, /MaintenanceDirectiveStrip taskId=\{task\.task_id\}/);
  assert.match(mowingCard, /MaintenanceDirectiveStrip taskId=\{task\.id\}/);
  assert.match(strip, /Owner instruction/);
  assert.match(strip, /Waiting for prerequisite/);
  assert.match(strip, /setAtlasMaintenanceDirectiveStep/);
  assert.match(strip, /does not automatically reset the normal maintenance clock/);
});

test("manual maintenance work receives lockscreen timing and stays out of Bell history", () => {
  assert.match(authoring, /task_notification_plans/);
  assert.match(authoring, /release_local_time/);
  assert.match(authoring, /close_local_time/);
  assert.match(authoring, /source, active, metadata/);
  assert.doesNotMatch(migrations, /bell_event_receipts|journal_event_index|notification_outbox/);
});

test("directive tables are private and app endpoints are governed", () => {
  assert.match(core, /revoke all on table atlas\.maintenance_directives from public, anon, authenticated/);
  assert.match(completion, /grant execute on function atlas\.maintenance_directive_context_v1\(uuid,text\) to authenticated, service_role/);
  assert.match(completion, /grant execute on function atlas\.create_object_maintenance_directive_v1/);
  assert.match(completion, /atlas\.authenticated_rpc_registry/);
  assert.match(completion, /owner_admin_endpoint/);
  assert.doesNotMatch(migrations, /grant execute[^\n]+to anon/i);
  assert.doesNotMatch(migrations, /buyer|titus|draft_/i);
});
