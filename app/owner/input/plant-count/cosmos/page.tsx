import { PLANT_COUNT_FIXTURE_CONTRACTS } from "@/lib/atlas/input-contracts/plant-count-fixture";

import PersonAtlasInputSpread from "../../../PersonAtlasInputSpread";

export default function CosmosPlantCountInputPage() {
  return (
    <PersonAtlasInputSpread
      contract={PLANT_COUNT_FIXTURE_CONTRACTS["cosmos"]}
      returnHref="/owner/design-atlas/plant-count"
      returnLabel="plant counts"
      recordLabel="record"
    />
  );
}
