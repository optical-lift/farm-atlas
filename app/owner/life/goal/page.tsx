import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";
import { PERSON_GOAL_INPUT_CONTRACT } from "@/lib/atlas/input-contracts/person-life";

export default function PersonGoalInputPage() {
  return (
    <PersonAtlasInputSpread
      contract={PERSON_GOAL_INPUT_CONTRACT}
      returnHref="/owner/life"
      returnLabel="personal atlas"
      recordLabel="record goal"
      submission={{
        endpoint: "/api/atlas/person-life",
        body: { action: "goal" },
        valueMap: { text: "goal" },
        sourceKeyPrefix: "person-goal",
      }}
    />
  );
}
