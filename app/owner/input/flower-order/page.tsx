import { SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/flower-order-fixture";

import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

export default function FlowerOrderInputSpreadPage() {
  return (
    <PersonAtlasInputSpread
      contract={SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT}
      returnHref="/owner/design-atlas/katie-order"
      returnLabel="Katie’s Atlas"
      recordLabel="record request"
      submission={{
        endpoint: "/api/atlas/flower-demand",
        sourceKeyPrefix: "flower-demand:springfield",
        valueMap: {
          buyer: "buyer",
          requestedForDate: "requestedForDate",
          fulfillmentMode: "fulfillmentMode",
          sunflowerBundles: "sunflowerBundles",
          sunflowerBundleSize: "sunflowerBundleSize",
          samples: "samples",
          sampleForm: "sampleForm",
          sampleBundleSize: "sampleBundleSize",
        },
      }}
    />
  );
}
