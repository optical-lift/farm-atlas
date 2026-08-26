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

test("Setup uses the standard Task Card completion contract when executable and explicitly suppresses it when blocked", () => {
  assert.match(siteLayout, /\{executable \? \([\s\S]*?<AtlasTaskCardFrame[\s\S]*?onDone=\{\(\) => void transition\("done"\)\}[\s\S]*?onUnfinished=\{\(\) => setUnfinishedOpen[\s\S]*?completionDisabled=\{saving\}/);
  assert.match(siteLayout, /<AtlasTaskCardFrame family="Setup" title=\{action\} subtitle=\{subtitle\} completion=\{false\}>/);
  assert.doesNotMatch(siteLayout, /atlas-setup-finish-buttons/);
  assert.doesNotMatch(siteLayout, /const completion = executable/);
});
