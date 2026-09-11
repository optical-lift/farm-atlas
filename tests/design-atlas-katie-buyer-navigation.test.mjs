import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bridge = await readFile(new URL("../app/owner/design-atlas/BridgeAtlasFixture.tsx", import.meta.url), "utf8");
const buyerRoute = await readFile(new URL("../app/owner/design-atlas/katie-buyer/page.tsx", import.meta.url), "utf8");
const buyerNotebook = await readFile(new URL("../app/owner/design-atlas/KatieBuyerNotebookFixture.tsx", import.meta.url), "utf8");
const orderRoute = await readFile(new URL("../app/owner/design-atlas/katie-order/page.tsx", import.meta.url), "utf8");

test("Design Atlas exposes customer profile and order entry as distinct Katie destinations", () => {
  assert.match(bridge, /Open Katie’s buyer profile/);
  assert.match(bridge, /\/owner\/design-atlas\/katie-buyer/);
  assert.match(bridge, /Open Katie’s order-entry proof/);
  assert.match(bridge, /\/owner\/design-atlas\/katie-order/);
  assert.match(buyerRoute, /KatieBuyerNotebookFixture/);
  assert.doesNotMatch(buyerRoute, /KatieBuyerProfileFixture/);
  assert.match(orderRoute, /KatieOrderFixture/);
});

test("Katie buyer profile uses the new person-owned notebook grammar", () => {
  assert.match(buyerNotebook, /PersonAtlasNotebookV2/);
  assert.match(buyerNotebook, /pageKicker="BUYER RECORD"/);
  assert.match(buyerNotebook, /label: "IDENTITY"/);
  assert.match(buyerNotebook, /label: "PEOPLE"/);
  assert.match(buyerNotebook, /label: "ACCOUNT"/);
  assert.match(buyerNotebook, /label: "RELATIONSHIP"/);
  assert.match(buyerNotebook, /label: "COMMERCIAL"/);
  assert.match(buyerNotebook, /Buyer contact is not identified yet/);
  assert.match(buyerNotebook, /invoice setup is still incomplete/);
  assert.match(buyerNotebook, /nothing reserved/);
});
