import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";
import { PERSON_BODY_OBSERVATION_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/person-life";

export default function PersonBodyObservationInputPage() {
  return (
    <PersonAtlasInputSpread
      contract={PERSON_BODY_OBSERVATION_INPUT_CONTRACT}
      returnHref="/owner/life"
      returnLabel="personal atlas"
      recordLabel="record observation"
      submission={{
        endpoint: "/api/atlas/person-life",
        body: { action: "condition_observation" },
        valueMap: {
          bodyRegion: "bodyRegion",
          observation: "observation",
        },
        sourceKeyPrefix: "person-condition",
      }}
    />
  );
}
