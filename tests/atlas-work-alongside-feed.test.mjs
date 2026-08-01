import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("work-alongside windows preserve assignment and extend only the Owner feed", () => {
  const migration = read("supabase/migrations/20260801022000_atlas_work_alongside_feed_v1.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS atlas\.work_alongside_windows/);
  assert.match(migration, /observer_membership_id/);
  assert.match(migration, /teammate_membership_id/);
  assert.match(migration, /task\.assigned_membership_id/);
  assert.match(migration, /task\.due_date BETWEEN alongside_window\.starts_on AND alongside_window\.ends_on/);
  assert.match(migration, /v_role = 'owner'/);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+atlas\.tasks(?:\s+\w+)?\s+SET\s+assigned_membership_id\s*=/i,
  );
});

test("only work-alongside teammate cards receive executor badges", () => {
  const migration = read("supabase/migrations/20260801022000_atlas_work_alongside_feed_v1.sql");
  const overlay = read("components/atlas/work-alongside/AtlasWorkAlongsideOverlay.tsx");
  const css = read("app/work-alongside.css");

  assert.match(migration, /executor_membership_id/);
  assert.match(migration, /executor_worker_key/);
  assert.match(migration, /executor_label/);
  assert.match(overlay, /executorMembershipId === viewerMembershipId/);
  assert.match(overlay, /clearAssigneeIdentity\(target, entry\)/);
  assert.doesNotMatch(overlay, /ownTask\s*\?\s*["']You["']/);
  assert.match(css, /content: attr\(data-atlas-assignee-label\)/);
  assert.match(css, /data-atlas-assignee-key="marshall"/);
  assert.match(css, /data-atlas-assignee-key="anna"/);
  assert.doesNotMatch(css, /data-atlas-assignee-key="viewer"/);
});

test("Owner manages reusable visit windows from More instead of the Work trail", () => {
  const route = read("app/api/atlas/work-alongside/route.ts");
  const overlay = read("components/atlas/work-alongside/AtlasWorkAlongsideOverlay.tsx");
  const morePage = read("app/more/page.tsx");
  const layout = read("app/layout.tsx");

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /membership\.role === "owner"/);
  assert.match(overlay, /pathname === "\/more"/);
  assert.match(overlay, /createPortal/);
  assert.match(overlay, /Add to my Work feed/);
  assert.match(morePage, /atlas-more-work-alongside-slot/);
  assert.doesNotMatch(overlay, /atlas-work-alongside-toggle/);
  assert.match(layout, /AtlasWorkAlongsideOverlay/);
  assert.match(layout, /work-alongside\.css/);
});
