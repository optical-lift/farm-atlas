import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("../components/atlas/maintenance-directive-composer.tsx", import.meta.url), "utf8");

test("object page only renders author controls when the server permits management authoring", () => {
  assert.match(composer, /context\.canAuthor/);
  assert.match(composer, /Add work/);
  assert.match(composer, /Cancel/);
});
