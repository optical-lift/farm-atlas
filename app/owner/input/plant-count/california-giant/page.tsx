import { PLANT_COUNT_FIXTURE_CONTRACTS } from "@/lib/atlas/input-contracts/plant-count-fixture";

import PersonAtlasInputSpread from "../../../PersonAtlasInputSpread";

export default function CaliforniaGiantPlantCountInputPage() {
  return (
    <PersonAtlasInputSpread
      contract={PLANT_COUNT_FIXTURE_CONTRACTS["california-giant"]}
      returnHref="/owner/design-atlas/plant-count"
      returnLabel="plant counts"
      recordLabel="record"
    />
  );
}
