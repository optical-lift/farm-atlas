"use client";

import { useState, type ReactNode } from "react";

import styles from "./atlas-lab-workbench.module.css";

type PortalArchetype = "coordination" | "execution" | "commercial";

type ArchetypeDefinition = {
  key: PortalArchetype;
  label: string;
  elmLabel: string;
  promise: string;
};

const ARCHETYPES: ArchetypeDefinition[] = [
  { key: "coordination", label: "Coordination", elmLabel: "Owner", promise: "Own the ambiguity" },
  { key: "execution", label: "Execution", elmLabel: "Clock", promise: "Own the next move" },
  { key: "commercial", label: "Commercial", elmLabel: "Buyer Desk", promise: "Own the commitment" },
];

function Pill({ tone = "neutral", children }: { tone?: "urgent" | "watch" | "good" | "neutral"; children: ReactNode }) {
  return <span className={styles.pill} data-tone={tone}>{children}</span>;
}

function Panel({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header>
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h4>{title}</h4>
      </header>
      {children}
    </section>
  );
}

function MockNav({ items }: { items: string[] }) {
  return (
    <div className={styles.mockNav} aria-label="Mock portal navigation">
      {items.map((item, index) => <span key={item} data-active={index === 0}>{item}</span>)}
    </div>
  );
}

