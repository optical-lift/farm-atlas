import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../lib/atlas/maintenance-directives-client.ts", import.meta.url), "utf8");

test("directive clients use object and task scoped routes", () => {
  assert.match(client, /objects\/\$\{encodeURIComponent\(objectKey\)\}\/maintenance-directives/);
  assert.match(client, /maintenance-directives\?taskId=/);
});
