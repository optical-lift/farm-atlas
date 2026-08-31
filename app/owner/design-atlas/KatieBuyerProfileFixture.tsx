"use client";

import { useState } from "react";

import styles from "./KatieBuyerProfileFixture.module.css";

type BuyerKey = "mama-jeans-east" | "zimmermans" | "ruths";
type Tone = "good" | "warn" | "purple";

type ContactPerson = {
  name: string;
  role: string;
  phone: string;
  email: string;
  note?: string;
};

type BuyerFixture = {
  key: BuyerKey;
  initials: string;
  displayName: string;
  legalName: string;
  kind: string;
  status: string;
  tone?: Tone;
  market: string;
  address: string;
  phone: string;
  website: string;
  publicRecordNote: string;
  contacts: ContactPerson[];
  accountOwner: string;
  accountId: string;
  customerSince: string;
  lastContact: string;
  currentThread: string;
  waitingOn: string;
  billingAddress: string;
  invoiceEmail: string;
  paymentTerms: string;
  taxStatus: string;
  deliveryNotes: string;
  internalNote: string;
  history: Array<{ date: string; actor: string; channel: string; detail: string }>;
};

const BUYERS: BuyerFixture[] = [
  {
    key: "mama-jeans-east",
    initials: "MJ",
    displayName: "MaMa Jean's Natural Market · East Sunshine",
    legalName: "MaMa Jean's Natural Market",
    kind: "Natural grocery market · retail buyer",
    status: "Prospect · follow-up",
    tone: "purple",
    market: "Springfield, Missouri",
    address: "3530 East Sunshine Street · Springfield, MO 65809",
    phone: "(417) 429-1800",
    website: "mamajeansmarket.com",
    publicRecordNote: "Store address and phone verified from MaMa Jean's public location record.",
    contacts: [
      {
        name: "Buyer contact not identified",
        role: "Produce / local purchasing contact",
        phone: "Not captured",
        email: "Not captured",
        note: "Marshall contacted the East location, but the individual buyer name was not preserved in the source note.",
      },
    ],
    accountOwner: "Katie",
    accountId: "Prospect · no customer number yet",
    customerSince: "No completed sale yet",
    lastContact: "Aug 31 · Marshall · phone",
    currentThread: "Marshall already contacted the East location. Katie owns the next follow-up.",
    waitingOn: "Katie follow-up",
    billingAddress: "Not established · use store address only after buyer confirms",
    invoiceEmail: "Not captured",
    paymentTerms: "Not set",
    taxStatus: "Resale / exemption record not on file",
    deliveryNotes: "Not set",
    internalNote: "Potential fit because MaMa Jean's publicly emphasizes local products. Do not treat that as buyer interest until a person at the store says so.",
    history: [
      { date: "Aug 31", actor: "Marshall", channel: "Phone", detail: "Called the East Sunshine location. The buyer name and call disposition were not captured in the source note." },
      { date: "Aug 31", actor: "Principal", channel: "Assignment", detail: "Springfield relationship follow-up moved to Katie." },
    ],
  },
  {
    key: "zimmermans",
    initials: "ZI",
    displayName: "Zimmerman's",
    legalName: "Zimmerman's · legal name not captured",
    kind: "Retail buyer",
    status: "Warm · waiting",
    tone: "warn",
    market: "Springfield, Missouri",
    address: "Not captured",
    phone: "Not captured",
    website: "Not captured",
    publicRecordNote: "No public business details are being inferred in this fixture.",
    contacts: [
      { name: "Kendall", role: "Manager", phone: "Not captured", email: "Not captured", note: "Said he would take the bouquet offer to the owner." },
      { name: "Owner not identified", role: "Decision maker", phone: "Not captured", email: "Not captured" },
    ],
    accountOwner: "Katie",
    accountId: "Prospect · no customer number yet",
    customerSince: "No completed sale yet",
    lastContact: "Aug 30 · Marshall · phone",
    currentThread: "Kendall is taking the current bouquet offer to the owner.",
    waitingOn: "Buyer",
    billingAddress: "Not established",
    invoiceEmail: "Not captured",
    paymentTerms: "Not set",
    taxStatus: "Resale / exemption record not on file",
    deliveryNotes: "Not set",
    internalNote: "Current offer: 5-stem bouquets at $4 wholesale for suggested resale around $7–8.",
    history: [
      { date: "Aug 30", actor: "Marshall", channel: "Phone", detail: "Spoke with Kendall, the manager. Offered 5-stem bouquets at $4 wholesale for resale around $7–8." },
      { date: "Aug 30", actor: "Kendall", channel: "Outcome", detail: "Said he would talk to the owner." },
    ],
  },
  {
    key: "ruths",
    initials: "RF",
    displayName: "Ruth's Flowers",
    legalName: "Ruth's Flowers · legal name not captured",
    kind: "Florist · retail buyer",
    status: "Waiting on buyer",
    market: "Springfield, Missouri",
    address: "Not captured",
    phone: "Not captured",
    website: "Not captured",
    publicRecordNote: "No public business details are being inferred in this fixture.",
    contacts: [
      { name: "Sue", role: "Buyer contact · role not yet confirmed", phone: "Not captured", email: "Not captured", note: "Store said Sue would call back Monday." },
    ],
    accountOwner: "Katie",
    accountId: "Prospect · no customer number yet",
    customerSince: "No completed sale yet",
    lastContact: "Aug 30 · Marshall · phone",
    currentThread: "Sue said she would call back Monday.",
    waitingOn: "Buyer",
    billingAddress: "Not established",
    invoiceEmail: "Not captured",
    paymentTerms: "Not set",
    taxStatus: "Resale / exemption record not on file",
    deliveryNotes: "Not set",
    internalNote: "Waiting belongs to this buyer relationship; do not manufacture an overdue task while the buyer owes the next movement.",
    history: [
      { date: "Aug 30", actor: "Marshall", channel: "Phone", detail: "Sue was not around. Store said Sue would call back Monday." },
    ],
  },
];

