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
const operator = read("app/OwnerOperatorMode.tsx");
const morePage = read("app/more/page.tsx");
const universalHome = read("components/atlas/home/AtlasUniversalHome.tsx");
const bellCover = read("components/atlas/home/AtlasBellCover.tsx");
const bellPage = read("app/bell/page.tsx");
const bellView = read("lib/atlas/bell-view.ts");
const bellAction = read("lib/atlas/bell-action.ts");
const bellRoute = read("app/api/atlas/bell/route.ts");
const bellContract = read("lib/atlas/bell-contract.ts");
const shellCss = read("app/contextual-app-shell.css");
const migration = read("supabase/migrations/20260730180100_bell_monitoring_baseline_and_obligations_v2.sql");
const reviewMigration = read("supabase/migrations/20260804012000_bell_review_badge_contract_v1.sql");

const shell = `${layout}\n${page}\n${frame}\n${around}\n${operator}\n${morePage}\n${shellCss}`;
const bell = `${bellCover}\n${bellPage}\n${bellView}\n${bellAction}\n${bellRoute}\n${bellContract}\n${migration}\n${reviewMigration}`;

test("Atlas gains a contextual fixed shell without a separate Journal destination", () => {
  assert.match(layout, /<AtlasContextualAppFrame \/>/);
  assert.match(frame, /Home/);
  assert.match(frame, /Work/);
  assert.match(frame, /Harvest/);
  assert.match(frame, /More/);
  assert.doesNotMatch(frame, /Places/);
  assert.match(morePage, /label:\s*"Zone Registry"/);
  assert.doesNotMatch(frame, />Journal</);
  assert.doesNotMatch(frame, /key:\s*"projects"/);
  assert.match(morePage, /label:\s*"Projects"/);
  assert.match(shellCss, /position: fixed/);
  assert.match(shellCss, /atlas-context-footer/);
  assert.match(shellCss, /atlas-phone-top,[\s\S]*position: sticky/);
});

