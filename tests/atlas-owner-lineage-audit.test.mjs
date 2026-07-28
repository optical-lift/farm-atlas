import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("owner lineage audit is organization-owner scoped on page API and database", () => {
  const page = read("app/owner/lineage/page.tsx");
  const route = read("app/api/atlas/owner/lineage/route.ts");
  const migration = read("supabase/migrations/20260729030500_owner_trail_lineage_audit_v1.sql");

  assert.match(page, /atlasPortalViewerFromSession/);
  assert.match(page, /viewer\.canManagePortfolio/);
  assert.match(route, /!viewer \|\| !viewer\.canManagePortfolio/);
  assert.match(migration, /atlas\.is_organization_owner\(p_organization_id\)/);
  assert.match(migration, /atlas\.is_organization_owner\(v_binding\.organization_id\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, atlas/);
});

test("passive lineage reads never queue or confirm history", () => {
  const reader = read("lib/atlas/lineage-audit.ts");
  const route = read("app/api/atlas/owner/lineage/route.ts");
  const migration = read("supabase/migrations/20260729030500_owner_trail_lineage_audit_v1.sql");

  assert.match(reader, /owner_trail_lineage_audit_v1/);
  assert.doesNotMatch(reader, /queue_trail_lineage_candidates_v1/);
  assert.doesNotMatch(reader, /review_trail_evidence_v1/);
  assert.match(route, /body\.action === "scan"/);
  assert.match(route, /body\.action === "review"/);
  assert.match(migration, /Explicit owner-triggered scan/);
  assert.match(migration, /passive reads never write/);
});

test("candidate scan is limited to completed linked project records", () => {
  const migration = read("supabase/migrations/20260729030500_owner_trail_lineage_audit_v1.sql");

  assert.match(migration, /join atlas\.project_steps ps/);
  assert.match(migration, /ps\.linked_task_id is not null/);
  assert.match(migration, /t\.completed_at is not null or ps\.completed_at is not null/);
  assert.match(migration, /explicit project-step Trail node/);
  assert.match(migration, /legacy project-step order match/);
  assert.match(migration, /evidence_status[\s\S]*'pending'/);
  assert.match(migration, /on conflict \(trail_binding_id, node_key, source_type, source_id\) do nothing/);
  assert.doesNotMatch(migration, /lower\(t\.title\).*similarity/);
});

test("owner confirmation records provenance and advances only a safe current node", () => {
  const migration = read("supabase/migrations/20260729030500_owner_trail_lineage_audit_v1.sql");

  assert.match(migration, /review_decision/);
  assert.match(migration, /review_note/);
  assert.match(migration, /confirmed_by_user_id = auth\.uid\(\)/);
  assert.match(migration, /v_binding\.current_node_key = v_evidence\.node_key/);
  assert.match(migration, /release_status = 'active'/);
  assert.match(migration, /if v_active_release_count = 0 then/);
  assert.match(migration, /last_advance_source_evidence_id/);
  assert.match(migration, /last_advance_source', 'owner_lineage_review'/);
});

test("interface keeps unresolved history honest and supports explicit review", () => {
  const client = read("app/owner/lineage/AtlasLineageAuditClient.tsx");
  const css = read("app/owner/lineage/lineage-audit.module.css");

  assert.match(client, /Connect old records without inventing history/);
  assert.match(client, /Scan completed project records/);
  assert.match(client, /Confirm evidence/);
  assert.match(client, /Reject match/);
  assert.match(client, /Unresolved Earlier Nodes/);
  assert.match(client, /Atlas leaves them open rather than filling them from later work/);
  assert.match(client, /Candidate rejected and will not be suggested again/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.doesNotMatch(client, /supabase/);
});
