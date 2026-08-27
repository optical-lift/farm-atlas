import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const taskSurfaces = [
  "components/atlas/venue-task-detail.tsx",
  "components/atlas/farm-round-task-detail.tsx",
  "components/atlas/crop-move-task-detail.tsx",
];

const taskStyles = [
  "components/atlas/task-card-venue-rail.module.css",
  "components/atlas/farm-round-task-detail.module.css",
  "components/atlas/crop-move-task-detail.module.css",
];

test("canonical purple issue affordances share InlineIssueDrawer", () => {
  for (const file of taskSurfaces) {
    const source = read(file);
    assert.match(source, /InlineIssueDrawer/, `${file} must use the shared inline issue drawer`);
    assert.doesNotMatch(source, /className=\{[^}]*issueDrawer[^}]*\}/, `${file} must not restore a bespoke issue drawer`);
    assert.doesNotMatch(source, /className=\{[^}]*issuePanel[^}]*\}/, `${file} must not restore a bespoke issue panel`);
  }
});

test("canonical purple issue task styles do not rebuild the shared drawer shell", () => {
  for (const file of taskStyles) {
    const source = read(file);
    assert.doesNotMatch(source, /\.issueDrawer\b/, `${file} must not rebuild the shared purple issue trigger`);
    assert.doesNotMatch(source, /\.issuePanel\b/, `${file} must not rebuild a bounded issue panel`);
  }
});

test("the shared issue primitive owns the purple plus trigger", () => {
  const source = read("components/atlas/inline-issue-drawer.tsx");
  assert.match(source, /<summary aria-label=\{label\}>/);
  assert.match(source, />\+<\/span>/);
});
