import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day task body opens canonical Task Focus while the caret owns the context drawer", () => {
  const day = read("app/day/page.tsx");

  assert.match(day, /className="atlas-day-task-open-hit-area"/);
  assert.match(day, /href=\{taskHref\(task, returnTo\)\}/);
  assert.match(day, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(day, /aria-label=\{`Show big picture for \$\{display\.title\}`\}/);
  assert.match(day, /<Link href=\{taskHref\(task, returnTo\)\}>Open full task/);
});

test("Day context drawers carry project goals and Task Move consequences instead of generic evidence fields", () => {
  const day = read("app/day/page.tsx");
  const client = read("lib/atlas/task-cards-client.ts");
  const migration = read("supabase/migrations/20260811121000_atlas_task_move_project_big_picture_v1.sql");

  assert.match(day, />Big picture</);
  assert.match(day, />Project goal</);
  assert.match(day, />Unlocks</);
  assert.match(day, />Waiting on</);
  assert.match(day, />Finish line</);
  assert.match(day, />Right now</);
  assert.doesNotMatch(day, /<dt>Place<\/dt>/);
  assert.doesNotMatch(day, /<dt>Time<\/dt>/);
  assert.doesNotMatch(day, /<dt>Evidence<\/dt>/);
  assert.doesNotMatch(day, /<dt>Effect<\/dt>/);

  assert.match(client, /goalText\?: string \| null/);
  assert.match(client, /outcomeText\?: string \| null/);
  assert.match(client, /currentMilestone\?: string \| null/);
  assert.match(client, /goals\?: AtlasTaskProjectGoalContext\[\]/);

  assert.match(migration, /'goalText', p\.goal_text/);
  assert.match(migration, /'outcomeText', p\.outcome_text/);
  assert.match(migration, /'currentMilestone', p\.current_milestone/);
  assert.match(migration, /from atlas\.project_goals pg/);
});
