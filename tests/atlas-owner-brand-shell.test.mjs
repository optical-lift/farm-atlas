import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ownerPage = fs.readFileSync(new URL("../app/owner/page.tsx", import.meta.url), "utf8");
const ownerMockup = fs.readFileSync(new URL("../app/owner/OwnerPortalBrandMockup.tsx", import.meta.url), "utf8");
const ownerStyles = fs.readFileSync(new URL("../app/owner/owner-portal-brand.module.css", import.meta.url), "utf8");

test("owner root uses the branded person-owned Atlas mockup", () => {
  assert.match(ownerPage, /OwnerPortalBrandMockup/);
  assert.doesNotMatch(ownerPage, /OwnerPersonAtlasFixture/);
  assert.match(ownerMockup, /data-atlas-owner-brand-mockup="true"/);
  assert.match(ownerMockup, /DESIGN PREVIEW · READ ONLY/);
  assert.match(ownerMockup, /One life · every lawful responsibility/);
  assert.match(ownerMockup, /The person is the root/);
});

test("owner mockup exposes the eventual Atlas product surfaces without becoming company-rooted", () => {
  for (const label of ["Today", "Week", "Life", "People", "Work", "Money"]) {
    assert.match(ownerMockup, new RegExp(`label: "${label}"`));
  }
  assert.match(ownerMockup, /Ask Atlas/);
  assert.match(ownerMockup, /Capture/);
  assert.match(ownerMockup, /CONNECTED/);
  assert.match(ownerMockup, /House position/i);
  assert.match(ownerMockup, /Accountability, not surveillance/);
  assert.match(ownerMockup, /Private truth may shape your day without being disclosed/);
  assert.match(ownerMockup, /Delegated work reaches you only after an explicit threshold/);
});

test("owner mockup preserves access to existing governed sub-surfaces", () => {
  for (const href of [
    "/owner/ask-atlas",
    "/owner/continuity",
    "/owner/life",
    "/owner/household",
    "/owner/design-atlas",
  ]) {
    assert.match(ownerMockup, new RegExp(`href="${href.replaceAll("/", "\\/")}"`));
  }
});

test("owner redesign is fixture-only and uses the restrained Atlas brand language", () => {
  assert.doesNotMatch(ownerMockup, /fetch\s*\(/);
  assert.doesNotMatch(ownerMockup, /createClient|supabase/i);
  assert.match(ownerMockup, /preview only; nothing was written to production/);
  assert.match(ownerStyles, /background: #fff/);
  assert.match(ownerStyles, /border-bottom: 1px solid var\(--rule\)/);
  assert.match(ownerStyles, /font-family: var\(--font-geist-sans\)/);
  assert.doesNotMatch(ownerStyles, /radial-gradient|linear-gradient/);
  assert.doesNotMatch(ownerStyles, /box-shadow/);
  assert.doesNotMatch(ownerStyles, /#553267|#715682|#40234f/);
});
