import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ownerPage = fs.readFileSync(new URL("../app/owner/page.tsx", import.meta.url), "utf8");
const ownerFixture = fs.readFileSync(new URL("../app/owner/OwnerPersonAtlasFixture.tsx", import.meta.url), "utf8");
const ownerNotebook = fs.readFileSync(new URL("../app/owner/PersonAtlasNotebookV2.tsx", import.meta.url), "utf8");
const ownerSpread = fs.readFileSync(new URL("../app/owner/OwnerNotebookSpread.tsx", import.meta.url), "utf8");
const ownerSpreadStyles = fs.readFileSync(new URL("../app/owner/owner-notebook-spread.module.css", import.meta.url), "utf8");
const ownerOfficeStyles = fs.readFileSync(new URL("../app/owner/owner-office-shell.module.css", import.meta.url), "utf8");
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
  assert.match(ownerSpreadStyles, /\.facingPage,\s*\.toolDock \{\s*display: none;/s);
  assert.match(ownerSpreadStyles, /@media \(min-width: 760px\) and \(min-height: 600px\)/);
  assert.match(ownerSpreadStyles, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(ownerSpreadStyles, /gap: clamp\(30px, 4vw, 54px\)/);
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

test("tablet and desktop expose ten notebook-edge tools with one black active tab", () => {
  for (const label of ["Capture", "Ask", "Find", "Context", "Inbox", "People", "Clock", "Memory", "Waiting", "Commands"]) {
    assert.match(ownerSpread, new RegExp(`label: "${label}"`));
  }
  assert.match(ownerSpread, /data-atlas-owner-tool-tabs="true"/);
  assert.match(ownerSpread, /current === tool\.key \? null : tool\.key/);
  assert.match(ownerSpreadStyles, /\.toolTab \{[\s\S]*background: #fff;/);
  assert.match(ownerSpreadStyles, /\.toolTab\[data-active="true"\] \{[\s\S]*background: #171717;[\s\S]*color: #fff;/);
  assert.match(ownerSpreadStyles, /transition: width 180ms ease/);
});

test("professional shell keeps visible language sparse and opens tools inward from a context rail", () => {
  assert.match(ownerSpread, /data-atlas-context-rail="true"/);
  assert.match(ownerSpread, /aria-label="Atlas context rail"/);
  assert.match(ownerSpread, /className=\{officeStyles\.contextMark\}/);
  assert.match(ownerSpread, /activeContext\.code/);
  assert.match(ownerOfficeStyles, /--atlas-paper: #fbf8f1/);
  assert.match(ownerOfficeStyles, /--atlas-brass: #aa8b54/);
  assert.match(ownerOfficeStyles, /\.contextRail \{[\s\S]*background: #(111516|171717)/);
  assert.match(ownerOfficeStyles, /\.atlasMark::before/);
  assert.match(ownerOfficeStyles, /\.atlasMark::after[\s\S]*border: 1px solid var\(--atlas-brass\)/);
  assert.match(ownerOfficeStyles, /\.toolDock \{[\s\S]*right: var\(--office-rail\) !important/);
  assert.match(ownerOfficeStyles, /flex-direction: row/);
  assert.match(ownerOfficeStyles, /\.toolPanel \{[\s\S]*width: 0 !important/);
  assert.match(ownerOfficeStyles, /\.toolDock\[data-open="true"\] \.toolPanel \{[\s\S]*width: min\(300px, 34vw\) !important/);
  assert.match(ownerOfficeStyles, /\.toolTab \{[\s\S]*border-right: 0 !important/);
  assert.match(ownerOfficeStyles, /\.toolTab\[data-active="true"\] \{[\s\S]*width: 84px !important/);
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
