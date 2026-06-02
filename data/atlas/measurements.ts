export type MeasurementRecord = {
  id: string;
  label: string;
  value: number;
  unit: "ft" | "beds" | "ratio";
  note?: string;
};

export const measurements: MeasurementRecord[] = [
  {
    id: "main-field-west-bed-count",
    label: "Main Field West Bed Count",
    value: 8,
    unit: "beds",
  },
  {
    id: "main-field-east-bed-count",
    label: "Main Field East Bed Count",
    value: 8,
    unit: "beds",
  },
  {
    id: "nursery-bed-count",
    label: "Nursery Bed Count",
    value: 8,
    unit: "beds",
  },
  {
    id: "center-aisle-width",
    label: "Center Aisle Width",
    value: 6,
    unit: "ft",
    note: "Settled board truth: real operational and visual spine.",
  },
  {
    id: "nursery-bed-width",
    label: "Nursery Bed Width",
    value: 3,
    unit: "ft",
    note: "Settled board truth from the constitution.",
  },
  {
    id: "main-bed-render-width-ratio",
    label: "Main Bed Render Width Ratio",
    value: 1,
    unit: "ratio",
    note: "Keeps both Main Field bed banks visually consistent in the prototype render.",
  },
  {
    id: "nursery-bed-render-width-ratio",
    label: "Nursery Bed Render Width Ratio",
    value: 0.78,
    unit: "ratio",
    note: "Nursery beds render slightly narrower than Main Field production beds.",
  },
];