"use client";

import PersonAtlasNotebookV2, {
  type PersonAtlasSection,
  type PersonAtlasUtilityGroup,
} from "../PersonAtlasNotebookV2";

const SECTIONS: PersonAtlasSection[] = [
  {
    label: "NOW",
    lines: [
      {
        id: "record-flower-order",
        sentence: "Record the next Springfield flower order",
        state: "now",
      },
    ],
  },
  {
    label: "SOURCE TRUTH",
    lines: [
      {
        id: "order-boundary",
        sentence: "Record the buyer request without pretending commitment, stock, or fulfillment already exists",
        state: "waiting",
        worksheet: {
          kicker: "FEAST GUILD · SPRINGFIELD DISTRIBUTION",
          facts: [
            { label: "Responsibility", value: "Flow" },
            { label: "Demand result", value: "Creates requested demand only" },
            { label: "Commitment", value: "Requires explicit Owner or Manager acceptance" },
            { label: "Inventory", value: "Requires separate reservation authority; this fixture does not claim stock" },
            { label: "Sale / fulfillment", value: "Not recorded until their own authorities say so" },
            { label: "Payment", value: "Not recorded unless the payment authority says so" },
          ],
        },
      },
    ],
  },
];

const UTILITY_GROUPS: PersonAtlasUtilityGroup[] = [
  {
    label: "PROOF",
    items: [
      {
        label: "Buyer Desk source",
        detail: "Ruth’s Flowers and Linda’s Flowers · fixture relationships",
      },
      {
        label: "Return to Design Atlas",
        detail: "Leave Katie’s transaction proof.",
        href: "/owner/design-atlas",
      },
    ],
  },
];

const SOURCE_LINKS: Record<string, string> = {
  "record-flower-order": "/owner/input/flower-order",
};

export default function KatieOrderFixture() {
  return (
    <PersonAtlasNotebookV2
      identity="Katie"
      greeting="hello"
      pageKicker="Springfield distribution"
      pageTitle="Today"
      dateLabelOverride="transaction proof"
      sections={SECTIONS}
      timeMarks={[]}
      reservedSpans={[]}
      nextHardEdge="flow proof · no invented inventory movement"
      utilityGroups={UTILITY_GROUPS}
      sourceLinks={SOURCE_LINKS}
    />
  );
}
