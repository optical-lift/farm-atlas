import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ownerPage = fs.readFileSync(new URL("../app/owner/page.tsx", import.meta.url), "utf8");
const ownerFixture = fs.readFileSync(new URL("../app/owner/OwnerPersonAtlasFixture.tsx", import.meta.url), "utf8");
const ownerNotebook = fs.readFileSync(new URL("../app/owner/PersonAtlasNotebookV2.tsx", import.meta.url), "utf8");
const ownerSpread = fs.readFileSync(new URL("../app/owner/OwnerNotebookSpread.tsx", import.meta.url), "utf8");
const ownerSpreadStyles = fs.readFileSync(new URL("../app/owner/owner-notebook-spread.module.css", import.meta.url), "utf8");
const ownerMockup = fs.readFileSync(new URL("../app/owner/OwnerPortalBrandMockup.tsx", import.meta.url), "utf8");

test("owner root remains the quiet notebook task page rather than a dashboard", () => {
  assert.match(ownerPage, /OwnerNotebookSpread/);
  assert.doesNotMatch(ownerPage, /OwnerPortalBrandMockup/);
  assert.match(ownerSpread, /OwnerPersonAtlasFixture/);
  assert.match(ownerFixture, /pageTitle="Today"/);
  assert.match(ownerNotebook, /data-atlas-person-notebook-v2="true"/);
  assert.match(ownerNotebook, /Open Atlas index/);
});

test("tablet and desktop read as two notebook pages while phone stays single-page", () => {
  assert.match(ownerSpread, /data-atlas-open-notebook="true"/);
  assert.match(ownerSpread, /Atlas index facing page/);
  assert.match(ownerSpread, />Index</);
  assert.match(ownerSpreadStyles, /\.facingPage \{\s*display: none;/s);
  assert.match(ownerSpreadStyles, /@media \(min-width: 760px\) and \(min-height: 600px\)/);
  assert.match(ownerSpreadStyles, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(ownerSpreadStyles, /gap: clamp\(34px, 4\.5vw, 58px\)/);
  assert.doesNotMatch(ownerSpreadStyles, /box-shadow|page-curl|leather/i);
});

test("desktop removes web chrome and uses topic, folio, and index grammar", () => {
  assert.doesNotMatch(ownerSpread, /<span>index<\/span>\s*<strong>\{personName\}<\/strong>/s);
  assert.doesNotMatch(ownerSpread, />spreads</i);
  assert.match(ownerSpread, /leftFolio/);
  assert.match(ownerSpread, /Today page 01, active/);
  assert.match(ownerSpread, /facingFolio/);
  assert.match(ownerSpread, /Index page 00/);
  assert.match(ownerSpread, /page: "02"/);
  assert.match(ownerSpread, /page: "11"/);
  assert.match(ownerSpreadStyles, /header:first-child,\s*\.leftPage > main > section > nav:last-child \{\s*display: none !important;/s);
  assert.match(ownerSpreadStyles, /border-bottom: 1px dotted/);
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

  for (const href of ["/owner/ask-atlas", "/owner/life", "/owner/household", "/owner/continuity"]) {
    assert.match(ownerSpread, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`));
  }
});
