import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const retiredFiles = [
  join(root, "components/atlas/dominion-assigned-task-detail.tsx"),
  join(root, "components/atlas/task-dominion-trail.tsx"),
];

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

test("retired Dominion task surfaces are gone", () => {
  for (const file of retiredFiles) assert.equal(existsSync(file), false, file);
});

test("Atlas source no longer imports the Dominion execution compatibility layer", () => {
  const files = [
    ...sourceFiles(join(root, "app")),
    ...sourceFiles(join(root, "components/atlas")),
    ...sourceFiles(join(root, "lib/atlas")),
  ];
  const offenders = files.filter((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes("dominion-assigned-task-detail")
      || source.includes("task-dominion-trail")
      || source.includes("DominionAssignedTaskDetail")
      || source.includes("TaskDominionTrail");
  });
  assert.deepEqual(offenders, []);
});
