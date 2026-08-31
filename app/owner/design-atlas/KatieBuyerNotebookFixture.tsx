"use client";

import PersonAtlasNotebookV2, {
  type PersonAtlasSection,
  type PersonAtlasUtilityGroup,
} from "../PersonAtlasNotebookV2";

const SECTIONS: PersonAtlasSection[] = [
  {
    label: "IDENTITY",
    lines: [
      {
        id: "mama-jeans-identity",
        sentence: "MaMa Jean's Natural Market · East Sunshine",
        state: "open",
        worksheet: {
          kicker: "BUYER RECORD · IDENTITY",
          facts: [
            { label: "Display name", value: "MaMa Jean's Natural Market · East Sunshine" },
            { label: "Legal / billing name", value: "MaMa Jean's Natural Market" },
            { label: "Customer type", value: "Natural grocery market · retail buyer" },
            { label: "Market", value: "Springfield, Missouri" },
            { label: "Physical location", value: "3530 East Sunshine Street · Springfield, MO 65809" },
            { label: "Main phone", value: "(417) 429-1800" },
            { label: "Website", value: "mamajeansmarket.com" },
            { label: "Atlas customer state", value: "Prospect · no customer number yet" },
          ],
          note: "Store address and phone are public location facts. A public business record does not establish buyer interest, billing authority, or a sale.",
        },
      },
    ],
  },
  {
    label: "PEOPLE",
    lines: [
      {
        id: "mama-jeans-contact",
        sentence: "Buyer contact is not identified yet",
        state: "open",
        worksheet: {
          kicker: "BUYER RECORD · PEOPLE",
          facts: [
            { label: "Contact name", value: "Not captured" },
            { label: "Likely function", value: "Produce / local purchasing contact · not yet confirmed" },
            { label: "Direct phone", value: "Not captured" },
            { label: "Email", value: "Not captured" },
            { label: "Known source fact", value: "Marshall contacted the East Sunshine location" },
          ],
          note: "Atlas knows the business was contacted. It does not know which buyer Marshall reached or what that person said because the source note did not preserve those facts.",
        },
      },
    ],
  },
  {
    label: "ACCOUNT",
    lines: [
      {
        id: "mama-jeans-account",
        sentence: "Katie owns this prospect; invoice setup is still incomplete",
        state: "open",
        worksheet: {
          kicker: "BUYER RECORD · ACCOUNT",
          facts: [
            { label: "Relationship owner", value: "Katie" },
            { label: "Status", value: "Prospect · follow-up" },
            { label: "Customer since", value: "No completed sale yet" },
            { label: "Billing address", value: "Not established · do not assume the store address is the billing address" },
            { label: "Invoice email", value: "Not captured" },
            { label: "Payment terms", value: "Not set" },
            { label: "Tax / resale status", value: "Resale / exemption record not on file" },
            { label: "Delivery notes", value: "Not set" },
          ],
          note: "These fields belong to the customer account even while they are unknown. Atlas should preserve the gaps rather than manufacture invoice defaults.",
        },
      },
    ],
  },
  {
    label: "RELATIONSHIP",
    lines: [
      {
        id: "mama-jeans-relationship",
        sentence: "Marshall called East Sunshine; Katie owns the next follow-up",
        state: "open",
        worksheet: {
          kicker: "BUYER RECORD · COMPANY MEMORY",
          facts: [
            { label: "Aug 31 · Marshall · phone", value: "Called the East Sunshine location. Buyer name and call disposition were not captured." },
            { label: "Aug 31 · Principal · assignment", value: "Springfield relationship follow-up moved to Katie." },
            { label: "Waiting on", value: "Katie follow-up" },
            { label: "Last contact", value: "Aug 31 · Marshall · phone" },
          ],
          note: "These are company-scoped relationship facts attributed to their source humans. Contact history does not imply an order, invoice, reservation, fulfillment, or payment.",
        },
      },
    ],
  },
  {
    label: "COMMERCIAL",
    lines: [
      {
        id: "mama-jeans-commercial",
        sentence: "$4 / five-stem offer · 27 Ready visible · nothing reserved",
        state: "open",
        worksheet: {
          kicker: "BUYER RECORD · COMMERCIAL CONTEXT",
          facts: [
            { label: "Current sample offer", value: "5-stem bouquet · $4 wholesale" },
            { label: "Suggested resale", value: "$7–8" },
            { label: "Ready · ProCut Orange sunflower", value: "9" },
            { label: "Ready · Benary's Giant zinnia", value: "12" },
            { label: "Ready · Mixed posies", value: "6" },
            { label: "Published Ready total", value: "27" },
            { label: "Inventory claim", value: "None" },
          ],
          note: "Inventory is visible from the buyer record but remains inventory truth. The offer is not a reservation, and no inventory claim exists until the buyer actually requests product through the proper commercial authority.",
        },
      },
    ],
  },
];

const UTILITY_GROUPS: PersonAtlasUtilityGroup[] = [
  {
    label: "BUYER DESK",
    items: [
      {
        label: "Order-entry proof",
        detail: "Separate transaction instrument · records an actual buyer request without inventing inventory or payment truth",
        href: "/owner/design-atlas/katie-order",
      },
      {
        label: "Design Atlas",
        detail: "Return to the notebook design fixtures",
        href: "/owner/design-atlas",
      },
    ],
  },
  {
    label: "AUTHORITY",
    items: [
      {
        label: "Fixture only",
        detail: "No customer schema, cross-account read, order mutation, reservation, invoice, fulfillment, or payment is created by this page.",
      },
    ],
  },
];

export default function KatieBuyerNotebookFixture() {
  return (
    <PersonAtlasNotebookV2
      identity="Katie"
      greeting="buyer dock"
      pageKicker="BUYER RECORD"
      pageTitle="MaMa Jean's · East Sunshine"
      dateLabelOverride="Springfield · prospect"
      sections={SECTIONS}
      utilityGroups={UTILITY_GROUPS}
      showTimeMargin={false}
    />
  );
}
