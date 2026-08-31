import { HOUSEHOLD_LIVING_ROOM_ZONE_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/household-zone-fixture";

import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

export default function HouseholdZoneInputSpreadPage() {
  return <PersonAtlasInputSpread contract={HOUSEHOLD_LIVING_ROOM_ZONE_INPUT_CONTRACT} />;
}
