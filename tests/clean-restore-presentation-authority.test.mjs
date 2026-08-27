import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const router = fs.readFileSync("components/atlas/canonical-assigned-task-detail.tsx", "utf8");

test("clean_restore has one reset presentation authority", () => {
  assert.match(router, /function isResetTask\(task: AtlasTaskCard\) \{\s*return task\.operation_class === "clean_restore";\s*\}/);
  assert.match(router, /if \(isResetTask\(props\.task\)\) return <VenueResetTaskDetail \{\.\.\.props\} \/>/);
  assert.doesNotMatch(router, /OneOffFieldWorkTaskDetail/);
  assert.equal(fs.existsSync("components/atlas/one-off-field-work-task-detail.tsx"), false);
});
