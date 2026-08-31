import { HARVEST_WHITE_LITE_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/harvest-fixture";

import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

export default function HarvestInputSpreadPage() {
  return <PersonAtlasInputSpread contract={HARVEST_WHITE_LITE_INPUT_CONTRACT} />;
}
