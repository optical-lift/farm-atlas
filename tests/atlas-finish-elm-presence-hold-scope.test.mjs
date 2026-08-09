import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260809032000_scope_finish_elm_presence_hold_to_owner_and_marshall.sql", import.meta.url),
  "utf8",
);

test("Finish Elm off-site hold is scoped to Owner and Marshall rather than Anna's assigned work", () => {
  assert.match(migration, /'presence_hold_contract','assignee_scoped_v1'/);
  assert.match(migration, /'offsite_hold_scope',jsonb_build_array\('owner','marshall'\)/);
  assert.match(migration, /'farm_hand_assigned_work_continues',true/);
  assert.match(migration, /v_membership\.role='farm_hand'/);
  assert.match(migration, /item\.preferred_membership_id=p_membership_id/);
});

test("disabled Finish Elm project can still plan explicitly assigned farm-hand items only", () => {
  assert.match(migration, /not v_project_enabled\s+and v_membership\.role='farm_hand'/);
  assert.match(migration, /v_project_enabled or item\.preferred_membership_id=p_membership_id/);
  assert.match(migration, /Assigned farm-hand Finish \+ Renovation work · Owner\/Marshall presence hold does not apply/);
});

test("Owner and Marshall remain held while the project-level release switch is off", () => {
  assert.match(migration, /if not v_project_enabled and not v_member_assigned_bypass then/);
  assert.match(migration, /'state','project_presence_hold'/);
  assert.doesNotMatch(migration, /v_membership\.role in \('owner','farm_hand'\)/);
});

test("the scoped bypass does not make unassigned project work eligible during the hold", () => {
  const matches = migration.match(/\(v_project_enabled or item\.preferred_membership_id=p_membership_id\)/g) ?? [];
  assert.ok(matches.length >= 2);
  assert.doesNotMatch(migration, /v_project_enabled or item\.preferred_membership_id is null/);
});