function Badge({ children, tone }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

function SectionHeader({ kicker, title, right }: { kicker: string; title: string; right?: React.ReactNode }) {
  return <header className={styles.sectionHeader}><div><span>{kicker}</span><h2>{title}</h2></div>{right}</header>;
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <article className={wide ? styles.detailWide : undefined}><span>{label}</span><strong>{value}</strong></article>;
}

function BuyerList({ onOpen }: { onOpen: (key: BuyerKey) => void }) {
  return (
    <div className={styles.stack} data-atlas-buyer-profile-list="fixture-only">
      <section className={styles.intro}>
        <span>ELM · BUYER RECORDS</span>
        <h1>Customers + prospects</h1>
        <p>Open the company or person first. Sales activity belongs underneath the customer record, not in place of it.</p>
      </section>
      <section className={styles.card}>
        <SectionHeader kicker="SPRINGFIELD" title="Buyer records" right={<Badge tone="purple">3</Badge>} />
        <div className={styles.buyerList}>
          {BUYERS.map((buyer) => (
            <button type="button" className={styles.buyerRow} onClick={() => onOpen(buyer.key)} key={buyer.key}>
              <span className={styles.avatar}>{buyer.initials}</span>
              <div><strong>{buyer.displayName}</strong><span>{buyer.kind} · {buyer.market}</span></div>
              <Badge tone={buyer.tone}>{buyer.status}</Badge>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function BuyerProfile({ buyer, onBack }: { buyer: BuyerFixture; onBack: () => void }) {
  return (
    <div className={styles.stack} data-atlas-counterparty-profile="future-canonical-v2" data-live-data-binding="none" data-mutation-capability="none">
      <button type="button" className={styles.back} onClick={onBack}>‹ Buyer records</button>

      <section className={styles.customerHero}>
        <span className={styles.heroAvatar}>{buyer.initials}</span>
        <div className={styles.heroIdentity}>
          <span>CUSTOMER / BUYER PROFILE</span>
          <h1>{buyer.displayName}</h1>
          <p>{buyer.kind}</p>
          <div className={styles.heroContact}>
            <span>{buyer.address}</span>
            <span>{buyer.phone}</span>
            <span>{buyer.website}</span>
          </div>
        </div>
        <div className={styles.heroStatus}>
          <Badge tone={buyer.tone}>{buyer.status}</Badge>
          <small>Owner</small>
          <strong>{buyer.accountOwner}</strong>
        </div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="BUSINESS RECORD" title="Who this customer is" />
        <div className={styles.detailGrid}>
          <Detail label="Display name" value={buyer.displayName} />
          <Detail label="Legal / billing name" value={buyer.legalName} />
          <Detail label="Customer type" value={buyer.kind} />
          <Detail label="Market" value={buyer.market} />
          <Detail label="Physical location" value={buyer.address} wide />
          <Detail label="Main phone" value={buyer.phone} />
          <Detail label="Website" value={buyer.website} />
          <Detail label="Atlas customer ID" value={buyer.accountId} wide />
        </div>
        <p className={styles.sourceNote}>{buyer.publicRecordNote}</p>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="CONTACT PEOPLE" title="Who we actually deal with" right={<Badge>{buyer.contacts.length}</Badge>} />
        <div className={styles.contactList}>
          {buyer.contacts.map((contact) => (
            <article className={styles.contactCard} key={`${contact.name}:${contact.role}`}>
              <span className={styles.personAvatar}>{contact.name === "Buyer contact not identified" || contact.name.includes("not identified") ? "?" : contact.name.slice(0, 1)}</span>
              <div className={styles.contactIdentity}>
                <strong>{contact.name}</strong>
                <span>{contact.role}</span>
                {contact.note ? <p>{contact.note}</p> : null}
              </div>
              <div className={styles.contactMethods}>
                <span><b>Phone</b>{contact.phone}</span>
                <span><b>Email</b>{contact.email}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="BILLING + SALES" title="Invoice-account details" right={<Badge tone="warn">Incomplete</Badge>} />
        <div className={styles.detailGrid}>
          <Detail label="Billing address" value={buyer.billingAddress} wide />
          <Detail label="Invoice email" value={buyer.invoiceEmail} />
          <Detail label="Payment terms" value={buyer.paymentTerms} />
          <Detail label="Tax / resale status" value={buyer.taxStatus} wide />
          <Detail label="Customer since" value={buyer.customerSince} />
          <Detail label="Delivery notes" value={buyer.deliveryNotes} />
        </div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="RELATIONSHIP" title="What Atlas knows about the account" right={<Badge tone="purple">Assigned to {buyer.accountOwner}</Badge>} />
        <div className={styles.relationshipLead}>
          <strong>{buyer.currentThread}</strong>
          <p>{buyer.internalNote}</p>
        </div>
        <div className={styles.summaryGrid}>
          <Detail label="Relationship owner" value={buyer.accountOwner} />
          <Detail label="Waiting on" value={buyer.waitingOn} />
          <Detail label="Last contact" value={buyer.lastContact} />
        </div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="COMMERCIAL CONTEXT" title="What we could offer this customer" right={<Badge tone="good">27 Ready</Badge>} />
        <div className={styles.offerRow}>
          <div><span>Current wholesale offer</span><strong>5-stem bouquet</strong><small>Suggested retail $7–8</small></div>
          <b>$4</b>
        </div>
        <div className={styles.inventoryList}>
          <article><div><strong>ProCut Orange sunflower</strong><span>5-stem bunches · published sellable inventory</span></div><b>9</b></article>
          <article><div><strong>Benary's Giant zinnia</strong><span>bunches · published sellable inventory</span></div><b>12</b></article>
          <article><div><strong>Mixed posies</strong><span>prepared this morning · published sellable inventory</span></div><b>6</b></article>
        </div>
        <p className={styles.sourceNote}>Commercial context is subordinate to the customer record. Inventory is visible here, not owned here, and no reservation exists until a buyer actually asks for product.</p>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="COMPANY MEMORY" title="Contact + account history" right={<Badge tone="purple">Across Atlas</Badge>} />
        <div className={styles.historyList}>
          {buyer.history.map((event) => (
            <article className={styles.historyRow} key={`${event.date}:${event.actor}:${event.channel}`}>
              <div className={styles.historyMeta}><span>{event.date}</span><strong>{event.actor}</strong><em>{event.channel}</em></div>
              <p>{event.detail}</p>
            </article>
          ))}
        </div>
        <p className={styles.sourceNote}>Relationship history is company-scoped and source-attributed. Contact history alone does not imply an order, invoice, reservation, fulfillment, or payment.</p>
      </section>
    </div>
  );
}

export default function KatieBuyerProfileFixture() {
  const [selectedKey, setSelectedKey] = useState<BuyerKey | null>("mama-jeans-east");
  const selectedBuyer = BUYERS.find((buyer) => buyer.key === selectedKey) ?? null;
  if (!selectedBuyer) return <BuyerList onOpen={setSelectedKey} />;
  return <BuyerProfile buyer={selectedBuyer} onBack={() => setSelectedKey(null)} />;
}
