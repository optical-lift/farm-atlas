import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

const HARVEST_ROWS = [
  { id: "bb3", label: "BB3", step: 0.5 },
  { id: "bb4", label: "BB4", step: 0.5 },
  { id: "bb5", label: "BB5", step: 0.5 },
];

const REMAINS_OPTIONS = [
  { value: "yes", label: "yes" },
  { value: "unsure", label: "not sure" },
  { value: "no", label: "no" },
];

export default function HarvestInputSpreadPage() {
  return (
    <PersonAtlasInputSpread
      kind="harvest"
      title="White Lite"
      detail="Barn Beds 3–5 · ½-bucket counts"
      rows={HARVEST_ROWS}
      totalUnit="buckets"
      followUp={{
        label: "more still out there?",
        options: REMAINS_OPTIONS,
        initialValue: "yes",
      }}
    />
  );
}
