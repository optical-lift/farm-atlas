"use client";

import type { OwnerPrincipalDecisionProjection } from "@/lib/atlas/owner-principal-decisions";
import PersonAtlasNotebookV2, {
  type PersonAtlasReservedSpan,
  type PersonAtlasSection,
  type PersonAtlasTimeMark,
  type PersonAtlasUtilityGroup,
} from "./PersonAtlasNotebookV2";

const FIXTURE_SECTIONS: PersonAtlasSection[] = [
  {
    label: "NOW",
    lines: [
      {
        id: "review-shell",
        sentence: "Review the first person-owned Atlas shell",
        state: "now",
        worksheet: {
          kicker: "ATLAS DESIGN",
          facts: [
            { label: "Jurisdiction", value: "Personal Atlas / product design" },
            { label: "Why now", value: "The old Owner portal has been replaced by a fixture-only chassis." },
            { label: "Authority", value: "Private design work; no farm mutation attached" },
            { label: "Next proof", value: "Use the live Personal Atlas spread to test Goal + observation capture." },
          ],
          note: "The Today planning lines remain a design fixture. Production-backed Principal decisions now enter separately through the governed decision membrane and do not become NOW merely by existing.",
        },
      },
    ],
  },
  {
    label: "TODAY",
    lines: [
      {
        id: "feast-calendar",
        sentence: "Set September’s Feast Guild booking shape",
        state: "open",
        worksheet: {
          kicker: "FEAST GUILD",
          facts: [
            { label: "Jurisdiction", value: "Feast Guild" },
            { label: "Responsibility", value: "Principal" },
            { label: "Time truth", value: "Belongs today in this fixture" },
            { label: "Private context", value: "Atlas may schedule around private life without disclosing it to Feast Guild." },
          ],
        },
      },
      {
        id: "harvest-white-lite",
        sentence: "Harvest White Lite from BB3–5",
        state: "open",
      },
      {
        id: "household-zone",
        sentence: "Spend 15 minutes in the living room zone",
        state: "open",
      },
      {
        id: "groceries",
        sentence: "Pick up groceries before dinner",
        state: "open",
        worksheet: {
          kicker: "HOUSEHOLD",
          facts: [
            { label: "Jurisdiction", value: "Private household" },
            { label: "Visibility", value: "Private" },
            { label: "Time effect", value: "Consumes personal capacity before evening" },
            { label: "Employer disclosure", value: "None" },
          ],
        },
      },
    ],
  },
  {
    label: "EVENING",
    lines: [
      {
        id: "write-now",
        sentence: "Protect 45 minutes for Write Now chapter work",
        state: "open",
        worksheet: {
          kicker: "WRITE NOW PUBLISHING HOUSE",
          facts: [
            { label: "Jurisdiction", value: "Write Now Publishing House" },
            { label: "Responsibility", value: "Protected future / Principal work" },
            { label: "Reserved time", value: "45 minutes" },
            { label: "Scheduling law", value: "Louder work should not casually consume protected future value." },
          ],
        },
      },
    ],
  },
  {
    label: "WAITING",
    lines: [
      {
        id: "production-wiring",
        sentence: "Keep person-owned state off the Clock until placement authority is proven",
        state: "waiting",
        worksheet: {
          kicker: "BUILD BOUNDARY",
          facts: [
            { label: "State", value: "Deliberately held" },
            { label: "Reason", value: "Goal and observation truth are live; Clock arbitration is not yet connected" },
            { label: "Blocked on", value: "ClockCandidate lifecycle + unified human arbitration proof" },
          ],
        },
      },
    ],
  },
];

const TIME_MARKS: PersonAtlasTimeMark[] = [
  { id: "planning", minute: 9 * 60 + 30, label: "Feast Guild planning", kind: "move" },
  { id: "zone", minute: 16 * 60 + 30, label: "15-minute household zone pass", kind: "move" },
  { id: "groceries", minute: 17 * 60 + 15, label: "Groceries", kind: "move" },
  { id: "dinner", minute: 18 * 60 + 30, label: "Family dinner", kind: "hard" },
  { id: "writing", minute: 20 * 60, label: "Write Now protected block", kind: "protected" },
];

