import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/objects/[objectKey]/page.tsx", import.meta.url), "utf8");

test("object-first maintenance authoring lives beside real object and crop context", () => {
  const contents = page.indexOf("What’s here");
  const composer = page.indexOf("<MaintenanceDirectiveComposer");
  const trail = page.indexOf("Path through this place");
  assert.ok(contents >= 0);
  assert.ok(composer > contents);
  assert.ok(trail > composer);
  assert.match(page, /objectKey=\{object\.object_key\}/);
  assert.match(page, /cropCycles=\{cropCycles\}/);
});
