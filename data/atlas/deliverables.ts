export type DeliverableState =
  | "impossible"
  | "blocked"
  | "assembling"
  | "ready"
  | "sold"
  | "repeatable"
  | "possible-soon"
  | "concept-only";

export type DeliverableRecord = {
  id: string;
  title: string;
  state: DeliverableState;
  supportedZoneIds: string[];
};

export const deliverables: DeliverableRecord[] = [
  {
    id: "bouquet-path",
    title: "Bouquet Path",
    state: "blocked",
    supportedZoneIds: ["main-field", "nursery"],
  },
  {
    id: "florist-bucket",
    title: "Florist Bucket",
    state: "assembling",
    supportedZoneIds: ["main-field"],
  },
  {
    id: "photo-route",
    title: "Photo Route",
    state: "possible-soon",
    supportedZoneIds: ["hospitality-court"],
  },
  {
    id: "hospitality-scene",
    title: "Hospitality Scene",
    state: "concept-only",
    supportedZoneIds: ["hospitality-court"],
  },
];