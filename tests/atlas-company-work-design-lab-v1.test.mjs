import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const contract = read("lib/atlas/company-work.ts");
const route = read("app/api/atlas/company-work/route.ts");
const notebook = read("app/owner/design-atlas/CompanyWorkNotebook.tsx");
const fixture = read("app/owner/design-atlas/company-work-lab/page.tsx");
const designAtlas = read("app/owner/design-atlas/DesignAtlas.tsx");

test("Company Work has one shared application contract", () => {
  assert.match(route, /type CompanyWorkRow/);
  assert.match(route, /summarizeCompanyWork/);
  assert.match(contract, /management_position: CompanyWorkManagementPosition/);
  assert.match(contract, /unassigned/);
  assert.match(contract, /waiting_dependency/);
  assert.match(contract, /planning_conflict/);
});

test("Company Work notebook preserves company truth ahead of person presentation", () => {
  assert.match(notebook, /What this company currently needs done\./);
  assert.match(notebook, /Company Work proves existence\./);
  assert.match(notebook, /Allocation, readiness, Day, Clock, and attention/);
  assert.doesNotMatch(notebook, /home_task|worker_day|atlas\.tasks|assigned_user_id|visibility_scope/);
});

test("fixture proves all four initial management positions without live writes", () => {
  for (const position of ["unassigned", "allocated", "waiting_dependency", "planning_conflict"]) {
    assert.match(fixture, new RegExp(`management_position: "${position}"`));
  }
  assert.match(fixture, /Design Atlas fixture only/);
  assert.doesNotMatch(fixture, /fetch\(|supabase|rpc\(/);
});

test("Company Work lab is not linked into current Design Atlas navigation", () => {
  assert.doesNotMatch(designAtlas, /company-work-lab|CompanyWorkNotebook/);
});
