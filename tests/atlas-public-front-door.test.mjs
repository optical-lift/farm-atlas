import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const welcome = fs.readFileSync(new URL("../app/welcome/page.tsx", import.meta.url), "utf8");
const welcomeStyles = fs.readFileSync(new URL("../app/welcome/sales-page.module.css", import.meta.url), "utf8");
const organizationStart = fs.readFileSync(new URL("../app/start/organization/page.tsx", import.meta.url), "utf8");
const organizationClient = fs.readFileSync(
  new URL("../app/onboarding/organization/OrganizationOnboardingClient.tsx", import.meta.url),
  "utf8",
);
const organizationApi = fs.readFileSync(
  new URL("../app/api/atlas/organizations/onboarding/route.ts", import.meta.url),
  "utf8",
);
const contextualFrame = fs.readFileSync(
  new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url),
  "utf8",
);
const proxy = fs.readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");

test("public Atlas front door states the product and offers Personal versus Organization Atlas", () => {
  assert.match(welcome, /Atlas puts it back together\./);
  assert.match(welcome, /Your company is already in there\. It just lives in pieces\./);
  assert.match(welcome, /Ready to map out your Atlas\?/);
  assert.match(welcome, /Personal Atlas/);
  assert.match(welcome, /Organization Atlas/);
});

test("public Atlas front door names supported official-API integration targets without replacing specialist systems", () => {
  for (const system of [
    "Google Workspace",
    "Microsoft 365",
    "QuickBooks",
    "Slack",
    "Shopify",
    "Stripe",
    "Salesforce",
    "HubSpot",
    "Square",
    "Dropbox",
  ]) {
    assert.match(welcome, new RegExp(system.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(welcome, /Keep the specialist software/);
  assert.match(welcome, /official APIs/);
});

test("sales specimen uses the Atlas notebook hand only for human-written tasks and stays on white paper", () => {
  assert.doesNotMatch(welcome, /Nothing_You_Could_Do/);
  assert.match(welcome, /check whether Thursday deliveries still fit/);
  assert.match(welcome, /review fall purchasing before Friday/);
  assert.match(welcomeStyles, /var\(--atlas-font-handwriting\)/);
  assert.match(welcomeStyles, /body:has\(\[data-atlas-sales-page="true"\]\)/);
  assert.match(welcomeStyles, /background: #fff !important/);
});

test("Organization Atlas is explicitly pre-membership", () => {
  assert.match(organizationStart, /does not make you an owner, employee, or member/i);
  assert.match(organizationClient, /has not\s+made you an owner, employee, or member/i);
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

test("product entry and onboarding do not inherit operational farm chrome", () => {
  assert.match(contextualFrame, /"\/welcome"/);
  assert.match(contextualFrame, /"\/start"/);
  assert.match(contextualFrame, /"\/join"/);
  assert.match(contextualFrame, /"\/onboarding"/);
  assert.match(contextualFrame, /rewrittenPublicRoot = pathname === "\/" && !effectiveFarmRole && !activeFarmName/);
  assert.match(contextualFrame, /if \(hidden\) return null/);
});
