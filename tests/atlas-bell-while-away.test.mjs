import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260730134847_bell_and_while_away_foundation_v1.sql");
const reviewMigration = read("supabase/migrations/20260804012000_bell_review_badge_contract_v1.sql");
const contract = read("lib/atlas/bell-contract.ts");
const client = read("lib/atlas/bell-client.ts");
const route = read("app/api/atlas/bell/route.ts");
const cover = read("components/atlas/home/AtlasBellCover.tsx");
const page = read("app/bell/page.tsx");
const action = read("lib/atlas/bell-action.ts");
const view = read("lib/atlas/bell-view.ts");
const css = read("app/bell.css");
const home = read("app/page.tsx");
const layout = read("app/layout.tsx");

const ui = `${cover}\n${page}\n${action}\n${view}\n${css}\n${home}\n${layout}`;

test("Bell receipts never become a second Atlas event truth", () => {
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

test("badge count means unread current attention while current work remains separately countable", () => {
  assert.match(reviewMigration, /bell_attention_counts_v1/);
  assert.match(reviewMigration, /latest\.requires_action and latest\.read_at is null/);
  assert.match(reviewMigration, /'newAttentionCount'/);
  assert.match(reviewMigration, /'currentActionCount'/);
  assert.match(reviewMigration, /'badgeMeaning', 'unreviewed_attention'/);
  assert.match(contract, /badgeCount: number/);
  assert.match(contract, /newAttentionCount: number/);
  assert.match(contract, /currentActionCount: number/);
  assert.doesNotMatch(reviewMigration, /count\(\*\).*from atlas\.tasks[\s\S]*badge_count/i);
});

test("while-away keeps a durable visit boundary while review clears only new attention", () => {
  assert.match(migration, /create table if not exists atlas\.bell_visit_state/);
  assert.match(migration, /previous_visited_at/);
  assert.match(migration, /last_visited_at/);
  assert.match(reviewMigration, /record_bell_visit_v1/);
  assert.match(reviewMigration, /insert into atlas\.bell_event_receipts/);
  assert.match(reviewMigration, /read_at = coalesce/);
  assert.match(contract, /"read" \| "acknowledge" \| "visit"/);
  assert.match(page, /action: "visit"/);
  assert.match(page, /setAtlasAppBadge\(0\)/);
  assert.match(page, /Reviewed now\./);
  assert.match(cover, /atlasBellActionTitle\(newest\)/);
  assert.match(cover, /management \? "New attention" : "New follow-through"/);
  assert.match(cover, /item\.unread/);
  assert.match(cover, /atlasBellActionTiming\(newest\)/);
  assert.doesNotMatch(cover, /While you were away/);
});

test("Bell entries carry safe canonical deep links while the action UI opens the real destination", () => {
  assert.match(migration, /bell_event_deep_link_v1/);
  assert.match(migration, /\/task-focus\//);
  assert.match(migration, /\/project\//);
  assert.match(migration, /\/objects\//);
  assert.match(migration, /\/journal\?date=/);
  assert.match(migration, /mark_bell_event_v1/);
  assert.match(migration, /p_action not in \('read', 'acknowledge'\)/);
  assert.match(page, /href=\{item\.deepLink\}/);
  assert.match(page, /atlasBellOpenLabel\(item\)/);
  assert.doesNotMatch(page, /Acknowledge|Mark reviewed/);
});

test("Home stays recognizable while the floating Bell and role-aware action queues belong to the global app shell", () => {
  assert.match(home, /<AtlasUniversalHome/);
  assert.doesNotMatch(home, /<AtlasBellCover/);
  assert.match(layout, /<AtlasBellCover \/>/);
  assert.match(cover, /atlas-bell-edge-tab/);
  assert.match(cover, /atlas-while-away-slip/);
  assert.match(page, />Do now</);
  assert.match(page, />Coming up</);
  assert.match(page, />Older work</);
  assert.match(page, /management \? \(/);
  assert.match(page, /data-atlas-bell-mode=\{management \? "management" : "follow-through"\}/);
  assert.match(page, /atlasBellActionTitle\(item\)/);
  assert.doesNotMatch(page, /Why you’re seeing this|Current obligations/);
  assert.match(layout, /import "\.\/bell\.css"/);
  assert.match(css, /\.atlas-bell-cover/);
  assert.match(css, /\.atlas-bell-item/);
});

test("the original Bell foundation remains in-app and separate from Web Push transport", () => {
  assert.doesNotMatch(migration, /push_subscription|service_worker|web_push/i);
  assert.doesNotMatch(route, /sendPush|push endpoint/i);
  assert.match(ui, /AtlasBellCover|Atlas Bell/);
});
