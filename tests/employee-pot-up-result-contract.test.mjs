import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Worker Day distinguishes ordinary Done from governed pot-up output capture", () => {
  const delivery = read("lib/worker-delivery.ts");
  const api = read("app/api/anna/pilot/route.ts");
  const client = read("app/anna/AnnaWorkerDayClient.tsx");

  assert.match(delivery, /result_contract_key/);
  assert.match(delivery, /resultContractKey/);

  assert.match(api, /pot_up_contract/);
  assert.match(api, /complete_pot_up/);
  assert.match(api, /worker_production_pot_up_contract_self_api_v1/);
  assert.match(api, /worker_record_production_pot_up_self_api_v1/);
  assert.match(api, /employee_access_required/);

  assert.match(client, /production_pot_up_v1/);
  assert.match(client, /physicalTrays/);
  assert.match(client, /livingPlants/);
  assert.match(client, /\+ Another tray/);
  assert.match(client, /Save and finish/);
  assert.doesNotMatch(client, /130 Shasta|planned_batch_total/);
});