function CoordinationPreview() {
  return (
    <div className={styles.previewBody}>
      <MockNav items={["Today", "My work", "Team", "Operations", "Calendar"]} />

      <Panel eyebrow="OWNER CUSTODY" title="Needs you">
        <div className={styles.alertStack}>
          <article>
            <div><Pill tone="urgent">Decision</Pill><strong>Thursday needs a capacity call</strong></div>
            <b>›</b>
          </article>
          <article>
            <div><Pill tone="watch">Exception</Pill><strong>MG7 transplant work is blocked</strong></div>
            <b>›</b>
          </article>
        </div>
      </Panel>

      <Panel eyebrow="PERSONAL QUEUE" title="My work">
        <div className={styles.workRows}>
          <article><i data-state="now" /><div><strong>Finish September event calendar</strong><span>Owner · now</span></div></article>
          <article><i data-state="next" /><div><strong>Approve commercial outreach list</strong><span>Sales · next</span></div></article>
        </div>
        <div className={styles.identityRule}><strong>My work means my work.</strong><span>Team assignments stay separate.</span></div>
      </Panel>

      <div className={styles.twoUp}>
        <Panel eyebrow="TEAM TODAY" title="People">
          <div className={styles.peopleRows}>
            <article><b>A</b><div><strong>Anna</strong><span>Main Garden</span></div><Pill tone="good">Active</Pill></article>
            <article><b>K</b><div><strong>Katie</strong><span>Buyer follow-up</span></div><Pill>Outreach</Pill></article>
          </div>
        </Panel>
        <Panel eyebrow="BUSINESS PULSE" title="Today">
          <div className={styles.metrics}>
            <article><strong>17</strong><span>sellable bundles</span></article>
            <article><strong>6</strong><span>committed</span></article>
            <article><strong>18</strong><span>open booking slots</span></article>
            <article><strong>2</strong><span>need judgment</span></article>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ExecutionPreview() {
  return (
    <div className={styles.previewBody}>
      <MockNav items={["Today", "Day feed", "Hours"]} />

      <section className={styles.nextMove}>
        <span>YOUR NEXT MOVE</span>
        <h4>Weed MG7 until the transplant area is clear</h4>
        <p>Main Garden · about 30 minutes</p>
        <div><button type="button" disabled>Done</button><button type="button" disabled>Made progress</button><button type="button" disabled>Need something</button></div>
      </section>

      <div className={styles.twoUp}>
        <Panel eyebrow="DAY FEED" title="What changed today">
          <div className={styles.feedRows}>
            <article><time>7:42</time><i data-state="done" /><div><strong>Harvested sunflower bundles</strong><span>9 bundles added</span></div></article>
            <article><time>9:18</time><i data-state="done" /><div><strong>Watered Main Garden</strong><span>Farm state updated</span></div></article>
            <article><time>NOW</time><i data-state="now" /><div><strong>Weed MG7</strong><span>Current bounded move</span></div></article>
          </div>
        </Panel>
        <Panel eyebrow="SHIFT" title="Today">
          <div className={styles.shift}>
            <span>Clocked in</span>
            <strong>3h 06m</strong>
            <small>22h 54m this week</small>
          </div>
        </Panel>
      </div>

      <div className={styles.logFixture}>
        <div><strong>One-sentence work log</strong><span>Capture work outside the assigned sequence.</span></div>
        <button type="button" disabled aria-label="Mock one-sentence work log">+</button>
      </div>
    </div>
  );
}

function CommercialPreview() {
  return (
    <div className={styles.previewBody}>
      <MockNav items={["This week", "Buyers", "Orders", "My route", "History"]} />

      <Panel eyebrow="AVAILABLE CAPACITY" title="What we can sell this week">
        <div className={styles.capacityGrid}>
          <article><span>FLOWERS</span><strong>17 bundles</strong><small>9 fresh today · 8 carryover</small><Pill tone="good">Sellable</Pill></article>
          <article><span>VENUE</span><strong>18 slots</strong><small>Monday–Wednesday next week</small><Pill>Published</Pill></article>
        </div>
      </Panel>

      <Panel eyebrow="COMMERCIAL WORK" title="Buyers needing contact">
        <div className={styles.buyerRows}>
          <article><b>SF</b><div><strong>Schaffitzel’s Flowers</strong><span>Standing-order question open</span></div><Pill tone="watch">Waiting</Pill></article>
          <article><b>RF</b><div><strong>Ruth’s Flowers</strong><span>Sample opportunity</span></div><Pill tone="urgent">Today</Pill></article>
          <article><b>ML</b><div><strong>Messiah Lutheran</strong><span>Voicemail left</span></div><Pill>Follow up</Pill></article>
        </div>
      </Panel>

      <div className={styles.twoUp}>
        <Panel eyebrow="COMMITMENTS" title="Orders">
          <div className={styles.orderRows}>
            <article><div><strong>Rose Among Thorns</strong><span>2 sunflower bundles · pickup</span></div><Pill tone="good">Confirmed</Pill></article>
            <article><div><strong>House of Flowers</strong><span>3 bundles · Friday route</span></div><Pill tone="watch">Draft</Pill></article>
          </div>
        </Panel>
        <Panel eyebrow="FULFILLMENT" title="My route">
          <div className={styles.routeRows}>
            <article><b>1</b><div><strong>Elm Farm</strong><span>Load orders</span></div></article>
            <article><b>2</b><div><strong>Rose Among Thorns</strong><span>2 bundles</span></div></article>
            <article><b>3</b><div><strong>House of Flowers</strong><span>Confirm first</span></div></article>
          </div>
        </Panel>
      </div>

      <div className={styles.truthBoundary}>
        <span>SOURCE-OF-TRUTH BOUNDARY</span>
        <strong>Commercial consumes availability. It does not invent it.</strong>
        <p>Operations publishes capacity; Commercial owns offers, commitments, and fulfillment.</p>
      </div>
    </div>
  );
}

function Preview({ archetype }: { archetype: PortalArchetype }) {
  if (archetype === "execution") return <ExecutionPreview />;
  if (archetype === "commercial") return <CommercialPreview />;
  return <CoordinationPreview />;
}

export default function AtlasLabWorkbench() {
  const [archetype, setArchetype] = useState<PortalArchetype>("coordination");
  const selected = ARCHETYPES.find((item) => item.key === archetype) ?? ARCHETYPES[0];

  return (
    <section
      className={styles.workbench}
      data-atlas-lab="fixture-only"
      data-live-data-binding="none"
      data-mutation-capability="none"
      aria-label="Atlas portal design workbench"
    >
      <header className={styles.header}>
        <div>
          <span>ATLAS LAB</span>
          <h2>Portal workbench</h2>
          <p>Compare the reusable portal types here without leaving More.</p>
        </div>
        <small>MOCK DATA ONLY</small>
      </header>

      <div className={styles.switcher} role="tablist" aria-label="Portal type">
        {ARCHETYPES.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={item.key === archetype}
            data-active={item.key === archetype}
            key={item.key}
            onClick={() => setArchetype(item.key)}
          >
            <span>{item.label}</span>
            <strong>{item.elmLabel}</strong>
          </button>
        ))}
      </div>

      <div className={styles.previewShell}>
        <header className={styles.previewHeader}>
          <div><span>{selected.label.toUpperCase()} PORTAL</span><h3>{selected.elmLabel}</h3></div>
          <strong>{selected.promise}</strong>
        </header>
        <Preview archetype={archetype} />
      </div>

      <footer className={styles.contract}>
        <span>One Atlas shell</span>
        <b>·</b>
        <span>Different jurisdiction</span>
        <b>·</b>
        <span>Organization vocabulary is configuration</span>
      </footer>
    </section>
  );
}
