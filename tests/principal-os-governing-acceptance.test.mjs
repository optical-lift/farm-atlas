import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(root, "supabase/migrations");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function migrationCorpus() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
    .join("\n\n-- migration boundary --\n\n");
}

const migrations = migrationCorpus();
const principalPage = read("app/principal/page.tsx");
const principalSurface = read("components/atlas/principal/PrincipalSurface.tsx");
const principalUi = `${principalPage}\n${principalSurface}`;
const principalContext = read("lib/atlas/principal-self-context.ts");
const capacityResolutionPage = read("app/principal/resolve/farm-capacity/page.tsx");
const capacityResolutionClient = read("app/principal/resolve/farm-capacity/WorkerDayShapeResolutionClient.tsx");
const ownerPage = read("app/owner/page.tsx");
const ownerDashboardClient = read("app/owner/OwnerDashboardClient.tsx");
const workerTodayPage = read("app/work/today/page.tsx");
const ownerWeekRetirement = read("supabase/migrations/20260817123000_owner_week_projection_compat_retirement_v1.sql");

/**
 * Governing source: Atlas Principal Operating System — Build v1, acceptance tests 1–9.
 *
 * These are architectural regression guards, not fixtures for the user's current
 * household, portfolio thesis, money balances, or Farm Hand availability. They
 * freeze the distinction between Principal truth and farm execution while live
 * acceptance probes continue to validate the database behavior itself.
 *
 * Principal presentation is deliberately shared between the authenticated route
 * and Design Atlas. Acceptance language therefore belongs to the route + shared
 * presentation contract, not to route-local JSX.
 */

test("Acceptance 1: Principal enters through whole-field context, not a selected farm", () => {
  assert.match(principalContext, /principal_self_context_api_v1/);
  assert.match(principalPage, /<PrincipalSurface context=\{context\}/);
  assert.match(principalUi, /Whole-field responsibility across household, portfolio, money, attention, authority, and protected future/i);
  assert.doesNotMatch(principalPage, /getOwnerDashboard|owner_week_projection/);
  assert.match(migrations, /create table(?: if not exists)? atlas\.portfolio_units/i);
});

test("Acceptance 2: a future H3 portfolio option does not require a linked farm", () => {
  assert.match(migrations, /linked_farm_id uuid/i);
  assert.match(migrations, /horizon[\s\S]{0,220}'H1'[\s\S]{0,220}'H2'[\s\S]{0,220}'H3'/i);
  assert.match(principalUi, /No farm required/);
});

test("Acceptance 3: household rhythms constrain Principal capacity without becoming farm tasks", () => {
  assert.match(migrations, /create table(?: if not exists)? atlas\.household_rhythms/i);
  assert.match(migrations, /blocks_capacity/i);
  assert.match(migrations, /principal_capacity_day_state_v1/i);
  assert.match(migrations, /household_rhythm_tick_v1|advance_household_rhythm/i);
  assert.match(principalUi, /Household rhythms constrain business capacity/i);
  assert.doesNotMatch(capacityResolutionPage, /insert into atlas\.tasks|create.*task/i);
});

test("Acceptance 4: Owner Obligations can earn protected time before conventional due-date urgency", () => {
  assert.match(migrations, /create table(?: if not exists)? atlas\.owner_obligations/i);
  for (const field of ["becomes_relevant_at", "must_begin_by", "must_finish_by", "expected_minutes", "protection_level", "reason_for_floor"]) {
    assert.ok(migrations.includes(field), `Owner Obligation contract must retain ${field}`);
  }
  assert.match(migrations, /'owner_obligation'::text AS source_type/i);
  assert.match(migrations, /relevant_window_open/i);
});

test("Acceptance 5: delegated task volume stays contained until a governed operating threshold crosses", () => {
  const bridge = read("supabase/migrations/20260817015500_principal_farm_capacity_escalation_bridge_v1.sql");
  assert.match(bridge, /worker_weekly_capacity_conflict_v1/);
  assert.match(bridge, /'capacity_breach'/);
  assert.match(bridge, /'missing_critical_information'/);
  assert.doesNotMatch(bridge, /from atlas\.tasks\b|join atlas\.tasks\b/i);
  assert.match(bridge, /delegatedTasksRemainFarmContained/i);
  assert.match(capacityResolutionPage, /ordinary delegated work remains contained/i);
});

