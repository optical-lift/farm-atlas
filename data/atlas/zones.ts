export type AtlasZoneKind =
  | "main_field"
  | "nursery"
  | "hospitality_court";

export type AtlasZoneState =
  | "raw"
  | "measured"
  | "assigned"
  | "prepared"
  | "active";

export type AtlasPoint = {
  x: number;
  y: number;
};

export type AtlasZone = {
  id: string;
  label: string;
  kind: AtlasZoneKind;
  state: AtlasZoneState;
  visibleToGuests: boolean;
  modeBias:
    | "annual_production"
    | "perennial_nursery"
    | "hospitality_showcase";
  childObjectIds: string[];
  polygon: AtlasPoint[];
};

export const atlasZones: AtlasZone[] = [
  {
    id: "main-field",
    label: "Main Field",
    kind: "main_field",
    state: "assigned",
    visibleToGuests: true,
    modeBias: "annual_production",
    childObjectIds: [
      "main-field-west",
      "center-aisle",
      "main-field-east",
      "MW1",
      "MW2",
      "MW3",
      "MW4",
      "MW5",
      "MW6",
      "MW7",
      "MW8",
      "ME1",
      "ME2",
      "ME3",
      "ME4",
      "ME5",
      "ME6",
      "ME7",
      "ME8",
    ],
    polygon: [
      { x: 1231, y: 915 },
      { x: 1723, y: 904 },
      { x: 1752, y: 1237 },
      { x: 1241, y: 1249 },
    ],
  },
  {
    id: "nursery",
    label: "Nursery",
    kind: "nursery",
    state: "assigned",
    visibleToGuests: false,
    modeBias: "perennial_nursery",
    childObjectIds: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8"],
    polygon: [
      { x: 254, y: 895 },
      { x: 592, y: 902 },
      { x: 577, y: 1279 },
      { x: 251, y: 1268 },
    ],
  },
  {
    id: "hospitality-court",
    label: "Hospitality Court",
    kind: "hospitality_court",
    state: "raw",
    visibleToGuests: true,
    modeBias: "hospitality_showcase",
    childObjectIds: [
      "HC_North_L",
      "HC_East_L",
      "HC_South_L",
      "HC_West_L",
      "HC_Center_Hollow",
    ],
    polygon: [
      { x: 909, y: 1371 },
      { x: 1222, y: 1362 },
      { x: 1229, y: 1639 },
      { x: 920, y: 1649 },
    ],
  },
];