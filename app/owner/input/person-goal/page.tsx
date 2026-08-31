import { PERSON_GOAL_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/person-goal-live";

import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

export default function PersonGoalInputSpreadPage() {
  return (
    <PersonAtlasInputSpread
      contract={PERSON_GOAL_INPUT_CONTRACT}
      returnHref="/owner/life"
      returnLabel="personal atlas"
      recordLabel="record goal"
      submission={{
        endpoint: "/api/atlas/person-life",
        body: { action: "goal" },
        sourceKeyPrefix: "person-goal",
        valueMap: { text: "goal_text" },
      }}
    />
  );
}
