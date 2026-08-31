import PersonAtlasInputSpread from "../../PersonAtlasInputSpread";

const HARVEST_ROWS = [
  { id: "bb3", label: "BB3" },
  { id: "bb4", label: "BB4" },
  { id: "bb5", label: "BB5" },
];

export default function HarvestInputSpreadPage() {
  return (
    <PersonAtlasInputSpread
      kind="harvest"
      title="White Lite"
      detail="Barn Beds 3–5 · this morning"
      rows={HARVEST_ROWS}
      totalUnit="stems"
    />
  );
}
