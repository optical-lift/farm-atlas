import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const packets = read("lib/atlas/principal-decision-packets.ts");
const projection = read("lib/atlas/owner-principal-decisions.ts");
const ownerPage = read("app/owner/page.tsx");
const ownerFixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
const decisionPage = read("app/owner/decision/[candidateKey]/page.tsx");
const decisionAction = read("app/owner/decision/OwnerPrincipalDecisionAction.tsx");
const workflowRoute = read("app/api/atlas/flower-demand-workflow/route.ts");

test("Owner reads the generic Principal decision membrane instead of flower domain tables", () => {
  assert.match(packets, /principal_decision_packets_api_v1/);
  assert.match(ownerPage, /readOwnerPrincipalDecisionProjection/);
  assert.match(projection, /readAtlasPrincipalDecisionPackets/);
  assert.match(projection, /readAtlasPrincipalSelfContext/);

  for (const source of [packets, projection, ownerPage, ownerFixture, decisionPage]) {
    assert.doesNotMatch(source, /flower_demand_orders|flower_demand_order_lines|flower_demand_allocation_position_v1|flower_sale_orders/);
  }
});

test("admitted Principal decisions enter a separate open section without claiming Clock placement", () => {
  assert.match(ownerFixture, /label: "DECISIONS"/);
  assert.match(ownerFixture, /state: "open"/);
  assert.match(ownerFixture, /Decision candidate only · this feed does not claim Clock placement/);
  assert.doesNotMatch(ownerFixture, /decision\.candidateKey[\s\S]{0,300}state: "now"/);
  assert.match(ownerFixture, /principalDecisions\.items\.map/);
  assert.match(ownerFixture, /partial coverage only · no Clock arbitration/);
});

test("ordinary demand cannot manufacture an Owner line in the application", () => {
  assert.doesNotMatch(ownerFixture, /allocation|allCovered|reservedQuantity|demandOrderId/);
  assert.doesNotMatch(projection, /coverageState === "covered"|reservedQuantity|soldQuantity/);
  assert.match(ownerFixture, /principalDecisions\.items/);
});

test("the Owner decision sheet executes only the code-owned flower Demand to Sale command", () => {
  assert.match(decisionPage, /decision\.commandKind === "flower_demand_commit_to_sale"/);
  assert.match(decisionPage, /decision\.commandContractVersion === "record_flower_sale_from_demand_core_v1"/);
  assert.match(decisionPage, /decision\.commandTargetKind === "flower_demand_order"/);
  assert.match(decisionPage, /decision\.commandTargetId === decision\.sourceId/);
  assert.match(decisionPage, /This decision has no application-owned executable command/);

  assert.match(decisionAction, /\/api\/atlas\/flower-demand-workflow/);
  assert.match(decisionAction, /action: "convert"/);
  assert.match(decisionAction, /data-principal-command="flower_demand_commit_to_sale"/);
  assert.match(workflowRoute, /record_flower_sale_from_demand_for_member_v1/);
  assert.match(workflowRoute, /owner_operator_record_flower_sale_from_demand_v1/);
});

test("Owner execution preserves Sale, fulfillment, and payment boundaries", () => {
  assert.match(decisionAction, /taxAmount: 0/);
  assert.match(decisionAction, /tipAmount: 0/);
  assert.doesNotMatch(decisionAction, /fulfillmentMethod|fulfilledAt|paymentStatus|markPaid/);
  assert.match(decisionAction, /Fulfillment and payment remain separate downstream truth/);
  assert.match(decisionPage, /does not create a Sale, fulfillment event, payment, or Clock placement/);
});

test("cross-surface retries return through the one canonical Sale transition rather than a second app mutation", () => {
  assert.match(decisionAction, /idempotencyKey/);
  assert.match(decisionAction, /crypto\.randomUUID\(\)/);
  assert.match(decisionAction, /already committed to the same canonical Sale/);
  assert.doesNotMatch(decisionAction, /\.from\(|insert\(|update\(/);
  assert.doesNotMatch(workflowRoute, /\.from\("flower_sale_orders"\)\.insert/);
});
