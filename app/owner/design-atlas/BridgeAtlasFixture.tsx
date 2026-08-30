"use client";

import PersonAtlasChassis, {
  type PersonAtlasReservedSpan,
  type PersonAtlasSection,
  type PersonAtlasTimeMark,
  type PersonAtlasUtilityGroup,
} from "../PersonAtlasChassis";

type BridgeAtlasFixtureProps = {
  onOpenWorkshop: () => void;
};

const SECTIONS: PersonAtlasSection[] = [
  {
    label: "MORNING",
    lines: [
      {
        id: "kitchen-reset",
        sentence: "Reset the kitchen before the school run",
        state: "done",
        worksheet: {
          kicker: "HOUSEHOLD",
          facts: [
            { label: "Jurisdiction", value: "Mara's private household" },
            { label: "Visibility", value: "Private" },
            { label: "Result", value: "Completed in this fixture" },
          ],
        },
      },
      {
        id: "studio-gallery",
        sentence: "Send the Harper gallery note before 10",
        state: "open",
        worksheet: {
          kicker: "WILD JUNIPER STUDIO",
          facts: [
            { label: "Jurisdiction", value: "Mara's own business" },
            { label: "Responsibility", value: "Principal + execution" },
            { label: "Time truth", value: "Customer promise before 10 AM" },
            { label: "Feast Guild visibility", value: "None" },
          ],
        },
      },
    ],
  },
  {
    label: "MIDDAY",
    lines: [
      {
        id: "receive-flowers",
        sentence: "Receive 14 Feast Guild flower bundles at 10:30",
        state: "now",
        worksheet: {
          kicker: "FEAST GUILD · SPRINGFIELD DISTRIBUTION",
          facts: [
            { label: "Jurisdiction", value: "Feast Guild" },
            { label: "Seat", value: "Springfield distribution · Flow-primary" },
            { label: "Time truth", value: "Inventory handoff at 10:30 AM" },
            { label: "Institution may see", value: "Receipt, quantity, custody, fulfillment result" },
            { label: "Institution may not see", value: "Private household or training details" },
          ],
          note: "The company contributes a lawful claim into Mara's day. It does not become the boundary of Mara's Atlas.",
        },
      },
      {
        id: "deliver-ruth",
        sentence: "Deliver Ruth’s 8 bundles before 1",
        state: "open",
        worksheet: {
          kicker: "FEAST GUILD · BUYER HANDOFF",
          facts: [
            { label: "Jurisdiction", value: "Feast Guild" },
            { label: "Buyer", value: "Ruth's Flowers" },
            { label: "Commitment", value: "8 bundles" },
            { label: "Hard edge", value: "Fulfill before 1 PM" },
            { label: "Shared truth", value: "Order, custody and handoff may return to Feast Guild" },
          ],
        },
      },
    ],
  },
  {
    label: "AFTERNOON",
    lines: [
      {
        id: "school-pickup",
        sentence: "Pick up the kids at 2:45",
        state: "open",
        worksheet: {
          kicker: "PRIVATE",
          facts: [
            { label: "Jurisdiction", value: "Mara's private life" },
            { label: "Visibility", value: "Private" },
            { label: "Time effect", value: "Blocks 2:45–3:45 PM" },
            { label: "What Feast Guild receives", value: "Only the relevant unavailable window if needed" },
          ],
          note: "Shared scheduling intelligence does not require sharing the private reason for the constraint.",
        },
      },
      {
        id: "studio-supplier",
        sentence: "Choose the print supplier for Wild Juniper Studio",
        state: "open",
        worksheet: {
          kicker: "WILD JUNIPER STUDIO",
          facts: [
            { label: "Jurisdiction", value: "Mara's own business" },
            { label: "Responsibility", value: "Principal decision" },
            { label: "Time truth", value: "Movable before Friday" },
          ],
        },
      },
    ],
  },
  {
    label: "EVENING",
    lines: [
      {
        id: "run",
        sentence: "Run easy for 30 minutes after dinner",
        state: "open",
        worksheet: {
          kicker: "5K TRAINING",
          facts: [
            { label: "Jurisdiction", value: "Mara's personal goal" },
            { label: "Reserved time", value: "7:15–7:45 PM" },
            { label: "Protection", value: "Future-building time; not an employer task" },
            { label: "Institution visibility", value: "None" },
          ],
        },
      },
    ],
  },
];

const TIME_MARKS: PersonAtlasTimeMark[] = [
  { id: "school-run", minute: 7 * 60 + 45, label: "School run", kind: "hard" },
  { id: "studio-note", minute: 9 * 60 + 30, label: "Wild Juniper customer note", kind: "move" },
  { id: "feast-intake", minute: 10 * 60 + 30, label: "Feast Guild inventory handoff", kind: "hard" },
  { id: "ruth-edge", minute: 13 * 60, label: "Ruth's delivery deadline", kind: "hard" },
  { id: "pickup", minute: 14 * 60 + 45, label: "Kids pickup", kind: "hard" },
  { id: "run", minute: 19 * 60 + 15, label: "5K training", kind: "protected" },
];

const RESERVED: PersonAtlasReservedSpan[] = [
  { id: "school", startMinute: 7 * 60 + 45, endMinute: 8 * 60 + 30, label: "Private school-run time" },
  { id: "pickup", startMinute: 14 * 60 + 45, endMinute: 15 * 60 + 45, label: "Private family time" },
  { id: "run", startMinute: 19 * 60 + 15, endMinute: 19 * 60 + 45, label: "Protected training" },
];

export default function BridgeAtlasFixture({ onOpenWorkshop }: BridgeAtlasFixtureProps) {
  const utilityGroups: PersonAtlasUtilityGroup[] = [
    {
      label: "CONNECTED WORLDS",
      items: [
        { label: "Household", detail: "Private · family rhythms and commitments" },
        { label: "Wild Juniper Studio", detail: "Mara's own small business" },
        { label: "Feast Guild", detail: "Linked seat · Springfield distribution" },
        { label: "5K training", detail: "Private goal · protected future capacity" },
      ],
    },
    {
      label: "DESIGN ATLAS",
      items: [
        {
          label: "Open the workshop",
          detail: "Old Clock, Day and task specimens remain available as design archaeology.",
          onSelect: onOpenWorkshop,
        },
        {
          label: "Return to my Atlas",
          detail: "Leave the synthetic bridge person.",
          href: "/owner",
        },
      ],
    },
  ];

  return (
    <PersonAtlasChassis
      identity="MARA'S ATLAS"
      identityDetail="Reference person · household + own business + linked institution"
      pageKicker="THURSDAY"
      pageTitle="Today"
      pageIntro="One finite day. Private life stays private; institutional responsibility still arrives with real authority and real time constraints."
      sections={SECTIONS}
      timeMarks={TIME_MARKS}
      reservedSpans={RESERVED}
      nextHardEdge="next hard edge · Feast Guild 10:30"
      utilityGroups={utilityGroups}
      footer={<>Synthetic reference person. No Elm farm data and no live mutation capability.</>}
      fixtureLabel="DESIGN ATLAS · BRIDGE FIXTURE"
    />
  );
}
