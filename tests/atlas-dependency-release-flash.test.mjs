import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const client = read("lib/atlas/task-transition-client.ts");
const flash = read("components/atlas/task/DependencyReleaseFlash.tsx");
const layout = read("app/layout.tsx");

test("completed source work carries one dependency handoff through the redirect", () => {
  assert.match(client, /ATLAS_DEPENDENCY_RELEASE_FLASH_KEY/);
  assert.match(client, /sessionStorage\.setItem/);
  assert.match(client, /item\.direction === "downstream"/);
  assert.match(client, /item\.state === "counting"/);
  assert.match(client, /input\.transition === "done"/);
});

test("the global confirmation names the result and its real ready time", () => {
  assert.match(flash, /sourceTitle} recorded/);
  assert.match(flash, /downstreamTitle} will be ready at/);
  assert.match(flash, /downstreamTitle} is ready now/);
  assert.match(flash, /timeZone: "America\/Chicago"/);
  assert.match(flash, /sessionStorage\.removeItem/);
  assert.match(layout, /<DependencyReleaseFlash \/>/);
});
