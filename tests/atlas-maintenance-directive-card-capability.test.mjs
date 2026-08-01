import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("../components/atlas/maintenance-directive-composer.tsx", import.meta.url), "utf8");

test("composer offers only maintenance cards the object can actually own", () => {
  assert.match(composer, /context\.capabilities\.weed/);
  assert.match(composer, /context\.capabilities\.mow/);
});
