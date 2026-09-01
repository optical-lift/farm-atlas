import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ownerPage = fs.readFileSync(new URL("../app/owner/page.tsx", import.meta.url), "utf8");
const ownerFixture = fs.readFileSync(new URL("../app/owner/OwnerPersonAtlasFixture.tsx", import.meta.url), "utf8");
const ownerNotebook = fs.readFileSync(new URL("../app/owner/PersonAtlasNotebookV2.tsx", import.meta.url), "utf8");
const ownerMockup = fs.readFileSync(new URL("../app/owner/OwnerPortalBrandMockup.tsx", import.meta.url), "utf8");

test("owner root is the quiet notebook task page, not a dashboard", () => {
  assert.match(ownerPage, /OwnerPersonAtlasFixture/);
  assert.doesNotMatch(ownerPage, /OwnerPortalBrandMockup/);
  assert.match(ownerFixture, /pageTitle="Today"/);
  assert.match(ownerNotebook, /data-atlas-person-notebook-v2="true"/);
  assert.match(ownerNotebook, /Open Atlas index/);
});

test("the richer owner mockup remains latent and read-only rather than becoming the root", () => {
  assert.match(ownerMockup, /data-atlas-owner-brand-mockup="true"/);
  assert.match(ownerMockup, /DESIGN PREVIEW · READ ONLY/);
  assert.doesNotMatch(ownerMockup, /fetch\s*\(/);
  assert.doesNotMatch(ownerMockup, /createClient|supabase/i);
  assert.match(ownerMockup, /preview only; nothing was written to production/);
});

test("notebook index keeps the governed deeper spreads available", () => {
  for (const href of [
    "/owner/ask-atlas",
    "/owner/life",
    "/owner/household",
    "/owner/design-atlas",
  ]) {
    assert.match(ownerFixture, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`));
  }
});
