"use client";

import { useState } from "react";

import styles from "./KatieBuyerProfileFixture.module.css";

type BuyerKey = "mama-jeans-east" | "zimmermans" | "ruths";
type Tone = "good" | "warn" | "purple";

type BuyerFixture = {
  key: BuyerKey;
  initials: string;
  name: string;
  city: string;
  state: string;
  tone?: Tone;
  contact: string;
  currentThread: string;
  waitingOn: string;
  history: Array<{ date: string; actor: string; channel: string; detail: string }>;
};

const BUYERS: BuyerFixture[] = [
  {
    key: "mama-jeans-east",
    initials: "MJ",
    name: "Mama Jean's · East",
    city: "Springfield",
    state: "Prospect · follow-up",
    tone: "purple",
    contact: "Not captured",
    currentThread: "Marshall already contacted the East location. Katie owns the follow-up now.",
    waitingOn: "Katie follow-up",
    history: [
      { date: "Aug 31", actor: "Marshall", channel: "Phone", detail: "Called Mama Jean's East location. The outcome and buyer name were not captured in the source note." },
      { date: "Aug 31", actor: "Principal", channel: "Assignment", detail: "Springfield relationship follow-up moved to Katie." },
    ],
  },
  {
    key: "zimmermans",
    initials: "ZI",
    name: "Zimmerman's",
    city: "Springfield",
    state: "Warm · waiting",
    tone: "warn",
    contact: "Kendall · manager",
    currentThread: "Kendall is taking the current bouquet offer to the owner.",
    waitingOn: "Buyer",
    history: [
      { date: "Aug 30", actor: "Marshall", channel: "Phone", detail: "Spoke with Kendall, the manager. Offered 5-stem bouquets at $4 wholesale for resale around $7–8." },
      { date: "Aug 30", actor: "Kendall", channel: "Outcome", detail: "Said he would talk to the owner." },
    ],
  },
  {
    key: "ruths",
    initials: "RF",
    name: "Ruth's Flowers",
    city: "Springfield",
    state: "Waiting on buyer",
    contact: "Sue",
    currentThread: "Sue said she would call back Monday.",
    waitingOn: "Buyer",
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

function BuyerList({ onOpen }: { onOpen: (key: BuyerKey) => void }) {
  return (
    <div className={styles.stack} data-atlas-buyer-profile-list="fixture-only">
      <section className={styles.intro}>
        <span>ELM · BUYER DESK</span>
        <h1>Buyer relationships</h1>
        <p>Company memory follows the buyer. Katie sees the commercial facts she needs without inheriting another person's private account.</p>
      </section>
      <section className={styles.card}>
        <SectionHeader kicker="SPRINGFIELD" title="Open relationships" right={<Badge tone="purple">3</Badge>} />
        <div className={styles.buyerList}>
          {BUYERS.map((buyer) => (
            <button type="button" className={styles.buyerRow} onClick={() => onOpen(buyer.key)} key={buyer.key}>
              <span className={styles.avatar}>{buyer.initials}</span>
              <div><strong>{buyer.name}</strong><span>{buyer.city} · {buyer.currentThread}</span></div>
              <Badge tone={buyer.tone}>{buyer.state}</Badge>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function BuyerProfile({ buyer, onBack }: { buyer: BuyerFixture; onBack: () => void }) {
  const missingOutcome = buyer.key === "mama-jeans-east";
  return (
    <div className={styles.stack} data-atlas-counterparty-profile="future-canonical-v1" data-live-data-binding="none" data-mutation-capability="none">
      <button type="button" className={styles.back} onClick={onBack}>‹ Buyers</button>

      <section className={styles.profileHero}>
        <div>
          <span>BUYER PROFILE</span>
          <h1>{buyer.name}</h1>
          <p>{buyer.city} · relationship workspace</p>
        </div>
        <Badge tone={buyer.tone}>{buyer.state}</Badge>
        <div className={styles.tags}><span>Buyer</span><span>Springfield distribution</span><span>Assigned to Katie</span></div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="CURRENT THREAD" title="What needs movement" right={<Badge tone={missingOutcome ? "warn" : "purple"}>{missingOutcome ? "Needs outcome" : "Open"}</Badge>} />
        <div className={styles.threadLead}>
          <strong>{buyer.currentThread}</strong>
          <p>{missingOutcome ? "Atlas knows the contact happened, but it does not know what happened in the call. The profile keeps that gap visible instead of manufacturing a disposition." : "The profile preserves who owes the next movement so waiting does not become fake overdue work."}</p>
        </div>
        <div className={styles.factGrid}>
          <article><span>Relationship owner</span><strong>Katie</strong></article>
          <article><span>Waiting on</span><strong>{buyer.waitingOn}</strong></article>
          <article><span>Inventory claim</span><strong>None</strong></article>
        </div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="OFFER + CAPACITY" title="What Katie can sell" right={<Badge tone="good">27 Ready</Badge>} />
        <div className={styles.offerHero}>
          <div><span>Current wholesale offer</span><strong>5-stem bouquet</strong></div>
          <b>$4</b>
          <em>Suggested retail $7–8</em>
        </div>
        <div className={styles.inventoryList}>
          <article><div><strong>ProCut Orange sunflower</strong><span>5-stem bunches · published sellable inventory</span></div><b>9</b></article>
          <article><div><strong>Benary's Giant zinnia</strong><span>bunches · published sellable inventory</span></div><b>12</b></article>
          <article><div><strong>Mixed posies</strong><span>prepared this morning · published sellable inventory</span></div><b>6</b></article>
        </div>
        <p className={styles.authorityNote}>Inventory is visible here, not owned here. Nothing is reserved until the buyer actually requests it and the commercial claim is recorded.</p>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="MOVING PIECES" title="What is still unresolved" right={<Badge>3</Badge>} />
        <div className={styles.movingList}>
          <article><Badge tone={missingOutcome ? "warn" : "purple"}>{missingOutcome ? "Gap" : "State"}</Badge><div><strong>{missingOutcome ? "Prior contact needs a disposition" : "Buyer response is still pending"}</strong><span>{missingOutcome ? "The company knows a call happened, but not the result." : "The waiting state belongs to the relationship, not to a generic task list."}</span></div></article>
          <article><Badge tone="good">Offer</Badge><div><strong>$4 / 5-stem bouquet</strong><span>Current Springfield wholesale offer · suggested resale $7–8.</span></div></article>
          <article><Badge tone="good">Supply</Badge><div><strong>27 Ready units remain sellable</strong><span>Current published supply can be discussed; future field supply is not guaranteed.</span></div></article>
        </div>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="COMPANY MEMORY" title="Relationship history" right={<Badge tone="purple">Across Atlas</Badge>} />
        <div className={styles.historyList}>
          {buyer.history.map((event) => (
            <article className={styles.historyRow} key={`${event.date}:${event.actor}:${event.channel}`}>
              <div className={styles.historyMeta}><span>{event.date}</span><strong>{event.actor}</strong><em>{event.channel}</em></div>
              <p>{event.detail}</p>
            </article>
          ))}
        </div>
        <p className={styles.authorityNote}>These are company-scoped relationship facts attributed to their source humans. No order, reservation, fulfillment, or payment is implied by contact history.</p>
      </section>

      <section className={styles.card}>
        <SectionHeader kicker="IDENTITY" title="Buyer details" />
        <div className={styles.identityGrid}>
          <article><span>Business</span><strong>{buyer.name}</strong></article>
          <article><span>Market</span><strong>Springfield</strong></article>
          <article><span>Contact</span><strong>{buyer.contact}</strong></article>
          <article><span>Relationship owner</span><strong>Katie</strong></article>
        </div>
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
