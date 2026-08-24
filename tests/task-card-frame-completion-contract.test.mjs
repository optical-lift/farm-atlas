import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const frame = fs.readFileSync(path.join(root, "components/atlas/task-card-frame.tsx"), "utf8");
const labFrame = fs.readFileSync(path.join(root, "app/owner/task-card-lab/_components/DominionCardFrame.tsx"), "utf8");
const siteLayout = fs.readFileSync(path.join(root, "components/atlas/site-layout-task-detail.tsx"), "utf8");

test("standard Task Card completion requires executable handlers", () => {
  assert.match(frame, /type InteractiveCompletionProps = \{[\s\S]*?onDone: \(\) => void;[\s\S]*?onUnfinished: \(\) => void;/);
  assert.match(frame, /completion\?: never;/);
  assert.match(frame, /onClick=\{props\.onDone\}/);
  assert.match(frame, /onClick=\{props\.onUnfinished\}/);
});

test("nonstandard completion is explicit rather than silently interactive", () => {
  assert.match(frame, /type CustomCompletionProps = \{/);
  assert.match(frame, /completion: Exclude<ReactNode, undefined>;/);
  assert.match(frame, /type PreviewCompletionProps = \{/);
  assert.match(frame, /completionPreview: true;/);
});

test("Task Card Lab owns its visual-only completion exception", () => {
  assert.match(labFrame, /completionPreview/);
  assert.match(frame, /data-atlas-completion-preview="true"/);
  assert.match(frame, /className=\{styles\.primaryFinish\} disabled>Done<\/button>/);
  assert.match(frame, /className=\{styles\.secondaryFinish\} disabled>Unfinished<\/button>/);
});

test("blocked Setup cards explicitly suppress completion instead of falling through to dead controls", () => {
  assert.match(siteLayout, /const completion = executable \?[\s\S]*?\) : false;/);
  assert.match(siteLayout, /completion=\{completion\}/);
  assert.doesNotMatch(siteLayout, /\) : undefined;/);
});
