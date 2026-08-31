import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bridge = await readFile(new URL("../app/owner/design-atlas/BridgeAtlasFixture.tsx", import.meta.url), "utf8");
const buyerRoute = await readFile(new URL("../app/owner/design-atlas/katie-buyer/page.tsx", import.meta.url), "utf8");
const orderRoute = await readFile(new URL("../app/owner/design-atlas/katie-order/page.tsx", import.meta.url), "utf8");

test("Design Atlas exposes customer profile and order entry as distinct Katie destinations", () => {
  assert.match(bridge, /Open Katie’s buyer profile/);
  assert.match(bridge, /\/owner\/design-atlas\/katie-buyer/);
  assert.match(bridge, /Open Katie’s order-entry proof/);
  assert.match(bridge, /\/owner\/design-atlas\/katie-order/);
  assert.match(buyerRoute, /KatieBuyerProfileFixture/);
  assert.match(orderRoute, /KatieOrderFixture/);
});
