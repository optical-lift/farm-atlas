import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("destination data keeps place identity separate from the handoff contact", () => {
  const destination = read("lib/atlas/task-destination-contact.ts");

  assert.match(destination, /contactName: string \| null/);
  assert.match(destination, /handoffInstruction: string \| null/);
  assert.match(destination, /const name = metadataText\(task, "destination_name"\);/);
  assert.match(destination, /const contactName = metadataText\(task, "contact_name"\);/);
  assert.doesNotMatch(destination, /destination_name"\) \|\| metadataText\(task, "contact_name"\)/);
});

test("destination cards give the handoff contact its own prominent conditional row", () => {
  const component = read("components/atlas/task-destination-contact.tsx");
  const styles = read("components/atlas/task-destination-contact.module.css");

  assert.match(component, /destination\.contactName \|\| destination\.handoffInstruction/);
  assert.match(component, /data-atlas-destination-handoff="true"/);
  assert.match(component, /destination\.contactName \? "Ask for" : "Handoff"/);
  assert.match(component, /<strong>\{destination\.contactName\}<\/strong>/);
  assert.match(styles, /\.handoff \{/);
  assert.match(styles, /border-top:/);
});

test("derived destination subtitles do not repeat a structured handoff contact", () => {
  const card = read("components/atlas/destination-assigned-task-card.tsx");

  assert.match(card, /function stripStructuredHandoff/);
  assert.ok(card.includes("ask\\s+for|hand\\s+"));
  assert.match(card, /destinationSubtitle\(task, destination\?\.contactName \?\? null\)/);
});
