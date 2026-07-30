import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layout = read("app/layout.tsx");
const page = read("app/page.tsx");
const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const around = read("components/atlas/home/AtlasAroundRoutes.tsx");
const universalHome = read("components/atlas/home/AtlasUniversalHome.tsx");
const bellCover = read("components/atlas/home/AtlasBellCover.tsx");
const bellPage = read("app/bell/page.tsx");
const bellRoute = read("app/api/atlas/bell/route.ts");
const bellContract = read("lib/atlas/bell-contract.ts");
const shellCss = read("app/contextual-app-shell.css");
const migration = read("supabase/migrations/20260730180100_bell_monitoring_baseline_and_obligations_v2.sql");

const shell = `${layout}\n${page}\n${frame}\n${around}\n${shellCss}`;
const bell = `${bellCover}\n${bellPage}\n${bellRoute}\n${bellContract}\n${migration}`;

test("Atlas gains a contextual fixed shell without a separate Journal destination", () => {
  assert.match(layout, /<AtlasContextualAppFrame \/>/);
  assert.match(frame, /Home/);
  assert.match(frame, /Work/);
  assert.match(frame, /Places/);
  assert.match(frame, /Projects/);
  assert.match(frame, /More/);
  assert.doesNotMatch(frame, />Journal</);
  assert.match(shellCss, /position: fixed/);
  assert.match(shellCss, /atlas-context-footer/);
  assert.match(shellCss, /atlas-phone-top[\s\S]*position: sticky/);
});

test("the app footer is an opaque rectangular dock that covers the bottom edge", () => {
  assert.match(shellCss, /\.atlas-context-footer \{[\s\S]*background: #faf7ed/);
  assert.match(shellCss, /\.atlas-context-footer__rail \{[\s\S]*width: 100%/);
  assert.match(shellCss, /\.atlas-context-footer__rail \{[\s\S]*border-radius: 0/);
  assert.match(shellCss, /padding-bottom: calc\(var\(--atlas-context-footer-height\) \+ env\(safe-area-inset-bottom\)/);
});

test("Home stays recognizable and gains routes into the rest of Atlas", () => {
  assert.match(page, /<AtlasUniversalHome/);
  assert.match(page, /<AtlasAroundRoutes/);
  assert.match(around, /Around Atlas/);
  assert.match(around, /Work with the farm/);
  assert.match(around, /See the farm/);
  assert.match(around, /Govern Atlas/);
  assert.doesNotMatch(around, /Farm Journal|Journal history/);
});

test("unfinished Portfolio Matrix and Trail Pulse surfaces stay off Home", () => {
  assert.match(universalHome, /id="work-board"/);
  assert.match(shellCss, /#portfolio-matrix/);
  assert.match(shellCss, /#trail-pulse/);
  assert.match(shellCss, /display: none !important/);
  assert.doesNotMatch(frame, /#portfolio-matrix/);
  assert.doesNotMatch(around, /Portfolio Matrix/);
  assert.match(frame, /\/#work-board/);
  assert.match(around, /\/#work-board/);
});

test("the floating Bell is global, header-aware, and disappears when nothing needs attention", () => {
  assert.match(layout, /<AtlasBellCover \/>/);
  assert.doesNotMatch(page, /AtlasBellCover/);
  assert.match(bellCover, /visibleHeaderBottom/);
  assert.match(bellCover, /bell\.badgeCount <= 0/);
  assert.match(bellCover, /pathname === "\/bell"/);
  assert.match(bellCover, /things need/);
});

test("Bell v2 establishes a monitoring baseline and groups one current event per obligation", () => {
  assert.match(migration, /create table if not exists atlas\.bell_monitoring_baselines/);
  assert.match(migration, /bell_event_obligation_key_v2/);
  assert.match(migration, /distinct on \(eligible\.obligation_key\)/);
  assert.match(migration, /item\.occurred_at > v_baseline_at/);
  assert.match(migration, /latest_worthy_event_per_obligation/);
  assert.match(bellRoute, /bell_history_v2/);
  assert.match(bellContract, /atlas_bell_v2/);
});

test("known gaps remain reviewable but do not masquerade as future notifications", () => {
  assert.match(migration, /Existing Atlas gaps acknowledged at Bell v2 monitoring start/);
  assert.match(migration, /item\.occurred_at <= v_baseline_at and item\.requires_action/);
  assert.match(bellPage, /known obligations/);
  assert.match(bellPage, /do not count as new notifications/);
  assert.match(bellPage, /view=baseline/);
});

test("every Bell item explains why it reached the selected account", () => {
  assert.match(migration, /bell_event_why_v2/);
  assert.match(migration, /Atlas expected this rhythm to renew by now/);
  assert.match(migration, /A decision or problem handoff reached the Owner/);
  assert.match(bellPage, /Why you’re seeing this/);
  assert.match(bellContract, /why: string/);
});

test("Bell remains a lens over Atlas truth rather than a dumping ground", () => {
  assert.match(bellPage, /not a second task list or a separate history dumping ground/);
  assert.match(bellContract, /eventTruth: "journal_event_index"/);
  assert.match(bellContract, /receiptTruth: "bell_event_receipts"/);
  assert.doesNotMatch(bell, /create table if not exists atlas\.bell_events/);
});
