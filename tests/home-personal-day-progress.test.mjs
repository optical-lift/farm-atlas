import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperPath = new URL(
  "../lib/atlas/home-personal-day-progress.ts",
  import.meta.url,
);
const pagePath = new URL("../app/page.tsx", import.meta.url);

test("portfolio Home reads personal completions after cards leave the active feed", async () => {
  const source = await readFile(helperPath, "utf8");

  assert.match(source, /\.from\("tasks"\)/);
  assert.match(source, /\.in\("status", \["open", "blocked", "done"\]\)/);
  assert.match(source, /row\.status === "done"/);
  assert.match(source, /chicagoDateIso\(row\.completed_at \?\? row\.updated_at\)/);
  assert.match(source, /plannedTotal: dealtCount \+ openCount/);
  assert.match(source, /row\.assigned_user_id === viewerUserId/);
  assert.match(source, /membershipIds\.has\(row\.assigned_membership_id\)/);
});

test("Home reconciles the visible oversight summary with authoritative personal progress", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /readAtlasPersonalDayProgress\(visibleHome\)/);
  assert.match(source, /personalDayProgress && baseTaskOverview\.summary\.personalScope/);
  assert.match(source, /dealtCount: personalDayProgress\.dealtCount/);
  assert.match(source, /openCount: personalDayProgress\.openCount/);
  assert.match(source, /plannedTotal: personalDayProgress\.plannedTotal/);
});
