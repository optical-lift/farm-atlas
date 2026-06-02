import type { AtlasArea } from "./field-types";

export const atlasAreas2026: AtlasArea[] = [
  {
    id: "field_rows",
    label: "Field Rows",
    priority: 1,
    mode: "production",
    currentGoal: "Twenty simple productive beds: sunflowers, zinnias, beans, garlic.",
    guardrail: "Do not dilute this field with experiments.",
    allowedCrops2026: [
      "black oil sunflower",
      "Italian White sunflower",
      "zinnia",
      "bush beans",
      "garlic",
    ],
  },
  {
    id: "main_garden",
    label: "Main Garden",
    priority: 2,
    mode: "hospitality_potager",
    currentGoal: "Path structure first, then annual kitchen/potager abundance.",
    guardrail:
      "Do not skip paths. Do not plant creeping thyme or Snow in Summer into dirty, muddy, high-weed pressure ground.",
    allowedCrops2026: [
      "Muncher cucumber",
      "Louisiana Green Velvet okra",
      "Dark opal basil",
      "chives",
      "zinnias",
      "alyssum",
    ],
  },
  {
    id: "follow_me_to_flowers",
    label: "Follow Me to the Flowers",
    priority: 3,
    mode: "arrival_feature",
    currentGoal: "Make the arches and raised beds read as intentional arrival rhythm.",
    guardrail: "Choose neatness and repetition over plant chaos.",
  },
  {
    id: "entry_billboard_garden",
    label: "Entry Billboard Garden",
    priority: 4,
    mode: "first_impression",
    currentGoal: "Sunflowers, garlic, and a few zinnias after blank slate is readable.",
    guardrail: "Do not overcomplicate. This area needs to announce that Elm is alive and intentional.",
  },
  {
    id: "curve_garden",
    label: "Curve Garden",
    priority: 5,
    mode: "entry_garden",
    currentGoal: "Weed, plant arch crops, and let the existing structure show.",
    guardrail: "Do not redesign midstream.",
  },
  {
    id: "barn_beds",
    label: "Barn Beds",
    priority: 6,
    mode: "suppression_appearance",
    currentGoal: "Cheap bold sunflower rows for intentional fall beauty while Bermuda is suppressed.",
    guardrail: "Do not plant valuable perennials here this year.",
  },
  {
    id: "berry_walk_flower_rows",
    label: "Berry Walk Flower Rows",
    priority: 6,
    mode: "suppression_appearance",
    currentGoal: "Sunflowers in the cleanest beds while watching Bermuda constantly.",
    guardrail: "Do not trust this area too fast.",
  },
  {
    id: "berry_walk_original",
    label: "Berry Walk Original Side",
    priority: 7,
    mode: "salvage_observe",
    currentGoal: "Save poppy seed and salvage catmint/lambs ear/lemon balm before mowing/reset.",
    guardrail: "Do not make grief decisions here.",
  },
  {
    id: "seed_room",
    label: "Seed Room",
    priority: 1,
    mode: "tray_engine",
    currentGoal: "Keep future plugs alive, labeled, and moving forward.",
    guardrail: "Do not let trays become invisible work.",
  },
];

export function getAtlasAreaLabel(areaId: AtlasArea["id"]) {
  return atlasAreas2026.find((area) => area.id === areaId)?.label ?? areaId;
}
