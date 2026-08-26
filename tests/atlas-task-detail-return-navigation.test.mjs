import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { atlasTaskCloseDecision, safeAtlasTaskReturnPath } from "../lib/atlas/task-detail-navigation-core.js";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("task detail return paths accept local collections but reject external and recursive task focus destinations", () => {
  assert.equal(safeAtlasTaskReturnPath("/clock?date=2026-08-25"), "/clock?date=2026-08-25");
  assert.equal(safeAtlasTaskReturnPath("/task?route=harvest"), "/task?route=harvest");
  assert.equal(safeAtlasTaskReturnPath("//example.com/clock"), null);
  assert.equal(safeAtlasTaskReturnPath("https://example.com/clock"), null);
  assert.equal(safeAtlasTaskReturnPath("/task-focus/abc"), null);
});

test("an explicit safe returnTo is authoritative", () => {
  assert.deepEqual(atlasTaskCloseDecision({
    search: "?returnTo=%2Fclock%3Fdate%3D2026-08-25",
    referrer: "https://atlas.elmfarm.co/day?date=2026-08-25",
    origin: "https://atlas.elmfarm.co",
    fallbackPath: "/day",
  }), { kind: "return_to", destination: "/clock?date=2026-08-25" });
});

test("an explicit unsafe returnTo falls back instead of trusting browser history", () => {
  assert.deepEqual(atlasTaskCloseDecision({
    search: "?returnTo=https%3A%2F%2Fevil.example%2F",
    referrer: "https://atlas.elmfarm.co/clock",
    origin: "https://atlas.elmfarm.co",
    fallbackPath: "/day",
  }), { kind: "fallback", destination: "/day" });
});

test("browser history is used only without returnTo and only for a safe same-origin prior surface", () => {
  assert.deepEqual(atlasTaskCloseDecision({
    search: "",
    referrer: "https://atlas.elmfarm.co/clock?date=2026-08-25",
    origin: "https://atlas.elmfarm.co",
    fallbackPath: "/day",
  }), { kind: "history", destination: null });

  assert.deepEqual(atlasTaskCloseDecision({
    search: "",
    referrer: "https://outside.example/clock",
    origin: "https://atlas.elmfarm.co",
    fallbackPath: "/day",
  }), { kind: "fallback", destination: "/day" });
});

test("the shared assigned-task header exposes X as the close affordance and delegates navigation to the canonical close client", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const client = read("lib/atlas/task-detail-navigation-client.ts");

  assert.match(shell, /closeAtlasTaskDetail/);
  assert.match(shell, /aria-label="Close task and return"/);
  assert.match(shell, />×<\/Link>/);
  assert.match(shell, /event\.preventDefault\(\);\s*closeAtlasTaskDetail\(assignee\.listPath\);/);
  assert.match(client, /decision\.kind === "history"/);
  assert.match(client, /window\.history\.back\(\)/);
  assert.match(client, /window\.location\.replace\(decision\.destination\)/);
});
