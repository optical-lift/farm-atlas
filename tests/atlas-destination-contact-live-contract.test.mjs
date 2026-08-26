import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const destinationSource = readFileSync(new URL("../lib/atlas/task-destination-contact.ts", import.meta.url), "utf8");
const assemblySource = readFileSync(new URL("../lib/atlas/task-move-assembly.ts", import.meta.url), "utf8");
const spineSource = readFileSync(new URL("../components/atlas/task-move-spine.tsx", import.meta.url), "utf8");
const contactSource = readFileSync(new URL("../components/atlas/task-destination-contact.tsx", import.meta.url), "utf8");

test("destination contact is a structured task projection rather than title prose", () => {
  assert.match(destinationSource, /destination_name/);
  assert.match(destinationSource, /destination_address/);
  assert.match(destinationSource, /destination_phone/);
  assert.match(destinationSource, /destination_phone_label/);
  assert.match(destinationSource, /destination_note/);
  assert.match(destinationSource, /display_location/);

  assert.match(assemblySource, /const destination = taskDestinationContact\(task\)/);
  assert.match(assemblySource, /const presentationPlace = destination\?\.headerPlace/);
  assert.match(assemblySource, /destination,/);
  assert.match(assemblySource, /where: destination\?\.headerPlace \|\| baseAssembly\.execution\.where/);
});

test("live Task Move renders destination facts before task-specific method content", () => {
  assert.match(spineSource, /TaskDestinationContact/);
  assert.match(spineSource, /assembly\.destination/);
  assert.match(spineSource, /data-atlas-destination-contact|<TaskDestinationContact/);
  assert.doesNotMatch(contactSource, /href=["']tel:/);
  assert.match(contactSource, /destination\.phoneLabel/);
  assert.match(contactSource, /destination\.phone/);
  assert.match(contactSource, /destination\.note/);
});
