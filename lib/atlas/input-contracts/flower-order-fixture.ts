import type { AtlasInputContract, AtlasInputResultEvent } from "@/lib/atlas/input-contract";

export const SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT: AtlasInputContract = {
  id: "feast-guild.springfield.flower-demand.v3",
  kind: "flower order",
  title: "Springfield flower order",
  detail: "record what the buyer actually requested",
  source: {
    domain: "buyer-distribution",
    jurisdiction: "institution:feast-guild",
    objectRef: "feast-guild:springfield-distribution:buyer-desk",
    claimRef: "record-flower-demand",
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
      primitive: "date",
      id: "requestedForDate",
      label: "needed on",
    },
    {
      primitive: "choice",
      id: "fulfillmentMode",
      label: "handoff",
      options: [
        { value: "pickup", label: "Pickup" },
        { value: "delivery", label: "Delivery" },
        { value: "immediate_handoff", label: "Immediate handoff" },
      ],
    },
    {
      primitive: "quantity",
      id: "sunflowerBundles",
      label: "Sunflower bundles",
      unit: "sale_unit",
      displayUnit: "bundles",
      displayUnitSingular: "bundle",
      step: 1,
      minimum: 0,
      wholeNumber: true,
    },
    {
      primitive: "choice",
      id: "sunflowerBundleSize",
      label: "stems per sunflower bundle",
      visibleWhen: { fieldId: "sunflowerBundles", greaterThan: 0 },
      options: [
        { value: "5", label: "5 stems" },
        { value: "10", label: "10 stems" },
        { value: "20", label: "20 stems" },
      ],
    },
    {
      primitive: "quantity",
      id: "samples",
      label: "Samples",
      unit: "sale_unit",
      displayUnit: "samples",
      displayUnitSingular: "sample",
      step: 1,
      minimum: 0,
      wholeNumber: true,
    },
    {
      primitive: "choice",
      id: "sampleForm",
      label: "sample form",
      visibleWhen: { fieldId: "samples", greaterThan: 0 },
      options: [
        { value: "stem", label: "Stem" },
        { value: "bundle", label: "Bundle" },
        { value: "posy", label: "Posy" },
        { value: "bouquet", label: "Bouquet" },
        { value: "arrangement", label: "Arrangement" },
      ],
    },
    {
      primitive: "choice",
      id: "sampleBundleSize",
      label: "stems per sample bundle",
      visibleWhen: {
        all: [
          { fieldId: "samples", greaterThan: 0 },
          { fieldId: "sampleForm", equals: "bundle" },
        ],
      },
      options: [
        { value: "5", label: "5 stems" },
        { value: "10", label: "10 stems" },
        { value: "20", label: "20 stems" },
      ],
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "buyer",
      message: "Choose the buyer who placed the order.",
    },
    {
      kind: "required_field",
      fieldId: "requestedForDate",
      message: "Record when the buyer needs the flowers.",
    },
    {
      kind: "required_field",
      fieldId: "fulfillmentMode",
      message: "Choose how the buyer expects to receive the flowers.",
    },
    {
      kind: "minimum_quantity_total",
      fieldIds: ["sunflowerBundles", "samples"],
      minimum: 1,
      message: "Record at least one requested item.",
    },
    {
      kind: "required_field",
      fieldId: "sunflowerBundleSize",
      when: { fieldId: "sunflowerBundles", greaterThan: 0 },
      message: "Choose whether each sunflower bundle contains 5, 10, or 20 stems.",
    },
    {
      kind: "required_field",
      fieldId: "sampleForm",
      when: { fieldId: "samples", greaterThan: 0 },
      message: "Record the physical form of the samples.",
    },
    {
      kind: "required_field",
      fieldId: "sampleBundleSize",
      when: {
        all: [
          { fieldId: "samples", greaterThan: 0 },
          { fieldId: "sampleForm", equals: "bundle" },
        ],
      },
      message: "Choose whether each sample bundle contains 5, 10, or 20 stems.",
    },
  ],
  resultEventType: "atlas.flower_demand.result.v1",
  persistence: "canonical",
  sourceContext: {
    surface: "buyer_desk",
    responsibilityGrammar: "flow",
    seat: "springfield_distribution",
    truthBoundary: "independent_demand",
    supplyClaimed: false,
    workerTimeScheduled: false,
    paymentStatus: "not_recorded",
  },
};

export type FlowerOrderFixtureBuyer = "ruth" | "lindas";
export type FlowerOrderFixtureLineItem = {
  item: "sunflower_bundle" | "sample";
  quantity: number;
  inventoryKind: "bundle" | "stem" | "posy" | "bouquet" | "arrangement";
  stemsPerUnit?: 5 | 10 | 20;
};

export type FlowerOrderFixtureAdjudication = {
  state: "demand_recorded";
  todayClaimSatisfied: true;
  buyer: FlowerOrderFixtureBuyer;
  lineItems: FlowerOrderFixtureLineItem[];
  totalItems: number;
  inventoryCommitted: false;
  saleRecorded: false;
  workerTimeScheduled: false;
  paymentStatus: "not_recorded";
};

function nonnegativeWholeQuantity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function bundleSize(value: unknown): 5 | 10 | 20 | undefined {
  if (value === "5") return 5;
  if (value === "10") return 10;
  if (value === "20") return 20;
  return undefined;
}

export function adjudicateFlowerOrderFixtureResult(event: AtlasInputResultEvent): FlowerOrderFixtureAdjudication {
  if (event.eventType !== SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT.resultEventType) {
    throw new Error("Flower-demand adjudication received the wrong Atlas result event.");
  }

  const buyer = event.values.buyer;
  if (buyer !== "ruth" && buyer !== "lindas") {
    throw new Error("Flower-demand result is missing a confirmed buyer.");
  }

  const bundles = nonnegativeWholeQuantity(event.values.sunflowerBundles);
  const samples = nonnegativeWholeQuantity(event.values.samples);
  const lineItems: FlowerOrderFixtureLineItem[] = [];

  if (bundles > 0) {
    const stemsPerUnit = bundleSize(event.values.sunflowerBundleSize);
    if (!stemsPerUnit) throw new Error("Sunflower bundle demand is missing its bundle size.");
    lineItems.push({ item: "sunflower_bundle", quantity: bundles, inventoryKind: "bundle", stemsPerUnit });
  }

  if (samples > 0) {
    const sampleForm = event.values.sampleForm;
    if (sampleForm !== "stem" && sampleForm !== "bundle" && sampleForm !== "posy" && sampleForm !== "bouquet" && sampleForm !== "arrangement") {
      throw new Error("Sample demand is missing its physical form.");
    }
    const stemsPerUnit = sampleForm === "bundle" ? bundleSize(event.values.sampleBundleSize) : undefined;
    if (sampleForm === "bundle" && !stemsPerUnit) throw new Error("Sample bundle demand is missing its bundle size.");
    lineItems.push({ item: "sample", quantity: samples, inventoryKind: sampleForm, ...(stemsPerUnit ? { stemsPerUnit } : {}) });
  }

  if (!lineItems.length) throw new Error("Flower-demand result contains no requested items.");

  return {
    state: "demand_recorded",
    todayClaimSatisfied: true,
    buyer,
    lineItems,
    totalItems: lineItems.reduce((sum, item) => sum + item.quantity, 0),
    inventoryCommitted: false,
    saleRecorded: false,
    workerTimeScheduled: false,
    paymentStatus: "not_recorded",
  };
}
