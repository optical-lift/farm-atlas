import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxy = readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("../app/reset/page.tsx", import.meta.url), "utf8");
const resetSurface = readFileSync(new URL("../app/AtlasProductReset.tsx", import.meta.url), "utf8");
const appFrame = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const loginClient = readFileSync(new URL("../app/login/LoginClient.tsx", import.meta.url), "utf8");
const onboardingPage = readFileSync(new URL("../app/onboarding/page.tsx", import.meta.url), "utf8");

test("the reset decommissions the legacy page tree without deleting backend authority", () => {
  assert.match(proxy, /const ATLAS_PRODUCT_RESET = true/);
  assert.match(proxy, /destination\.pathname = "\/reset"/);
  assert.match(proxy, /pathname !== "\/reset"[\s\S]*NextResponse\.redirect\(resetRootUrl\(request\)\)/);
  assert.match(resetSurface, /previous product surface has been decommissioned/i);
  assert.match(resetSurface, /data and system history remain preserved/i);
});

test("only the retained owner identity may render the reset product surface", () => {
  assert.match(resetPage, /session\.email\?\.toLowerCase\(\) !== "lexprjct@gmail\.com"/);
  assert.match(resetPage, /access_decommissioned/);
});

test("inactive Atlas profiles lose product access but keep the public entry surfaces", () => {
  assert.match(proxy, /from\("user_profiles"\)[\s\S]*select\("active"\)/);
  assert.match(proxy, /profile\?\.active !== true/);
  assert.match(proxy, /if \(pathname === "\/"\) \{[\s\S]*NextResponse\.rewrite\(resetWelcomeUrl\(request\)\)/);
  assert.match(proxy, /if \(isPublicPath\(pathname\)\) return response/);
  assert.match(proxy, /Atlas access is decommissioned for this account/);
});

test("sales, start, and login remain readable during the product reset", () => {
  assert.match(proxy, /function isResetPublicPage/);
  assert.match(proxy, /pathname === "\/welcome"/);
  assert.match(proxy, /pathname === "\/start"/);
  assert.match(proxy, /pathname === "\/login"/);
  assert.match(proxy, /if \(isResetPublicPage\(pathname\)\) return response/);
  assert.match(proxy, /if \(!authenticated\) \{[\s\S]*NextResponse\.rewrite\(resetWelcomeUrl\(request\)\)/);
});

test("the retained active account can exercise onboarding during reset", () => {
  assert.match(proxy, /function isResetOnboardingPath/);
  assert.match(proxy, /authenticated && isResetOnboardingPath\(pathname\)/);
  assert.match(onboardingPage, /const ATLAS_PRODUCT_RESET = true/);
  assert.match(onboardingPage, /state\.status === "active" && !ATLAS_PRODUCT_RESET/);
});

test("the legacy global navigation shell does not mount on the reset surface", () => {
  assert.match(appFrame, /HIDDEN_PATHS = \[[^\]]*"\/reset"/);
});

test("the root runtime does not initialize the old Atlas tree during reset", () => {
  assert.match(rootLayout, /const ATLAS_PRODUCT_RESET = true/);
  assert.match(rootLayout, /if \(ATLAS_PRODUCT_RESET\) \{[\s\S]*<body className="min-h-full flex flex-col">\{children\}<\/body>/);
  assert.match(rootLayout, /title: "Atlas"/);
  assert.doesNotMatch(rootLayout, /title: "Atlas · Feast Guild"/);
});

test("the login front door does not advertise the decommissioned product tree", () => {
  assert.match(loginClient, /Atlas is being rebuilt from first principles\./);
  assert.doesNotMatch(loginClient, /href="\/welcome"/);
  assert.doesNotMatch(loginClient, /href="\/start"/);
  assert.doesNotMatch(loginClient, /Create your Atlas/);
});
