import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260804012000_bell_review_badge_contract_v1.sql");
const route = read("app/api/atlas/bell/route.ts");
const page = read("app/bell/page.tsx");
const cover = read("components/atlas/home/AtlasBellCover.tsx");
const contract = read("lib/atlas/bell-contract.ts");

test("the Bell API reads the v4 review contract", () => {
  assert.match(route, /supabase\.rpc\("bell_history_v4"/);
  assert.match(route, /X-Atlas-Read-Path": "bell-v4"/);
  assert.doesNotMatch(route, /supabase\.rpc\("bell_history_v3"/);
  assert.match(contract, /contractVersion: "atlas_bell_v4"/);
  assert.match(contract, /newAttentionCount: number/);
  assert.match(contract, /currentActionCount: number/);
  assert.match(contract, /badgeMeaning: "unreviewed_attention"/);
});

test("badge count and current work count are independent", () => {
  assert.match(migration, /bell_attention_counts_v1/);
  assert.match(migration, /count\(\*\) filter \(where latest\.requires_action and latest\.read_at is null\)/);
  assert.match(migration, /count\(\*\) filter \(where latest\.requires_action\)/);
  assert.match(migration, /'badgeCount'.*'newAttentionCount'/s);
  assert.match(migration, /'currentActionCount'/);
  assert.match(migration, /'workMeaning', 'current_actionable_work'/);
});

test("opening Bell records review receipts but does not acknowledge or complete work", () => {
  const visitStart = migration.indexOf("create or replace function atlas.record_bell_visit_v1");
  const visitEnd = migration.indexOf("create or replace function atlas.bell_history_v4", visitStart);
  const visit = migration.slice(visitStart, visitEnd);

  assert.match(visit, /insert into atlas\.bell_event_receipts/);
  assert.match(visit, /read_at = coalesce/);
  assert.match(visit, /acknowledged_at/);
  assert.doesNotMatch(visit, /set acknowledged_at = now\(\)/i);
  assert.doesNotMatch(visit, /update atlas\.tasks/);
  assert.doesNotMatch(visit, /status\s*=\s*'done'/);
});

test("the Bell page reviews through the prepared boundary and then refreshes truth", () => {
  const initialFetch = page.indexOf("const initial = await fetchAtlasBell(100)");
  const visit = page.indexOf("action: \"visit\"", initialFetch);
  const currentFetch = page.indexOf("const current = await fetchAtlasBell(100)", visit);
  assert.ok(initialFetch >= 0 && visit > initialFetch && currentFetch > visit);
  assert.match(page, /setAtlasAppBadge\(0\)/);
  assert.match(page, /setAtlasAppBadge\(current\.badgeCount\)/);
  assert.match(page, /Reviewed now\./);
  assert.match(page, /remain.*until.*resolved/s);
});

test("the floating and installed badges mean new attention only", () => {
  assert.match(cover, /item\.requiresAction && !item\.baseline && item\.unread/);
  assert.match(cover, /new \$\{bell\.badgeCount === 1 \? "item needs" : "items need"\} your attention/);
  assert.match(cover, /setAtlasAppBadge\(result\.badgeCount\)/);
  assert.doesNotMatch(cover, /acknowledged\)\s*\?\?/);
});
