export type ControlPointKind =
  | "property-corner"
  | "building-corner"
  | "field-corner"
  | "driveway-edge"
  | "fixed-point";

export type ImageControlPoint = {
  id: string;
  label: string;
  kind: ControlPointKind;
  x: number;
  y: number;
};

export const imageControlPoints: ImageControlPoint[] = [];