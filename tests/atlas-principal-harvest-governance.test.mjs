import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Atlas root governance separates Principal arbitration from farm execution", () => {
  const agents = read("AGENTS.md");

  assert.match(agents, /Principal Operating System/);
  assert.match(agents, /delegated task does \*\*not\*\* become Principal work/i);
  assert.match(agents, /explicit escalation boundary/i);
  assert.match(agents, /Principal Clock and farm Clock are different arbitration systems/i);
  assert.match(agents, /Finish Harvest to a stable production.*harvest.*sale.*fulfillment truth contract/i);
});

test("Harvest Pass 1 preserves readiness truth and rejects stem counting as the canonical flower flow", () => {
  const audit = read("docs/HARVEST_TRUTH_CONTRACT_AUDIT.md");

  assert.match(audit, /Harvest Horizon is forecast\/readiness evidence, not harvested inventory/);
  assert.match(audit, /flower_harvest_batches/);
  assert.match(audit, /flower_harvest_bucket_observations/);
  assert.match(audit, /DEPRECATE AS CANONICAL FLOW/);
  assert.match(audit, /Harvest \+ Count/);
  assert.match(audit, /bucket-equivalent/i);
  assert.match(audit, /Nothing is removed in Pass 1/);
});

test("existing Harvest Horizon and Harvest Watch implementation remain present for extension", () => {
  const horizonPage = read("app/harvest/page.tsx");
  const horizonRoute = read("app/api/atlas/harvest-horizon/route.ts");
  const watchRoute = read("app/api/atlas/harvest-watch/route.ts");

  assert.match(horizonPage, /Harvest Horizon/);
  assert.match(horizonRoute, /crop_harvest_availability/);
  assert.match(horizonRoute, /crop_harvest_events/);
  assert.match(watchRoute, /record_harvest_watch_observation/);
});
