import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/atlas/objects/[objectKey]/maintenance-directives/route.ts", import.meta.url), "utf8");

test("object maintenance authoring is explicitly owner and manager scoped", () => {
  assert.match(route, /allowedRoles: \["owner", "manager"\]/);
});
