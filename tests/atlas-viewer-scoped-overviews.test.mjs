import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("operational overview routes use the viewer-scoped task reader", () => {
  const client = read("lib/atlas/task-cards-client.ts");
  const route = read("app/api/atlas/home-task-cards/route.ts");

  for (const pathname of ["/day", "/overview/week", "/overview/month"]) {
    assert.match(client, new RegExp(`pathname === "${pathname.replaceAll("/", "\\/")}"`));
  }

  assert.match(client, /viewerOperationalWindow/);
  assert.match(client, /dueThrough/);
  assert.match(client, /doneDate/);
  assert.match(client, /\/api\/atlas\/home-task-cards/);
  assert.doesNotMatch(client, /pathname === "\/day"[\s\S]{0,500}\/api\/atlas\/task-cards/);

  assert.match(route, /new URL\(request\.url\)/);
  assert.match(route, /searchParams\.get\("dueThrough"\)/);
  assert.match(route, /searchParams\.get\("doneDate"\)/);
  assert.match(route, /p_worker_key: workerKey/);
});

test("day overview cannot silently fall back to the mixed farm-wide reader", () => {
  const day = read("app/day/page.tsx");
  const week = read("app/overview/week/page.tsx");
  const month = read("app/overview/month/page.tsx");

  for (const page of [day, week, month]) {
    assert.match(page, /fetchAtlasTaskCards\(\)/);
    assert.doesNotMatch(page, /scope:\s*"all"/);
    assert.doesNotMatch(page, /scope:\s*"farm"/);
  }
});
