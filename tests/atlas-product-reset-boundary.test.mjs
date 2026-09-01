import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxy = readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("../app/reset/page.tsx", import.meta.url), "utf8");
const resetSurface = readFileSync(new URL("../app/AtlasProductReset.tsx", import.meta.url), "utf8");
const appFrame = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");

test("the reset decommissions the legacy page tree without deleting backend authority", () => {
  assert.match(proxy, /const ATLAS_PRODUCT_RESET = true/);
  assert.match(proxy, /destination\.pathname = "\/reset"/);
  assert.match(proxy, /pathname !== "\/reset"[\s\S]*NextResponse\.redirect\(resetRootUrl\(request\)\)/);
  assert.match(resetSurface, /previous product surface has been decommissioned/i);
  assert.match(resetSurface, /data and system history remain preserved/i);
});

test("only the retained owner identity may render the reset front door", () => {
  assert.match(resetPage, /session\.email\?\.toLowerCase\(\) !== "lexprjct@gmail\.com"/);
  assert.match(resetPage, /access_decommissioned/);
});

test("inactive Atlas profiles are denied even when an auth token still exists", () => {
  assert.match(proxy, /from\("user_profiles"\)[\s\S]*select\("active"\)/);
  assert.match(proxy, /profile\?\.active !== true/);
  assert.match(proxy, /Atlas access is decommissioned for this account/);
});

test("the legacy global navigation shell does not mount on the reset surface", () => {
  assert.match(appFrame, /HIDDEN_PATHS = \[[^\]]*"\/reset"/);
});
