export type OnboardingMeasurementTemplate = {
  id: string;
  label: string;
  description: string;
  required: boolean;
};

export const onboardingMeasurementTemplate: OnboardingMeasurementTemplate[] = [
  {
    id: "property-width",
    label: "Property Width",
    description: "Leftmost usable property edge to rightmost usable property edge.",
    required: true,
  },
  {
    id: "property-depth",
    label: "Property Depth",
    description: "Top usable property edge to bottom usable property edge.",
    required: true,
  },
  {
    id: "house-width",
    label: "House Width",
    description: "Main house footprint width.",
    required: true,
  },
  {
    id: "house-depth",
    label: "House Depth",
    description: "Main house footprint depth.",
    required: true,
  },
  {
    id: "driveway-width",
    label: "Driveway Width",
    description: "Typical driveway width.",
    required: true,
  },
  {
    id: "house-to-field",
    label: "House to Main Field",
    description: "Distance from house edge to first production field edge.",
    required: true,
  },
  {
    id: "main-field-width",
    label: "Main Field Width",
    description: "Total width of the main production field.",
    required: true,
  },
  {
    id: "main-field-depth",
    label: "Main Field Depth",
    description: "Total depth of the main production field.",
    required: true,
  },
  {
    id: "row-spacing",
    label: "Standard Row Spacing",
    description: "Center-to-center spacing between main production rows.",
    required: true,
  },
  {
    id: "crosscheck-distance",
    label: "Crosscheck Distance",
    description: "One long fixed distance used to validate the scale.",
    required: true,
  },
];