test("Acceptance 6: Principal Clock ordering changes with timing state, not static priority alone", () => {
  assert.match(migrations, /fixed_active/);
  assert.match(migrations, /must_begin_boundary_reached/);
  assert.match(migrations, /latest_start_reached/);
  assert.match(migrations, /relevant_window_open/);
  assert.match(migrations, /order by[\s\S]{0,500}derived_timing_tier[\s\S]{0,300}floor_class/i);
  assert.match(migrations, /A fixed commitment is in progress\./i);
  assert.match(migrations, /Its must-begin boundary has been reached\./i);
  assert.match(principalUi, /Principal Clock/);
});

test("Acceptance 7: H2/H3 attention debt can earn protected Principal floor", () => {
  assert.match(migrations, /create table(?: if not exists)? atlas\.attention_subjects/i);
  assert.match(migrations, /create table(?: if not exists)? atlas\.attention_policies/i);
  assert.match(migrations, /attention_debt_v1/i);
  assert.match(migrations, /attention_state\s*=\s*'needs_attention'/i);
  assert.match(migrations, /'attention_debt'::text AS source_type/i);
  assert.match(principalUi, /H1 current engines remain visible without consuming H2 emerging engines or H3 future options/i);
});

test("Acceptance 8: House Position fails open to uncertainty, never fake zero financial truth", () => {
  assert.match(migrations, /principal_house_position_api_v1/i);
  assert.match(migrations, /source_required/i);
  assert.match(migrations, /freshness/i);
  assert.match(migrations, /coverage/i);
  assert.match(migrations, /includedAccounts|included_accounts/i);
  assert.match(migrations, /includedEntities|included_entities/i);
  assert.match(principalUi, /Financial source required\. Atlas is not substituting zero balances for unknown data\./i);
});

test("Acceptance 9: Worker Week is canonical and Owner Week compatibility is retired", () => {
  assert.match(migrations, /alter table atlas\.owner_week_projection rename to worker_week_projection/i);
  assert.match(migrations, /worker_future_day_projection_source_v1[\s\S]{0,2500}worker_week_projection/i);

  // Worker Week remains the canonical worker scheduling projection wherever the
  // worker/legacy Owner-dashboard compatibility surfaces still consume week truth.
  for (const caller of [ownerDashboardClient, workerTodayPage]) {
    assert.match(caller, /@\/lib\/atlas-data\/worker-week-projection/);
    assert.doesNotMatch(caller, /owner-week-projection|readOwnerWeekProjection|OwnerWeekProjection/);
  }
  assert.match(ownerDashboardClient, /WorkerWeekProjection/);
  assert.match(workerTodayPage, /readWorkerWeekProjection/);

  // The new person-owned /owner shell is fixture-only and deliberately consumes
  // neither Worker Week nor the retired Owner Week projection.
  assert.doesNotMatch(ownerPage, /worker-week-projection|readWorkerWeekProjection/);
  assert.doesNotMatch(ownerPage, /owner-week-projection|readOwnerWeekProjection|OwnerWeekProjection/);

  assert.ok(!existsSync(join(root, "lib/atlas-data/owner-week-projection.ts")));
  assert.match(ownerWeekRetirement, /drop view if exists atlas\.owner_week_projection/i);
  assert.match(ownerWeekRetirement, /drop function if exists atlas\.refresh_owner_week_projection_v1\(uuid,uuid,date,integer\)/i);
  assert.match(ownerWeekRetirement, /delete from atlas\.authenticated_rpc_registry[\s\S]{0,300}refresh_owner_week_projection_v1/i);
  assert.doesNotMatch(principalPage, /owner_week_projection/);
});

test("Governing guard: capacity-resolution UI records human truth instead of inventing a worker schedule", () => {
  assert.match(capacityResolutionClient, /useState<number\[]>\(\[\]\)/);
  assert.match(capacityResolutionClient, /const \[localStart, setLocalStart\] = useState\(""\)/);
  assert.match(capacityResolutionClient, /const \[localEnd, setLocalEnd\] = useState\(""\)/);
  assert.match(capacityResolutionClient, /Do not choose hours that make the work fit|Record the human truth Atlas should remember/i);
  assert.ok(existsSync(join(root, "app/api/atlas/principal/worker-day-shape/route.ts")));
});
