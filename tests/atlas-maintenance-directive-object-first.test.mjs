import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/objects/[objectKey]/page.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/objects/[objectKey]/maintenance-directives/route.ts", import.meta.url), "utf8");

test("maintenance authoring starts from a canonical object key", () => {
  assert.match(page, /objectKey=\{object\.object_key\}/);
  assert.match(route, /p_object_key: objectKey\.trim\(\)/);
});
