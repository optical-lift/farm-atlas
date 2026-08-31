import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const welcome = fs.readFileSync(new URL("../app/welcome/page.tsx", import.meta.url), "utf8");
const organizationStart = fs.readFileSync(new URL("../app/start/organization/page.tsx", import.meta.url), "utf8");
const organizationClient = fs.readFileSync(
  new URL("../app/onboarding/organization/OrganizationOnboardingClient.tsx", import.meta.url),
  "utf8",
);
const organizationApi = fs.readFileSync(
  new URL("../app/api/atlas/organizations/onboarding/route.ts", import.meta.url),
  "utf8",
);
const proxy = fs.readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");

test("public Atlas front door begins with Personal versus Organization Atlas", () => {
  assert.match(welcome, /Personal Atlas/);
  assert.match(welcome, /Organization Atlas/);
  assert.match(welcome, /What is getting an Atlas\?/);
});

test("Organization Atlas is explicitly pre-membership", () => {
  assert.match(organizationStart, /does not make you an owner, employee, or member/i);
  assert.match(organizationClient, /has not made you an owner, employee, or member/i);
  assert.doesNotMatch(organizationApi, /establish_organization_self_api_v1/);
  assert.match(organizationApi, /begin_organization_onboarding_self_api_v1/);
});

test("organization onboarding does not require an Elm farm membership", () => {
  assert.match(proxy, /!pathname\.startsWith\("\/api\/atlas\/organizations\/"\)/);
});

test("signed-out root is rewritten to the public Atlas front door", () => {
  assert.match(proxy, /!authenticated && pathname === "\/"/);
  assert.match(proxy, /destination\.pathname = "\/welcome"/);
});
