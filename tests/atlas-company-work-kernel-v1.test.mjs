import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = "supabase/migrations/20260831004500_atlas_company_work_kernel_v1.sql";
const sql = readFileSync(join(root, migrationPath), "utf8");

function tableBody(name) {
  const pattern = new RegExp(`create table if not exists atlas\\.${name} \\(([\\s\\S]*?)\\n\\);`, "i");
  const match = sql.match(pattern);
  assert.ok(match, `missing ${name}`);
  return match[1];
}

test("company work kernel creates the seven clean-cut canonical primitives", () => {
  for (const table of [
    "work_requirements",
    "work_items",
    "work_requirement_links",
    "work_allocations",
    "work_item_relations",
    "work_time_contracts",
    "work_planning_conflicts",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists atlas\\.${table}\\b`, "i"));
  }
});

test("work identity is organization-owned and contains no assignee or presentation state", () => {
  const work = tableBody("work_items");
  assert.match(work, /organization_id uuid not null/i);
  assert.match(work, /work_state text not null default 'open'/i);
  assert.doesNotMatch(work, /assigned_user_id|assigned_membership_id|visibility_scope|parent_task_id|presentation|held|blocked/i);
});

test("unassigned work is structurally valid and assignment lives only in allocations", () => {
  const work = tableBody("work_items");
  const allocations = tableBody("work_allocations");

  assert.doesNotMatch(work, /assignee/i);
  assert.match(allocations, /work_item_id uuid not null references atlas\.work_items\(id\)/i);
  assert.match(allocations, /assignee_membership_id uuid not null references atlas\.organization_memberships\(id\)/i);
  assert.match(sql, /work_allocations_one_active_responsible_idx/i);
  assert.match(sql, /where state = 'active' and allocation_role = 'responsible'/i);
});

test("causal work relationships are explicit and cannot self-reference", () => {
  const relations = tableBody("work_item_relations");
  assert.match(relations, /relation_kind text not null/i);
  assert.match(relations, /'blocks','enables','depends_on','part_of','alternative_to','handoff_to'/i);
  assert.match(relations, /check \(from_work_item_id <> to_work_item_id\)/i);
});

test("time truth and planning conflict are separate from work lifecycle", () => {
  const work = tableBody("work_items");
  const time = tableBody("work_time_contracts");
  const conflicts = tableBody("work_planning_conflicts");

  assert.doesNotMatch(work, /hard_finish_at|expected_duration_minutes|conflict_kind/i);
  assert.match(time, /hard_finish_at timestamptz/i);
  assert.match(time, /expected_duration_minutes integer/i);
  assert.match(time, /movement_policy text not null default 'movable'/i);
  assert.match(conflicts, /'hard_boundary_unfit'/i);
  assert.match(conflicts, /state text not null default 'open'/i);
});

test("clean-cut migration does not backfill from or depend on legacy atlas.tasks", () => {
  assert.doesNotMatch(sql, /insert\s+into[\s\S]+select[\s\S]+from\s+atlas\.tasks/i);
  assert.doesNotMatch(sql, /references\s+atlas\.tasks/i);
  assert.match(sql, /does not backfill or depend on atlas\.tasks/i);
});

test("new kernel remains server-owned until canonical authorization APIs exist", () => {
  for (const table of [
    "work_requirements",
    "work_items",
    "work_requirement_links",
    "work_allocations",
    "work_item_relations",
    "work_time_contracts",
    "work_planning_conflicts",
  ]) {
    assert.match(sql, new RegExp(`revoke all on table atlas\\.${table} from anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on table atlas\\.${table} to service_role`, "i"));
  }
});
