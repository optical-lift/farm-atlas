import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const welcome = fs.readFileSync(new URL("../app/welcome/page.tsx", import.meta.url), "utf8");
const welcomeStyles = fs.readFileSync(new URL("../app/welcome/sales-page.module.css", import.meta.url), "utf8");
const welcomeHeroPhotoStyles = fs.readFileSync(new URL("../app/welcome/hero-photo.module.css", import.meta.url), "utf8");
const atlasStart = fs.readFileSync(new URL("../app/start/page.tsx", import.meta.url), "utf8");
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

test("public Atlas front door presents one connected-life product and one start path", () => {
  assert.match(welcome, /Connective intelligence for real life/);
  assert.match(welcome, /Atlas puts it back together\./);
  assert.match(welcome, /Your life is already in there\. It just lives in pieces\./);
  assert.match(welcome, /One life\. Many circles\. One Atlas\./);
  assert.match(welcome, /href="\/start"/);
  assert.doesNotMatch(welcome, /Start Organization Atlas/);
  assert.doesNotMatch(welcome, /Begin Personal Atlas/);
  assert.doesNotMatch(welcome, /Begin Organization Atlas/);
});

test("public Atlas front door keeps specialist systems visible without turning them into the hero", () => {
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
  assert.match(welcome, /Connect what already knows your life/);
  assert.match(welcome, /Keep the tools that already do their jobs/);
});

test("sales hero uses a real notebook photo with a coherent working-parent rapid-log example", () => {
  assert.match(welcome, /images\.pexels\.com\/photos\/17219305/);
  assert.match(welcome, /FUTURE LOG/);
  assert.match(welcome, /SEPTEMBER/);
  assert.match(welcome, /DAILY LOG · THU 3/);
  assert.match(welcome, /dentist · 2:30/);
  assert.match(welcome, /school pickup · 3:15/);
  assert.match(welcome, /groceries → Fri/);
  assert.match(welcome, /Meeting moved to 11:30/);
  assert.match(welcome, /Leave work by 2:05/);
  assert.match(welcomeHeroPhotoStyles, /grid-template-columns: minmax\(0, 1\.72fr\) minmax\(360px, 1fr\)/);
  assert.match(welcomeHeroPhotoStyles, /mask-image: radial-gradient/);
  assert.match(welcomeHeroPhotoStyles, /rotate\(-4deg\)/);
  assert.match(welcomeStyles, /padding: 62px 0 74px/);
  assert.doesNotMatch(welcomeStyles, /min-height: 410px/);
  assert.match(welcomeStyles, /body:has\(\[data-atlas-sales-page="true"\]\)/);
  assert.match(welcomeStyles, /background: #fff !important/);
});

test("sales page tells the working-parent example as one before-change-consequence story", () => {
  assert.match(welcome, /One ordinary Thursday/);
  assert.match(welcome, /Her day is already mapped\. Then one thing changes\./);
  assert.match(welcome, /THE MORNING PLAN/);
  assert.match(welcome, /WORK CHANGES/);
  assert.match(welcome, /The meeting still fits\./);
  assert.match(welcome, /groceries → Friday/);
});

test("sales page maps outward from one person instead of splitting Atlas into two products", () => {
  assert.match(welcome, /You are the center\. Your circles are the map\./);
  assert.match(welcome, /personalized to the life you are responsible for/);
  assert.match(welcome, /organization can also have its own shared Atlas/);
  assert.match(welcome, />YOU</);
  assert.match(welcome, />HOUSEHOLD</);
  assert.match(welcome, />ORGANIZATIONS</);
});

test("one Atlas start screen asks where onboarding begins only after the sales CTA", () => {
  assert.match(atlasStart, /What are you bringing into Atlas first\?/);
  assert.match(atlasStart, /Atlas is personalized around the person using it/);
  assert.match(atlasStart, />Myself</);
  assert.match(atlasStart, />An organization</);
  assert.match(atlasStart, /href="\/start\/personal"/);
  assert.match(atlasStart, /href="\/start\/organization"/);
  assert.match(atlasStart, /not a choice between two different Atlas products/i);
  assert.match(proxy, /pathname === "\/start"/);
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