const RESERVED: PersonAtlasReservedSpan[] = [
  { id: "family", startMinute: 18 * 60 + 15, endMinute: 19 * 60 + 30, label: "Private family time" },
];

const BASE_UTILITY_GROUPS: PersonAtlasUtilityGroup[] = [
  {
    label: "COLLECTIONS",
    items: [
      {
        label: "Personal Atlas",
        detail: "Live private Goals · observations · established consequences",
        href: "/owner/life",
      },
      {
        label: "Household",
        detail: "Private home system · state · rules · history",
        href: "/owner/household",
      },
      {
        label: "Feast Guild",
        detail: "Linked institution · Principal responsibility",
      },
      {
        label: "Write Now Publishing House",
        detail: "Owned institution",
      },
      {
        label: "Optical Lift",
        detail: "Owned institution",
      },
    ],
  },
  {
    label: "READ ATLAS",
    items: [
      {
        label: "Ask Atlas",
        detail: "Read-only reality reconciliation · compare a field update with Atlas records",
        href: "/owner/ask-atlas",
      },
    ],
  },
  {
    label: "DESIGN",
    items: [
      {
        label: "Design Atlas",
        detail: "Enter the non-Elm bridge-person fixture and pressure-test the new chassis.",
        href: "/owner/design-atlas",
      },
    ],
  },
];

const BASE_SOURCE_LINKS: Record<string, string> = {
  "harvest-white-lite": "/owner/input/harvest",
  "household-zone": "/owner/input/household-zone",
};

type OwnerPersonAtlasFixtureProps = {
  personName: string;
  principalDecisions: OwnerPrincipalDecisionProjection;
};

export default function OwnerPersonAtlasFixture({ personName, principalDecisions }: OwnerPersonAtlasFixtureProps) {
  const decisionLines: PersonAtlasSection["lines"] = principalDecisions.items.map((decision) => ({
    id: `principal-decision:${decision.candidateKey}`,
    sentence: decision.title,
    state: "open",
    worksheet: {
      kicker: `${decision.portfolioUnitName} · PRINCIPAL DECISION`,
      facts: [
        { label: "Why it reached you", value: decision.reasonForFloor ?? "Explicit Principal admission exists for this source." },
        { label: "Consequence", value: decision.consequence ?? "Not specified by the source." },
        { label: "Authority", value: decision.authorityBasis ?? "Principal authority established by the decision membrane." },
        { label: "Time truth", value: "Decision candidate only · this feed does not claim Clock placement." },
      ],
      note: "Open the governed source sheet to see the canonical decision boundary and any application-owned command.",
    },
  }));

  const sections: PersonAtlasSection[] = decisionLines.length
    ? [FIXTURE_SECTIONS[0], { label: "DECISIONS", lines: decisionLines }, ...FIXTURE_SECTIONS.slice(1)]
    : FIXTURE_SECTIONS;

  const decisionSourceLinks = Object.fromEntries(
    principalDecisions.items.map((decision) => [
      `principal-decision:${decision.candidateKey}`,
      `/owner/decision/${encodeURIComponent(decision.candidateKey)}`,
    ]),
  );

  const utilityGroups: PersonAtlasUtilityGroup[] = [
    ...BASE_UTILITY_GROUPS,
    {
      label: "BUILD STATUS",
      items: [
        {
          label: "Today is hybrid: fixture planning + live Principal decisions",
          detail: `Principal decision membrane: ${principalDecisions.coverageState ?? principalDecisions.state} · ${principalDecisions.items.length} admitted now · partial coverage only · no Clock arbitration. Personal Goals and first-party condition observations remain live through the isolated Personal Atlas spread.`,
        },
      ],
    },
  ];

  return (
    <PersonAtlasNotebookV2
      identity={personName}
      greeting="hello"
      pageTitle="Today"
      sections={sections}
      timeMarks={TIME_MARKS}
      reservedSpans={RESERVED}
      nextHardEdge="next fixed · family 6:30"
      utilityGroups={utilityGroups}
      sourceLinks={{ ...BASE_SOURCE_LINKS, ...decisionSourceLinks }}
    />
  );
}
