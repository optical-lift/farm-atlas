import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260728224500_universal_trail_foundation_v1.sql";

test("Atlas has one evidence-backed Trail contract instead of feature-owned timelines", () => {
  const migration = read(migrationPath);
  const contract = read("lib/atlas/trail.ts");
  const renderer = read("components/atlas/trail/AtlasTrail.tsx");
  const layout = read("app/layout.tsx");

  for (const table of [
    "trail_profiles",
    "trail_profile_nodes",
    "trail_bindings",
    "trail_evidence_links",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists atlas\\.${table}`, "i"));
  }

  assert.match(migration, /evidence_status in \('accepted','pending','rejected','retracted'\)/i);
  assert.match(migration, /create or replace function atlas\.trail_context_v1/i);
  assert.match(migration, /create or replace function atlas\.task_trail_context_v2/i);
  assert.match(migration, /create or replace function atlas\.project_trail_context_v2/i);
  assert.match(migration, /insert into atlas\.trail_evidence_links/i);
  assert.match(migration, /'accepted'/i);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);

  assert.match(contract, /export type AtlasTrailContext/);
  assert.match(contract, /complete.*current.*projected.*blocked.*care.*skipped.*unresolved/s);
  assert.match(contract, /atlasTrailFromTendingTrack/);
  assert.match(renderer, /data-atlas-trail-profile/);
  assert.match(renderer, /data-status=\{node\.status\}/);
  assert.match(renderer, /unresolvedEvidenceCount/);
  assert.match(layout, /import "\.\/atlas-trail\.css"/);
});

test("Tending and Dominion tasks render the shared Trail without inventing one-time sequences", () => {
  const tending = read("app/collections/weeding/[zoneKey]/[objectKey]/page.tsx");
  const dominion = read("components/atlas/task-dominion-trail.tsx");

  assert.match(tending, /import AtlasTrail from "@\/components\/atlas\/trail\/AtlasTrail"/);
  assert.match(tending, /atlasTrailFromTendingTrack\(bed, taskHref\)/);
  assert.match(tending, /<AtlasTrail context=\{trail\} mode="full" title="Path to harvest"/);
  assert.doesNotMatch(tending, /gateSymbol|bed\.gates\.map/);

  assert.match(dominion, /import AtlasTrail from "@\/components\/atlas\/trail\/AtlasTrail"/);
  assert.match(dominion, /fetchTendingTaskContext\(task\.task_id, objectKey\)/);
  assert.match(dominion, /track \? atlasTrailFromTendingTrack\(track\) : null/);
  assert.match(dominion, /<AtlasTrail context=\{trail\} mode="compact"/);
  assert.match(dominion, /No linked Trail/);
  assert.doesNotMatch(dominion, /atlasRouteKeyForTask|route !== "weed"/);
  assert.doesNotMatch(dominion, /atlas-task-dominion-track/);
});

test("projects keep the shared Trail underneath the World and Quest reality layer", () => {
  const migration = read(migrationPath);
  const portfolio = read("lib/atlas/portfolio.ts");
  const projectPage = read("app/project/[projectId]/page.tsx");
  const taskTools = read("components/atlas/portfolio/ProjectTaskTools.tsx");
  const taskFocus = read("components/atlas/project-task-focus.tsx");
  const renderer = read("components/atlas/trail/AtlasTrail.tsx");

  assert.match(migration, /'trail', atlas\.project_trail_context_v2\(p\.id\)/i);
  assert.match(migration, /'currentMove'/i);
  assert.match(migration, /'nextNode'/i);
  assert.match(migration, /resolved_status in \('current','blocked'\)/i);
  assert.match(portfolio, /trail: AtlasTrailContext \| null/);

  // The project page now leads with strategic reality state, but the underlying
  // executable project controls still receive the one canonical Trail contract.
  assert.match(projectPage, /What has to become true next/);
  assert.match(projectPage, /Moves advancing this/);
  assert.match(projectPage, /All project work \+ controls/);
  assert.match(projectPage, /steps=\{detail\.steps\}/);
  assert.match(projectPage, /trail=\{project\.trail\}/);
  assert.doesNotMatch(projectPage, /<AtlasTrail|styles\.trail|Milestones and work/);

  assert.match(taskTools, /atlas-day-route-spine atlas-project-route-spine/);
  assert.match(taskTools, /\/task-focus\/\$\{encodeURIComponent\(task\.taskId\)\}/);
  assert.match(taskFocus, /<AtlasTrail context=\{project\.trail\} mode="compact"/);
  assert.match(taskFocus, /Current move/);

  assert.match(renderer, /const playable = \(node\.status === "current" \|\| node\.status === "blocked"\)/);
  assert.doesNotMatch(renderer, /node\.status === "projected".*<Link/s);
});
