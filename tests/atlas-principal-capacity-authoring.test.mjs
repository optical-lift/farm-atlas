import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const route = read("app/api/atlas/principal/capacity-policy/route.ts");
const page = read("app/principal/capacity/page.tsx");
const form = read("components/atlas/principal/PrincipalCapacityPolicyForm.tsx");
const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const selfReadMigration = read("supabase/migrations/20260817005129_principal_capacity_policy_self_read_v1.sql");
const invariantsMigration = read("supabase/migrations/20260817005201_principal_capacity_policy_authoring_invariants_v1.sql");
const readerRegistryMigration = read("supabase/migrations/20260817005358_principal_capacity_reader_registry_v1.sql");

test("Principal Capacity reads and writes only through authenticated governed RPCs", () => {
  assert.match(route, /getAtlasSession/);
  assert.match(route, /organizationMemberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /principal_capacity_policies_self_api_v1/);
  assert.match(route, /principal_set_capacity_policy_api_v1/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.doesNotMatch(route, /SERVICE_ROLE|service_role/i);
  assert.doesNotMatch(route, /\.from\("principal_capacity_policies"\)/);
});

test("Principal Capacity never invents a default workweek or clock envelope", () => {
  assert.match(form, /useState<number\[]>\(\[\]\)/);
  assert.match(form, /useState\(""\)/);
  assert.match(form, /Choose at least one day\. Atlas will not infer your workweek\./);
  assert.match(form, /outer capacity envelope, not a work quota/i);
  assert.match(form, /Household and fixed commitments subtract from it/);
  assert.doesNotMatch(form, /setWeekdays\(\[1, 2, 3, 4, 5\]\)/);
  assert.doesNotMatch(form, /setLocalStart\("09:00"\)/);
  assert.doesNotMatch(form, /setLocalEnd\("17:00"\)/);
  assert.doesNotMatch(form, /setDefaultMinutes\("\d+"\)/);
  assert.doesNotMatch(form, /setMaximumMinutes\("\d+"\)/);
});

test("capacity persistence requires an explicit form submission", () => {
  assert.match(form, /async function submit\(event: FormEvent<HTMLFormElement>\)/);
  assert.match(form, /method: "POST"/);
  assert.match(form, /onSubmit=\{submit\}/);
  assert.doesNotMatch(form, /useEffect\([\s\S]{0,500}method: "POST"/);
  assert.match(form, /Save Principal Capacity/);
});

test("capacity setup is a Principal-time surface and is discoverable from the Principal dock", () => {
  assert.match(page, /readAtlasPrincipalSelfContext/);
  assert.match(page, /organizationMemberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(page, /context\.principal\?\.homeTimezone/);
  assert.match(frame, /label: "Capacity", href: "\/principal\/capacity"/);
  assert.match(frame, /pathname === "\/principal\/capacity"/);
});

test("database capacity contracts fail closed and protect the authoring invariants", () => {
  assert.match(selfReadMigration, /does not infer or seed a schedule/);
  assert.match(selfReadMigration, /security definer/);
  assert.match(selfReadMigration, /set search_path = pg_catalog, atlas, auth/);
  assert.match(invariantsMigration, /localEnd must be later than localStart/);
  assert.match(invariantsMigration, /defaultDiscretionaryMinutes cannot exceed maximumPlannedMinutes/);
  assert.match(invariantsMigration, /Capacity minute values cannot be negative/);
  assert.match(invariantsMigration, /weekdays values must be integers from 0 \(Sunday\) through 6 \(Saturday\)/);
  assert.match(readerRegistryMigration, /revoke execute on function atlas\.current_principal_id_v1\(\) from public, anon, authenticated/);
  assert.match(readerRegistryMigration, /principal_capacity_policies_self_api_v1\(\)/);
});
