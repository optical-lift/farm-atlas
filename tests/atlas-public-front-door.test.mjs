import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const welcome = fs.readFileSync(new URL("../app/welcome/page.tsx", import.meta.url), "utf8");
const welcomeStyles = fs.readFileSync(new URL("../app/welcome/sales-page.module.css", import.meta.url), "utf8");
const atlasStart = fs.readFileSync(new URL("../app/start/page.tsx", import.meta.url), "utf8");
const personalStart = fs.readFileSync(new URL("../app/start/personal/page.tsx", import.meta.url), "utf8");
const organizationStart = fs.readFileSync(new URL("../app/start/organization/page.tsx", import.meta.url), "utf8");
const loginClient = fs.readFileSync(new URL("../app/login/LoginClient.tsx", import.meta.url), "utf8");
const loginStyles = fs.readFileSync(new URL("../app/login/login.module.css", import.meta.url), "utf8");
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

test("public Atlas front door is one simple connected-life screen", () => {
  assert.match(welcome, /Connective intelligence for real life/);
  assert.match(welcome, /Atlas puts it back together\./);
  assert.match(welcome, /Your life is already in there\. It just lives in pieces\./);
  assert.match(welcome, /Atlas tells you what needs your attention next and gives your team a clear picture of what’s moving forward\./);
  assert.match(welcome, /One life\. Many circles\. One Atlas\./);
  assert.match(welcome, /personalized around the life you are responsible for/);
  assert.match(welcome, /Atlas can hold the business you\s+run alongside everything else you’re responsible for\./);
  assert.match(welcome, /href="\/start"/);
  assert.equal((welcome.match(/<section/g) ?? []).length, 1);
  assert.doesNotMatch(welcome, /images\.pexels\.com/);
  assert.doesNotMatch(welcome, /<img/);
  assert.doesNotMatch(welcome, /FUTURE LOG/);
  assert.doesNotMatch(welcome, /One ordinary Thursday/);
  assert.doesNotMatch(welcome, /Google Workspace/);
  assert.doesNotMatch(welcome, /Start Organization Atlas/);
  assert.doesNotMatch(welcome, /Begin Personal Atlas/);
  assert.doesNotMatch(welcome, /Begin Organization Atlas/);
  assert.match(welcomeStyles, /min-height: 100svh/);
  assert.match(welcomeStyles, /background: #fff !important/);
});

test("one Atlas start screen asks where onboarding begins only after the sales CTA", () => {
  assert.match(atlasStart, /What are you bringing into Atlas first\?/);
  assert.match(atlasStart, /Atlas is personalized around the person using it/);
  assert.match(atlasStart, />Myself</);
  assert.match(atlasStart, />An organization</);
  assert.match(atlasStart, /href="\/start\/personal"/);
  assert.match(atlasStart, /href="\/start\/organization"/);
  assert.match(atlasStart, /not a choice between two different Atlas products/i);
  assert.match(atlasStart, /welcome\/sales-page\.module\.css/);
  assert.doesNotMatch(atlasStart, /front-door\.module\.css/);
  assert.match(atlasStart, /data-atlas-sales-page="true"/);
  assert.match(welcomeStyles, /\.startChoices/);
  assert.match(proxy, /pathname === "\/start"/);
});

test("personal and organization start pages share the sales-page visual system", () => {
  for (const startPage of [personalStart, organizationStart]) {
    assert.match(startPage, /welcome\/sales-page\.module\.css/);
    assert.doesNotMatch(startPage, /front-door\.module\.css/);
    assert.match(startPage, /data-atlas-sales-page="true"/);
    assert.match(startPage, /styles\.brandBar/);
    assert.match(startPage, /styles\.startContent/);
    assert.match(startPage, /styles\.startChoices/);
  }
  assert.match(welcomeStyles, /\.startDisabled/);
  assert.match(welcomeStyles, /\.startNote a/);
});

test("login uses the same restrained public Atlas branding", () => {
  assert.match(loginClient, /data-atlas-login-page="true"/);
  assert.match(loginClient, /styles\.brandBar/);
  assert.match(loginClient, /styles\.brand/);
  assert.match(loginClient, /href="\/welcome"/);
  assert.match(loginClient, /href="\/start"/);
  assert.match(loginStyles, /background: #fff !important/);
  assert.match(loginStyles, /width: min\(1120px, 100%\)/);
  assert.match(loginStyles, /letter-spacing: 0\.32em/);
  assert.match(loginStyles, /border-radius: 0/);
  assert.doesNotMatch(loginStyles, /radial-gradient/);
  assert.doesNotMatch(loginStyles, /#553267|#715682|#40234f/);
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
