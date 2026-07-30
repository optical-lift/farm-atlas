import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260730134847_bell_and_while_away_foundation_v1.sql");
const contract = read("lib/atlas/bell-contract.ts");
const client = read("lib/atlas/bell-client.ts");
const route = read("app/api/atlas/bell/route.ts");
const cover = read("components/atlas/home/AtlasBellCover.tsx");
const page = read("app/bell/page.tsx");
const css = read("app/bell.css");
const home = read("app/page.tsx");
const layout = read("app/layout.tsx");

const ui = `${cover}\n${page}\n${css}\n${home}\n${layout}`;

test("Bell receipts never become a second Journal truth", () => {
  assert.match(migration, /references atlas\.journal_event_index\(id\)/);
  assert.match(migration, /Per-player read and acknowledgement state/);
  assert.match(migration, /eventTruth', 'journal_event_index'/);
  assert.match(migration, /receiptTruth', 'bell_event_receipts'/);
  assert.doesNotMatch(migration, /create table if not exists atlas\.bell_events/);
  assert.doesNotMatch(migration, /insert into atlas\.journal_event_index/);
});

test("Bell reads are farm, role, assignment, project, and operator scoped", () => {
  assert.match(migration, /bell_effective_member_v1/);
  assert.match(migration, /Owner membership is required to operate another farm account/);
  assert.match(migration, /when 'owner' then v_role = 'owner'/);
  assert.match(migration, /when 'management' then v_role in \('owner', 'manager'\)/);
  assert.match(migration, /v_event\.assigned_user_id = v_user_id/);
  assert.match(migration, /atlas\.project_contributors/);
  assert.match(route, /operatorContext\.effective\.farmMembershipId/);
});

test("badge count follows unresolved player obligations rather than all open tasks", () => {
  assert.match(migration, /bell_event_requires_action_v1/);
  assert.match(migration, /'due', 'fallen_out_of_rhythm', 'recovering'/);
  assert.match(migration, /receipt\.acknowledged_at is null/);
  assert.match(contract, /badgeCount: number/);
  assert.doesNotMatch(migration, /count\(\*\).*from atlas\.tasks[\s\S]*badge_count/i);
});

test("while-away uses a durable per-player visit boundary", () => {
  assert.match(migration, /create table if not exists atlas\.bell_visit_state/);
  assert.match(migration, /previous_visited_at/);
  assert.match(migration, /last_visited_at/);
  assert.match(migration, /record_bell_visit_v1/);
  assert.match(migration, /event\.occurred_at > v_since_at/);
  assert.match(client, /action: "visit"/);
  assert.match(cover, /While you were away/);
});

test("Bell entries carry safe canonical deep links and acknowledgement state", () => {
  assert.match(migration, /bell_event_deep_link_v1/);
  assert.match(migration, /\/task-focus\//);
  assert.match(migration, /\/project\//);
  assert.match(migration, /\/objects\//);
  assert.match(migration, /\/journal\?date=/);
  assert.match(migration, /mark_bell_event_v1/);
  assert.match(migration, /p_action not in \('read', 'acknowledge'\)/);
  assert.match(page, /Acknowledge/);
});

test("the journal cover and Bell history expose the new loop without replacing Home", () => {
  assert.match(home, /<AtlasUniversalHome/);
  assert.match(home, /<AtlasBellCover/);
  assert.match(cover, /atlas-bell-edge-tab/);
  assert.match(cover, /atlas-while-away-slip/);
  assert.match(page, /Bell history/);
  assert.match(page, /Farm Journal/);
  assert.match(layout, /import "\.\/bell\.css"/);
  assert.match(css, /\.atlas-bell-cover/);
  assert.match(css, /\.atlas-bell-item/);
});

test("Build 8 remains in-app and does not pretend Web Push or PWA delivery exists", () => {
  assert.doesNotMatch(migration, /push_subscription|service_worker|web_push/i);
  assert.doesNotMatch(ui, /Notification\.requestPermission|navigator\.serviceWorker|PushManager/);
  assert.doesNotMatch(route, /sendPush|push endpoint/i);
});
