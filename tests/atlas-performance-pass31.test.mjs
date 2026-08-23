import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260814155500_atlas_interactive_read_performance_v1.sql", import.meta.url),
  "utf8",
);
const datedRoute = readFileSync(
  new URL("../app/api/atlas/universal-task-cards/route.ts", import.meta.url),
  "utf8",
);

test("Pass 31 bounds rich task-card hydration to already-selected task ids", () => {
  assert.match(migration, /function atlas\.task_card_for_id_v1\(p_task_id uuid\)/i);
  assert.match(migration, /where card\.task_id = p_task_id/i);
  assert.match(migration, /cross join lateral atlas\.task_card_for_id_v1\(selected\.task_id\) card/i);
  assert.match(migration, /home_task_cards_for_membership_v2 hydration contract changed/i);
  assert.match(migration, /revoke all on function atlas\.task_card_for_id_v1\(uuid\) from public, anon, authenticated/i);
});

test("the card optimization changes hydration only, not Day membership selection truth", () => {
  assert.doesNotMatch(migration, /update\s+atlas\.tasks|insert\s+into\s+atlas\.tasks|delete\s+from\s+atlas\.tasks/i);
  assert.doesNotMatch(migration, /presented_work_rows_v1\s*\([^)]*\)\s*(?:=|:)/i);
  assert.match(migration, /replace\(v_definition, v_old_fragment, v_new_fragment\)/i);
});

test("notification dispatch stays five-minute compatible while schedule rebuilding becomes change-aware", () => {
  assert.match(migration, /v_candidate_updated_at > v_schedule_updated_at/i);
  assert.match(migration, /interval '30 minutes'/i);
  assert.match(migration, /dispatch_task_notification_moments_v1\(v_as_of, 500\)/i);
  assert.match(migration, /scheduleDaysChecked/i);
  assert.doesNotMatch(migration, /cron\.schedule|cron\.unschedule/i);
});

test("notification refresh probe is supported without replacing notification truth", () => {
  assert.match(migration, /task_notification_moments_farm_day_refresh_idx/i);
  assert.match(migration, /ensure_task_notification_moments_v1/i);
  assert.match(migration, /refresh_task_notification_day_plan_v1/i);
  assert.doesNotMatch(migration, /delete\s+from\s+atlas\.task_notification_moments/i);
});

test("operating on a farm reads that worker's canonical cards without paying the Universal Home wrapper", () => {
  assert.match(datedRoute, /operatorContext\?\.isOperating/);
  assert.match(datedRoute, /effective\?\.scopeKind === "farm"/);
  assert.match(datedRoute, /owner_operator_home_task_cards_v1/);
  assert.match(datedRoute, /withFarmScopeMetadata\(card, effective\.farmId/);
  assert.match(datedRoute, /task_scope: "farm_operation"/);
  assert.match(datedRoute, /hasOrganizationScope: false/);
  assert.match(datedRoute, /else \{\s*const home = await readAtlasOperatorUniversalHome/s);
});

test("the operator fast path rejoins the same Day placement, privacy, and Move-context pipeline", () => {
  assert.match(datedRoute, /readAtlasTaskDayDispositions/);
  assert.match(datedRoute, /worker_day_choreography_api_v1/);
  assert.match(datedRoute, /worker_day_placed_task_cards_v1/);
  assert.match(datedRoute, /farmHandMoveContext/);
  assert.match(datedRoute, /readAtlasTaskMoveContexts\(baseTaskCards\.map/);
  assert.match(datedRoute, /X-Atlas-Read-Path": "universal-dated-task-cards-v6-operator-direct"/);
  assert.doesNotMatch(datedRoute, /service[_-]?role/i);
});
