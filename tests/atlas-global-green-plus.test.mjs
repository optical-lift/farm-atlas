import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const add = readFileSync(new URL("../components/atlas/global-atlas-add.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/atlas/global-atlas-add.module.css", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/atlas/object-work-client.ts", import.meta.url), "utf8");

test("the green plus is mounted in the authenticated Atlas shell", () => {
  assert.match(shell, /import GlobalAtlasAdd/);
  assert.match(shell, /<GlobalAtlasAdd\s*\/>/);
  assert.ok(shell.indexOf("<GlobalAtlasAdd") < shell.indexOf("<nav className=\"atlas-context-footer\""));
  assert.match(add, /aria-label="Add to Atlas"/);
  assert.match(styles, /\.floatingButton[\s\S]*background: #6f9562/);
});

test("the plus defaults to sentence-built canonical Work Cards instead of a note form", () => {
  assert.match(add, /useState<AddMode>\("work"\)/);
  assert.match(add, /Build a real sentence/);
  assert.match(add, /Create[\s\S]*selectedAction\.label[\s\S]*selectedZone\?\.label[\s\S]*selectedObject/);
  assert.match(add, /Make a Work Card/);
  assert.match(add, /Document what happened/);
  assert.match(add, /<FieldLogDrawer/);
});

test("global authoring chooses one canonical place before creating work", () => {
  assert.match(add, /fetchAtlasZoneRegistry/);
  assert.match(add, /One canonical object owns this card/);
  assert.match(add, /fetchAtlasObjectWorkContext\(objectKey\)/);
  assert.match(add, /fetchAtlasObjectWorkbench\(objectKey\)/);
  assert.match(add, /createAtlasObjectWork\(objectKey/);
  assert.match(client, /\/api\/atlas\/objects\/\$\{encodeURIComponent\(objectKey\)\}\/work/);
});

test("real crop cycles, people, dates, windows, effort, commitment, and checklists remain attached", () => {
  for (const marker of [
    "Real crop cycles",
    "Assigned to",
    "Farm day",
    "Lockscreen window",
    "Physical size",
    "Checkable steps",
    "Must happen that day",
    "Can float around that day",
    "Bring into Work now",
    "doneDefinition",
    "cropCycleIds",
    "dateCommitment",
  ]) assert.match(add, new RegExp(marker));
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
