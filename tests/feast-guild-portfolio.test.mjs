import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const migrationPath = "supabase/migrations/20260727213000_feast_guild_portfolio_foundation_v1.sql";

test("Feast Guild is an organization above farms, not a fake farm", () => {
  const migration = read(migrationPath);
  assert.match(migration, /create table if not exists atlas\.organizations/i);
  assert.match(migration, /'feast_guild'[\s\S]*'Feast Guild'/i);
  assert.match(migration, /'waiting_room_farm'[\s\S]*'Waiting Room Farm'/i);
  assert.doesNotMatch(migration, /insert into atlas\.farms[\s\S]{0,300}'feast_guild'/i);
});

test("projects can be farm-specific or collective while farm work stays explicit", () => {
  const migration = read(migrationPath);
  assert.match(migration, /alter table atlas\.projects alter column farm_id drop not null/i);
  assert.match(migration, /project_kind in \('farm','cross_farm','organization'\)/i);
  assert.match(migration, /task_scope in \('farm_operation','project'\)/i);
  assert.match(migration, /visibility_scope in \([^)]*'project_shared'/i);
  assert.match(migration, /create_project_task_v1/i);
  assert.match(migration, /complete_project_task_v1/i);
});

test("Waiting Room places preserve the property hierarchy", () => {
  const migration = read(migrationPath);
  assert.match(migration, /create table if not exists atlas\.places/i);
  assert.match(migration, /parent_place_id uuid references atlas\.places/i);
  assert.match(migration, /'main_house'[\s\S]*'Main House'/i);
  assert.match(migration, /'main_level_bedroom'[\s\S]*'Main Level Bedroom'/i);
  assert.match(migration, /'basement'[\s\S]*'Basement'/i);
  assert.match(migration, /'standalone_garage'[\s\S]*'Standalone Garage'/i);
  assert.doesNotMatch(migration, /'grounds'/i);
});

test("the same portfolio home is permission scoped for owners and contributors", () => {
  const page = read("app/page.tsx");
  const session = read("lib/atlas/session.ts");
  const proxy = read("lib/supabase/proxy.ts");
  const portfolio = read("components/atlas/portfolio/FeastGuildPortfolioHome.tsx");

  assert.match(page, /atlasPortalViewerFromSession/);
  assert.match(page, /FeastGuildPortfolioHome/);
  assert.match(session, /organization_memberships/);
  assert.match(proxy, /needsAtlasPortfolioMembership/);
  assert.match(proxy, /organization_memberships/);
  assert.match(portfolio, /Portfolio matrix/);
  assert.match(portfolio, /Needs attention/);
  assert.doesNotMatch(portfolio, /displayName|Lex/);
});

test("seed projects reflect the confirmed portfolio without naming the owner", () => {
  const migration = read(migrationPath);
  const projectPage = read("app/project/[projectId]/page.tsx");
  assert.match(migration, /'elm_airbnb_launch'[\s\S]*'Launch Elm on Airbnb'/i);
  assert.match(migration, /'waiting_room_ada_compliant_ward'[\s\S]*'ADA Compliant Ward'/i);
  assert.match(migration, /'rehabilitation_house_funding_caregiver_pathways'/i);
  assert.match(migration, /medical_records_policy/i);
  assert.doesNotMatch(projectPage, /Project lead|displayName|Lex/);
});
