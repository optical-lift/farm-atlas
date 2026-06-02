export type AnchorKind =
  | "property-corner"
  | "building-corner"
  | "field-corner"
  | "driveway-edge"
  | "fixed-point"
  | "crosscheck";

export type MapAnchor = {
  id: string;
  label: string;
  kind: AnchorKind;
  x: number; // image pixel coordinate
  y: number; // image pixel coordinate
  note?: string;
};

export const anchors: MapAnchor[] = [
  {
    id: "property-nw",
    label: "Property NW Corner",
    kind: "property-corner",
    x: 120,
    y: 90,
  },
  {
    id: "property-ne",
    label: "Property NE Corner",
    kind: "property-corner",
    x: 2220,
    y: 100,
  },
  {
    id: "property-se",
    label: "Property SE Corner",
    kind: "property-corner",
    x: 2260,
    y: 1480,
  },
  {
    id: "property-sw",
    label: "Property SW Corner",
    kind: "property-corner",
    x: 100,
    y: 1500,
  },
  {
    id: "house-nw",
    label: "House NW Corner",
    kind: "building-corner",
    x: 300,
    y: 240,
  },
  {
    id: "house-ne",
    label: "House NE Corner",
    kind: "building-corner",
    x: 430,
    y: 240,
  },
  {
    id: "house-se",
    label: "House SE Corner",
    kind: "building-corner",
    x: 430,
    y: 360,
  },
  {
    id: "house-sw",
    label: "House SW Corner",
    kind: "building-corner",
    x: 300,
    y: 360,
  },
  {
    id: "field-nw",
    label: "Main Field NW Corner",
    kind: "field-corner",
    x: 650,
    y: 520,
  },
  {
    id: "field-se",
    label: "Main Field SE Corner",
    kind: "field-corner",
    x: 1200,
    y: 980,
  },
];