test("the app footer is an opaque rectangular dock that covers the bottom edge", () => {
  assert.match(shellCss, /\.atlas-context-footer \{[\s\S]*background: #faf7ed/);
  assert.match(shellCss, /\.atlas-context-footer__rail \{[\s\S]*width: 100%/);
  assert.match(shellCss, /\.atlas-context-footer__rail \{[\s\S]*border-radius: 0/);
  assert.match(shellCss, /padding-bottom: calc\(var\(--atlas-context-footer-height\) \+ env\(safe-area-inset-bottom\)/);
  assert.match(frame, /atlas-context-footer__icon/);
  assert.match(shellCss, /\.atlas-context-footer__item\[aria-current="page"\][\s\S]*background: transparent/);
});

test("Owner operator mode is folded into the compact header and logout moves to More", () => {
  assert.match(operator, /aria-label="Operating as"/);
  assert.doesNotMatch(operator, /<LogoutForm/);
  assert.match(shellCss, /The Owner selector is part of the visible app header/);
  assert.match(shellCss, /\.atlas-owner-operator,[\s\S]*position: fixed/);
  assert.match(shellCss, /body:has\(\.atlas-owner-operator\) \.atlas-topbar/);
  assert.match(morePage, /action="\/api\/atlas\/auth\/logout"/);
  assert.match(morePage, />Log out</);
});

test("Home stays recognizable and gains compact deeper routes without duplicating the dock", () => {
  assert.match(page, /<AtlasUniversalHome/);
  assert.match(page, /<AtlasAroundRoutes canManage=/);
  assert.match(around, /Around Atlas/);
  assert.match(around, /See more of the farm/);
  assert.match(around, /Govern Atlas/);
  assert.match(around, /Week \+ month/);
  assert.doesNotMatch(around, /Work with the farm|Places \+ maps|Open current project work/);
  assert.doesNotMatch(around, /Farm Journal|Journal history/);
  assert.match(shellCss, /Home route deck is a contents list, not another dashboard card/);
  assert.match(shellCss, /\.atlas-around-routes \{[\s\S]*border: 0/);
});

test("unfinished Portfolio Matrix and Trail Pulse surfaces stay off Home", () => {
  assert.match(universalHome, /id="work-board"/);
  assert.match(shellCss, /#portfolio-matrix/);
  assert.match(shellCss, /#trail-pulse/);
  assert.match(shellCss, /display: none !important/);
  assert.doesNotMatch(frame, /#portfolio-matrix/);
  assert.doesNotMatch(around, /Portfolio Matrix/);
  assert.match(frame, /\/#work-board/);
  assert.doesNotMatch(around, /\/#work-board/);
});

test("narrow Home date rows prioritize the useful range over repeated labels", () => {
  assert.match(shellCss, /atlas-home-month-week-list[\s\S]*small[\s\S]*display: none/);
  assert.match(shellCss, /atlas-home-overview-row-link b[\s\S]*text-overflow: ellipsis/);
});

test("the floating Bell is global, header-aware, role-aware, and disappears when no new attention is waiting", () => {
  assert.match(layout, /<AtlasBellCover \/>/);
  assert.doesNotMatch(page, /AtlasBellCover/);
  assert.match(bellCover, /visibleHeaderBottom/);
  assert.match(bellCover, /bell\.badgeCount <= 0/);
  assert.match(bellCover, /pathname === "\/bell"/);
  assert.match(bellCover, /your attention/);
  assert.match(bellCover, /atlasBellActionTitle\(newest\)/);
  assert.match(bellCover, /management \? "New attention" : "New follow-through"/);
  assert.match(bellCover, /item\.unread/);
});

test("Bell preserves the v2 monitoring baseline while the API reads the additive v4 review contract", () => {
  assert.match(migration, /create table if not exists atlas\.bell_monitoring_baselines/);
  assert.match(migration, /bell_event_obligation_key_v2/);
  assert.match(migration, /distinct on \(eligible\.obligation_key\)/);
  assert.match(migration, /item\.occurred_at > v_baseline_at/);
  assert.match(migration, /latest_worthy_event_per_obligation/);
  assert.match(bellRoute, /bell_history_v4/);
  assert.match(bellContract, /atlas_bell_v4/);
  assert.match(reviewMigration, /unreviewed_attention/);
  assert.match(reviewMigration, /current_actionable_work/);
});

test("known gaps remain available to management as older actions without masquerading as employee work", () => {
  assert.match(migration, /Existing Atlas gaps acknowledged at Bell v2 monitoring start/);
  assert.match(migration, /item\.occurred_at <= v_baseline_at and item\.requires_action/);
  assert.match(bellView, /item\.baseline && item\.requiresAction/);
  assert.match(bellView, /eyebrow: "Older work"/);
  assert.match(bellPage, /view=older/);
  assert.match(bellPage, /management \? \(/);
  assert.doesNotMatch(bellPage, /known obligations/);
  assert.doesNotMatch(bellPage, /do not count as new notifications/);
});

test("Bell retains explanation truth in its contract without displaying descriptions", () => {
  assert.match(migration, /bell_event_why_v2/);
  assert.match(migration, /Atlas expected this rhythm to renew by now/);
  assert.match(migration, /A decision or problem handoff reached the Owner/);
  assert.match(bellContract, /why: string/);
  assert.doesNotMatch(bellPage, /item\.why/);
  assert.doesNotMatch(bellPage, /item\.detail/);
  assert.doesNotMatch(bellPage, /Why you’re seeing this/);
});

test("Bell is a role-aware action lens over Atlas truth rather than a second history surface", () => {
  assert.match(bellPage, /atlasBellActionTitle\(item\)/);
  assert.match(bellPage, /atlasBellActionTiming\(item\)/);
  assert.match(bellPage, /atlasBellConsequence\(item\)/);
  assert.match(bellPage, /atlasBellOpenLabel\(item\)/);
  assert.match(bellView, /"now" \| "next" \| "older"/);
  assert.match(bellContract, /eventTruth: "journal_event_index"/);
  assert.match(bellContract, /receiptTruth: "bell_event_receipts"/);
  assert.match(bellPage, /Reviewed now\./);
  assert.doesNotMatch(bell, /create table if not exists atlas\.bell_events/);
  assert.doesNotMatch(bellPage, /Acknowledge|Mark reviewed|Movement|Baseline/);
});
