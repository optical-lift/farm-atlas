import { PERSON_BODY_OBSERVATION_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/person-body-observation-live";

import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

export default function PersonBodyObservationInputSpreadPage() {
  return (
    <PersonAtlasInputSpread
      contract={PERSON_BODY_OBSERVATION_INPUT_CONTRACT}
      returnHref="/owner/life"
      returnLabel="personal atlas"
      recordLabel="record observation"
      submission={{
        endpoint: "/api/atlas/person-life",
        body: { action: "condition_observation" },
        sourceKeyPrefix: "person-condition",
        valueMap: {
          bodyRegion: "body_region",
          observation: "observation",
        },
      }}
    />
  );
}
