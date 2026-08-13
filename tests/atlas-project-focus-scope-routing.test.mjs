import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portfolio = readFileSync(
  new URL("../lib/atlas/portfolio.ts", import.meta.url),
  "utf8",
);

test("project Task Focus rejects project-linked farm-operation work", () => {
  assert.match(portfolio, /const focus = data as AtlasProjectTaskFocus;/);
  assert.match(portfolio, /focus\.task\.taskScope && focus\.task\.taskScope !== "project"/);
  assert.match(portfolio, /return null;/);
});

test("project Task Focus still accepts true project tasks and legacy scope-omitting payloads", () => {
  assert.match(portfolio, /if \(focus\.task\.taskScope && focus\.task\.taskScope !== "project"\) return null;/);
  assert.match(portfolio, /return focus;/);
});
