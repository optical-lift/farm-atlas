import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../components/atlas/home/AtlasUniversalHomeV2.tsx", import.meta.url), "utf8");
const add = readFileSync(new URL("../components/atlas/global-atlas-add.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/atlas/global-atlas-add.module.css", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/atlas/manual-task-client.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/manual-task/route.ts", import.meta.url), "utf8");

test("the one real green plus is mounted in the authenticated Atlas shell", () => {
  assert.match(shell, /import GlobalAtlasAdd/);
  assert.match(shell, /<GlobalAtlasAdd\s*\/>/);
  assert.ok(shell.indexOf("<GlobalAtlasAdd") < shell.indexOf("<nav className=\"atlas-context-footer\""));
  assert.match(add, /aria-label="Add to Atlas"/);
  assert.match(styles, /\.floatingButton[\s\S]*background: #6f9562/);
});

test("the false darker-green Home proxy is gone", () => {
  assert.doesNotMatch(shell, /HomeGreenPlusBridge/);
  assert.doesNotMatch(home, /atlas-note-plus/);
  assert.doesNotMatch(home, /aria-label="Document work"/);
  assert.doesNotMatch(styles, /atlas-note-plus/);
  assert.doesNotMatch(styles, /atlas-home-add-trigger/);
});

test("the plus defaults to sentence-built canonical Work Cards instead of a note form", () => {
  assert.match(add, /useState<AddMode>\("work"\)/);
  assert.match(add, /Build a real sentence/);
  assert.match(add, /Create[\s\S]*selectedAction\.label[\s\S]*selectedZone\?\.label[\s\S]*selectedObject/);
  assert.match(add, /Make a Work Card/);
  assert.match(add, /Document what happened/);
  assert.match(add, /<FieldLogDrawer/);
});

test("global authoring chooses one canonical place before creating a canonical task", () => {
  assert.match(add, /fetchAtlasZoneRegistry/);
  assert.match(add, /One canonical object owns this card/);
  assert.match(add, /fetchAtlasManualTaskContext\(objectKey\)/);
  assert.match(add, /fetchAtlasObjectWorkbench\(objectKey\)/);
  assert.match(add, /createAtlasManualTask\(objectKey/);
  assert.match(client, /\/api\/atlas\/manual-task/);
  assert.match(route, /manual_task_context_v1/);
  assert.match(route, /create_manual_task_v1/);
  assert.match(route, /manual-task-authoring-v1/);
  assert.doesNotMatch(add, /object-work-client/);
});

test("global task creators define the state change instead of a checklist", () => {
  for (const marker of [
    "The state change",
    "Current truth",
    "Truth after completion",
    "currentTruth",
    "afterTruth",
    "Real crop cycles",
    "Assigned to",
    "Farm day",
    "Lockscreen window",
    "Physical size",
    "Must happen that day",
    "Can float around that day",
    "Bring into Work now",
    "cropCycleIds",
    "dateCommitment",
  ]) assert.match(add, new RegExp(marker));
  assert.match(add, /currentTruth\.trim\(\) !== afterTruth\.trim\(\)/);
  assert.doesNotMatch(add, /Checkable steps/);
  assert.doesNotMatch(add, /addStep/);
  assert.doesNotMatch(add, /doneDefinition/);
  assert.doesNotMatch(add, /instructions:/);
  assert.doesNotMatch(add, />Put in Work</);
  assert.doesNotMatch(add, />Hold as planned</);
});

test("Weed and Mow route to persistent maintenance instead of cloning ordinary cards", () => {
  assert.doesNotMatch(add, /key: "weed"/);
  assert.doesNotMatch(add, /key: "mow"/);
  assert.match(add, /Weed and Mow stay attached to their perpetual cards/);
  assert.match(add, /openMaintenance\("weed"\)/);
  assert.match(add, /openMaintenance\("mow"\)/);
  assert.match(add, /router\.push\(`\/objects\/\$\{encodeURIComponent\(objectKey\)\}\?author=\$\{kind\}`\)/);
});

test("workers can still document reality but cannot use the planning endpoint", () => {
  assert.match(add, /context && !context\.canAuthor/);
  assert.match(add, /Planning stays with the Owner or manager/);
  assert.match(add, /Use “Document what happened”/);
  assert.match(add, /context\?\.canAuthor/);
});
