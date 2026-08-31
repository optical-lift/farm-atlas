import {
  createAtlasAuthorityHandoff,
  type AtlasAuthorityHandoff,
} from "@/lib/atlas/authority-handoff";
import type { AtlasInputContract, AtlasInputResultEvent } from "@/lib/atlas/input-contract";

export const SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT: AtlasInputContract = {
  id: "fixture.feast-guild.springfield.flower-order.v2",
  kind: "flower order",
  title: "Springfield flower order",
  detail: "record what the buyer actually ordered",
  source: {
    domain: "buyer-distribution",
    jurisdiction: "institution:feast-guild",
    objectRef: "fixture:feast-guild:springfield-distribution:buyer-desk",
    claimRef: "record-flower-order",
  },
  fields: [
    {
      primitive: "choice",
      id: "buyer",
      label: "buyer",
      options: [
        { value: "ruth", label: "Ruth’s Flowers" },
        { value: "lindas", label: "Linda’s Flowers" },
      ],
    },
    {
      primitive: "quantity",
      id: "sunflowerBundles",
      label: "Sunflower bundles",
      unit: "sale_unit",
      displayUnit: "items",
      displayUnitSingular: "item",
      step: 1,
      minimum: 0,
    },
    {
      primitive: "quantity",
      id: "samples",
      label: "Samples",
      unit: "sale_unit",
      displayUnit: "items",
      displayUnitSingular: "item",
      step: 1,
      minimum: 0,
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "buyer",
      message: "Choose the buyer who placed the order.",
    },
    {
      kind: "minimum_quantity_total",
      fieldIds: ["sunflowerBundles", "samples"],
      minimum: 1,
      message: "Record at least one ordered item.",
    },
  ],
  resultEventType: "atlas.feast_guild.flower_order.result.fixture.v2",
  persistence: "fixture_only",
  sourceContext: {
    surface: "buyer_desk",
    responsibilityGrammar: "flow",
    seat: "springfield_distribution",
    inventoryAuthority: "sellable_inventory_source",
    paymentAuthority: "external_stripe",
  },
};

export type FlowerOrderFixtureBuyer = "ruth" | "lindas";
export type FlowerOrderFixtureLineItem = {
  item: "sunflower_bundle" | "sample";
  quantity: number;
};

export type FlowerOrderFixtureAdjudication = {
  state: "order_recorded";
  todayClaimSatisfied: true;
  buyer: FlowerOrderFixtureBuyer;
  lineItems: FlowerOrderFixtureLineItem[];
  totalItems: number;
  fulfillmentRequired: true;
  inventoryClaimRequired: true;
  inventoryCommitted: false;
  paymentStatus: "not_recorded";
  handoff: AtlasAuthorityHandoff;
};

const BUYER_LABELS: Record<FlowerOrderFixtureBuyer, string> = {
  ruth: "Ruth’s Flowers",
  lindas: "Linda’s Flowers",
};

function nonnegativeQuantity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sourceContextText(event: AtlasInputResultEvent, key: string) {
  const value = event.sourceContext[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Flower-order result is missing source authority context: ${key}`);
  }
  return value.trim();
}

export function adjudicateFlowerOrderFixtureResult(
  event: AtlasInputResultEvent,
): FlowerOrderFixtureAdjudication {
  if (event.eventType !== SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT.resultEventType) {
    throw new Error("Flower-order adjudication received the wrong Atlas result event.");
  }

  const buyer = event.values.buyer;
  if (buyer !== "ruth" && buyer !== "lindas") {
    throw new Error("Flower-order result is missing a confirmed fixture buyer.");
  }

  const bundles = nonnegativeQuantity(event.values.sunflowerBundles);
  const samples = nonnegativeQuantity(event.values.samples);
  const lineItems: FlowerOrderFixtureLineItem[] = [];
  if (bundles > 0) lineItems.push({ item: "sunflower_bundle", quantity: bundles });
  if (samples > 0) lineItems.push({ item: "sample", quantity: samples });

  if (!lineItems.length) {
    throw new Error("Flower-order result contains no ordered items.");
  }

  const totalItems = lineItems.reduce((sum, item) => sum + item.quantity, 0);
  const inventoryAuthority = sourceContextText(event, "inventoryAuthority");
  const paymentAuthority = sourceContextText(event, "paymentAuthority");
  const fulfillmentJurisdiction = sourceContextText(event, "seat");

  const handoff = createAtlasAuthorityHandoff(event, {
    authorityClaims: [
      {
        id: "inventory-availability",
        kind: "inventory_availability",
        authority: inventoryAuthority,
        state: "required",
        payload: {
          buyer,
          lineItems,
          totalItems,
        },
      },
      {
        id: "payment-status",
        kind: "payment_status",
        authority: paymentAuthority,
        state: "not_recorded",
        payload: {
          buyer,
        },
      },
    ],
    institutionalWork: [
      {
        ledger: "company_work",
        state: "open",
        organizationRef: event.source.jurisdiction,
        title: `Fulfill ${BUYER_LABELS[buyer]} flower order`,
        instructions: `Prepare ${totalItems} ordered ${totalItems === 1 ? "item" : "items"} for Springfield distribution. Inventory availability remains with its own authority.`,
        operationClass: "order_fulfillment",
        jurisdictionKey: fulfillmentJurisdiction,
        dependsOnAuthorityClaimIds: ["inventory-availability"],
      },
    ],
  });

  return {
    state: "order_recorded",
    todayClaimSatisfied: true,
    buyer,
    lineItems,
    totalItems,
    fulfillmentRequired: true,
    inventoryClaimRequired: true,
    inventoryCommitted: false,
    paymentStatus: "not_recorded",
    handoff,
  };
}
