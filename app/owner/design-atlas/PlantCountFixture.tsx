"use client";

import PersonAtlasNotebookV2, {
  type PersonAtlasSection,
  type PersonAtlasUtilityGroup,
} from "../PersonAtlasNotebookV2";

const SECTIONS: PersonAtlasSection[] = [
  {
    label: "COUNT",
    lines: [
      {
        id: "count-living-plants-california-giant",
        sentence: "Count living plants · California Giant / Spec",
        state: "now",
        worksheet: {
          kicker: "CROP CYCLE · MG10",
          facts: [
            { label: "Input", value: "Whole-number living plant count" },
            { label: "Zero", value: "A valid observation when explicitly recorded" },
          ],
        },
      },
      {
        id: "count-living-plants-procut-plum",
        sentence: "Count living plants · ProCut Plum",
        state: "open",
        worksheet: {
          kicker: "CROP CYCLE · Berry Walk Bed 3",
          facts: [
            { label: "Input", value: "Whole-number living plant count" },
            { label: "Zero", value: "A valid observation when explicitly recorded" },
          ],
        },
      },
      {
        id: "count-living-plants-cosmos",
        sentence: "Count living plants · Cosmos",
        state: "open",
        worksheet: {
          kicker: "CROP CYCLE · MG10",
          facts: [
            { label: "Input", value: "Whole-number living plant count" },
            { label: "Zero", value: "A valid observation when explicitly recorded" },
          ],
        },
      },
      {
        id: "count-living-plants-volunteer-celosia",
        sentence: "Count living plants · Volunteer celosia",
        state: "open",
        worksheet: {
          kicker: "CROP CYCLE · MG7",
          facts: [
            { label: "Input", value: "Whole-number living plant count" },
            { label: "Zero", value: "A valid observation when explicitly recorded" },
          ],
        },
      },
    ],
  },
];

const UTILITY_GROUPS: PersonAtlasUtilityGroup[] = [
  {
    label: "DESIGN PROOF",
    items: [
      {
        label: "Return to Design Atlas",
        detail: "Leave the plant-count input proof.",
        href: "/owner/design-atlas",
      },
    ],
  },
];

const SOURCE_LINKS: Record<string, string> = {
  "count-living-plants-california-giant": "/owner/input/plant-count/california-giant",
  "count-living-plants-procut-plum": "/owner/input/plant-count/procut-plum",
  "count-living-plants-cosmos": "/owner/input/plant-count/cosmos",
  "count-living-plants-volunteer-celosia": "/owner/input/plant-count/volunteer-celosia",
};

export default function PlantCountFixture() {
  return (
    <PersonAtlasNotebookV2
      identity="Anna"
      greeting="hello"
      pageKicker="Crop cycle"
      pageTitle="Today"
      dateLabelOverride="input-contract proof"
      sections={SECTIONS}
      timeMarks={[]}
      reservedSpans={[]}
      nextHardEdge="count requires a recorded observation"
      utilityGroups={UTILITY_GROUPS}
      sourceLinks={SOURCE_LINKS}
    />
  );
}
