"use client";

import { useMemo, useState, type ReactNode } from "react";

import styles from "./portal-lab.module.css";

type PortalArchetype = "coordination" | "execution" | "commercial";

type ArchetypeDefinition = {
  key: PortalArchetype;
  label: string;
  elmLabel: string;
  purpose: string;
  question: string;
};

const ARCHETYPES: ArchetypeDefinition[] = [
  {
    key: "coordination",
    label: "Coordination",
    elmLabel: "Owner",
    purpose: "See the whole system, resolve ambiguity, allocate resources, and intervene.",
    question: "What needs me, what is at risk, and what is the business doing right now?",
  },
  {
    key: "execution",
    label: "Execution",
    elmLabel: "Clock",
    purpose: "Turn commitments into completed work without making the worker manage the work system.",
    question: "What is my next useful move, and what changed when I did it?",
  },
  {
    key: "commercial",
    label: "Commercial",
    elmLabel: "Buyer Desk",
    purpose: "Turn available capacity into external commitments and carry them through fulfillment.",
    question: "What can we offer, who needs it, what is committed, and what must be fulfilled?",
  },
];

const OWNER_NAV = ["Today", "My work", "Team", "Operations", "Calendar"];
const CLOCK_NAV = ["Today", "Day feed", "Hours"];
const COMMERCIAL_NAV = ["This week", "Buyers", "Orders", "My route", "History"];

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Section({ title, eyebrow, action, children }: { title: string; eyebrow?: string; action?: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>
        {action ? <button type="button" disabled>{action}</button> : null}
      </header>
      {children}
    </section>
  );
}

function StatusPill({ tone, children }: { tone: "urgent" | "watch" | "good" | "neutral"; children: ReactNode }) {
  return <span className={styles.statusPill} data-tone={tone}>{children}</span>;
}

function OwnerWorkspace() {
  return (
    <div className={styles.workspaceGrid}>
      <div className={styles.mainColumn}>
        <Section eyebrow="OWNER CUSTODY" title="Needs you" action="View all">
          <div className={styles.priorityStack}>
            <article className={styles.priorityCard} data-tone="urgent">
              <div>
                <StatusPill tone="urgent">Decision</StatusPill>
                <strong>Thursday workshop is nearly full</strong>
                <p>18 time slots are open across Monday–Wednesday; Thursday needs a final capacity call.</p>
              </div>
              <span className={styles.chevron}>›</span>
            </article>
            <article className={styles.priorityCard} data-tone="watch">
              <div>
                <StatusPill tone="watch">Exception</StatusPill>
                <strong>MG7 transplant work is blocked</strong>
                <p>The bed prerequisite is still unresolved while transplant timing is getting tighter.</p>
              </div>
              <span className={styles.chevron}>›</span>
            </article>
          </div>
        </Section>

        <Section eyebrow="PERSONAL QUEUE" title="My work">
          <div className={styles.taskList}>
            <article><span className={styles.taskDot} data-state="now" /><div><strong>Finish September event calendar</strong><small>Owner · 35 min</small></div><b>NOW</b></article>
            <article><span className={styles.taskDot} data-state="next" /><div><strong>Approve Buyer Desk outreach list</strong><small>Sales · 15 min</small></div><b>NEXT</b></article>
            <article><span className={styles.taskDot} /><div><strong>Review Clock Day design</strong><small>Atlas · 25 min</small></div></article>
          </div>
          <div className={styles.identityRule}><strong>My work means my work.</strong><span>Team assignments never silently appear in this queue.</span></div>
        </Section>

        <Section eyebrow="BUSINESS PULSE" title="What the company is producing and selling">
          <div className={styles.metricGrid}>
            <Metric label="Sellable now" value="17 bundles" note="Sunflowers · current harvest" />
            <Metric label="Committed" value="6 bundles" note="Across 3 buyers" />
            <Metric label="Open bookings" value="18 slots" note="Mon–Wed next week" />
            <Metric label="At risk" value="2 items" note="Need owner judgment" />
          </div>
        </Section>
      </div>

      <aside className={styles.sideColumn}>
        <Section eyebrow="TEAM TODAY" title="People">
          <div className={styles.personStack}>
            <article><div className={styles.avatar}>A</div><div><strong>Anna</strong><span>Working · Main Garden</span></div><StatusPill tone="good">Active</StatusPill></article>
            <article><div className={styles.avatar}>K</div><div><strong>Katie</strong><span>Commercial · buyer follow-up</span></div><StatusPill tone="neutral">Outreach</StatusPill></article>
          </div>
        </Section>

        <Section eyebrow="COMING NEXT" title="Commitments">
          <div className={styles.commitmentList}>
            <article><span>MON</span><div><strong>Booking window</strong><small>6 customer slots</small></div></article>
            <article><span>THU</span><div><strong>Community day</strong><small>Workshop + farm activity</small></div></article>
            <article><span>FRI</span><div><strong>High-ticket event block</strong><small>Venue capacity protected</small></div></article>
          </div>
        </Section>
      </aside>
    </div>
  );
}

function ExecutionWorkspace() {
  return (
    <div className={styles.executionWrap}>
      <section className={styles.executionHero}>
        <div className={styles.executionDate}><span>SATURDAY</span><strong>29</strong><small>August</small></div>
        <div className={styles.executionNow}>
          <span>YOUR NEXT MOVE</span>
          <h2>Weed MG7 until the transplant area is clear</h2>
          <p>Main Garden · about 30 minutes</p>
          <div className={styles.executionActions}>
            <button type="button" disabled>Done</button>
            <button type="button" disabled>Made progress</button>
            <button type="button" disabled>Need something</button>
          </div>
        </div>
      </section>

      <div className={styles.executionColumns}>
        <Section eyebrow="DAY FEED" title="What has changed today">
          <div className={styles.feedList}>
            <article data-state="done"><time>7:42</time><span /><div><strong>Harvested sunflower bundles</strong><small>9 bundles added to sellable intake</small></div></article>
            <article data-state="done"><time>9:18</time><span /><div><strong>Watered Main Garden</strong><small>Farm state updated</small></div></article>
            <article data-state="now"><time>NOW</time><span /><div><strong>Weed MG7</strong><small>Current bounded move</small></div></article>
          </div>
        </Section>

        <Section eyebrow="SHIFT" title="Today">
          <div className={styles.shiftCard}>
            <div><span>Clocked in</span><strong>3h 06m</strong><small>22h 54m this week</small></div>
            <div className={styles.shiftRule}><span>Morning outdoor window</span><b>Active</b></div>
          </div>
        </Section>
      </div>

      <button className={styles.logButton} type="button" disabled aria-label="Mock one sentence work log">+</button>
      <div className={styles.logHint}><strong>One-sentence work log</strong><span>For work completed outside the assigned sequence.</span></div>
    </div>
  );
}

function CommercialWorkspace() {
  return (
    <div className={styles.workspaceGrid}>
      <div className={styles.mainColumn}>
        <Section eyebrow="AVAILABLE CAPACITY" title="What we can sell this week">
          <div className={styles.inventoryGrid}>
            <article className={styles.inventoryCard}>
              <div><span>FLOWERS</span><StatusPill tone="good">Fresh</StatusPill></div>
              <strong>Sunflower bundles</strong>
              <b>17 available</b>
              <small>9 harvested today · 8 carryover</small>
              <div className={styles.inventoryBar}><i style={{ width: "35%" }} /></div>
              <p>6 committed · 17 still available to sell</p>
            </article>
            <article className={styles.inventoryCard}>
              <div><span>VENUE CAPACITY</span><StatusPill tone="neutral">Next week</StatusPill></div>
              <strong>Booking slots</strong>
              <b>18 available</b>
              <small>Monday–Wednesday</small>
              <div className={styles.inventoryBar}><i style={{ width: "18%" }} /></div>
              <p>Capacity published by operations, not editable here</p>
            </article>
          </div>
        </Section>

        <Section eyebrow="COMMERCIAL WORK" title="Buyers needing contact" action="All buyers">
          <div className={styles.accountList}>
            <article>
              <div className={styles.accountMark}>SF</div>
              <div><strong>Schaffitzel’s Flowers</strong><small>Follow-up sent · standing order question open</small></div>
              <StatusPill tone="watch">Waiting</StatusPill>
            </article>
            <article>
              <div className={styles.accountMark}>RF</div>
              <div><strong>Ruth’s Flowers</strong><small>Sample opportunity · contact today</small></div>
              <StatusPill tone="urgent">Today</StatusPill>
            </article>
            <article>
              <div className={styles.accountMark}>ML</div>
              <div><strong>Messiah Lutheran</strong><small>Voicemail left · follow-up not yet resolved</small></div>
              <StatusPill tone="neutral">Follow up</StatusPill>
            </article>
          </div>
        </Section>

        <Section eyebrow="COMMITMENTS" title="Orders">
          <div className={styles.orderTable}>
            <div className={styles.orderHead}><span>Account</span><span>Commitment</span><span>Fulfillment</span><span>Status</span></div>
            <article><strong>House of Flowers</strong><span>3 sunflower bundles</span><span>Friday route</span><StatusPill tone="watch">Draft</StatusPill></article>
            <article><strong>Rose Among Thorns</strong><span>2 sunflower bundles</span><span>Pickup</span><StatusPill tone="good">Confirmed</StatusPill></article>
            <article><strong>Private event</strong><span>1 bouquet order</span><span>Saturday</span><StatusPill tone="good">Confirmed</StatusPill></article>
          </div>
        </Section>
      </div>

      <aside className={styles.sideColumn}>
        <Section eyebrow="FULFILLMENT" title="My route">
          <div className={styles.routeSummary}>
            <div><strong>Friday</strong><span>3 stops · 6 bundles</span></div>
            <ol>
              <li><span>1</span><div><strong>Elm Farm</strong><small>Load confirmed orders</small></div></li>
              <li><span>2</span><div><strong>Rose Among Thorns</strong><small>2 bundles</small></div></li>
              <li><span>3</span><div><strong>House of Flowers</strong><small>Draft · confirm first</small></div></li>
            </ol>
          </div>
        </Section>

        <section className={styles.truthBoundary}>
          <span>SOURCE-OF-TRUTH BOUNDARY</span>
          <strong>Commercial consumes availability. It does not invent it.</strong>
          <p>Production publishes capacity. This workspace creates offers, commitments, and fulfillment state.</p>
        </section>
      </aside>
    </div>
  );
}

function WorkspaceBody({ archetype }: { archetype: PortalArchetype }) {
  if (archetype === "execution") return <ExecutionWorkspace />;
  if (archetype === "commercial") return <CommercialWorkspace />;
  return <OwnerWorkspace />;
}

export default function PortalLab() {
  const [archetype, setArchetype] = useState<PortalArchetype>("coordination");
  const [activeNav, setActiveNav] = useState(0);

  const definition = useMemo(
    () => ARCHETYPES.find((item) => item.key === archetype) ?? ARCHETYPES[0],
    [archetype],
  );

  const navItems = archetype === "coordination" ? OWNER_NAV : archetype === "execution" ? CLOCK_NAV : COMMERCIAL_NAV;

  function chooseArchetype(next: PortalArchetype) {
    setArchetype(next);
    setActiveNav(0);
  }

  return (
    <main
      className={styles.page}
      data-atlas-portal-lab="fixture-only"
      data-live-data-binding="none"
      data-mutation-capability="none"
    >
      <header className={styles.labHeader}>
        <div>
          <span>ATLAS · OWNER DESIGN LAB</span>
          <h1>Portal Lab</h1>
          <p>Three reusable portal archetypes inside one Atlas shell. Elm vocabulary is configuration, not architecture.</p>
        </div>
        <div className={styles.safetyBanner}>
          <strong>MOCK DATA ONLY</strong>
          <span>No Supabase reads · no task/order mutations · no live portal behavior</span>
        </div>
      </header>

      <section className={styles.archetypePicker} aria-label="Portal archetype selector">
        {ARCHETYPES.map((item) => (
          <button
            type="button"
            key={item.key}
            data-active={archetype === item.key}
            onClick={() => chooseArchetype(item.key)}
          >
            <span>{item.label}</span>
            <strong>{item.elmLabel}</strong>
            <small>{item.purpose}</small>
          </button>
        ))}
      </section>

      <section className={styles.portalFrame}>
        <aside className={styles.portalRail}>
          <div className={styles.brandBlock}>
            <div className={styles.brandMark}>A</div>
            <div><strong>Atlas</strong><span>Elm Farm</span></div>
          </div>

          <div className={styles.roleBadge}>
            <span>PORTAL TYPE</span>
            <strong>{definition.label}</strong>
            <small>Elm: {definition.elmLabel}</small>
          </div>

          <nav className={styles.portalNav} aria-label={`${definition.elmLabel} mock navigation`}>
            {navItems.map((item, index) => (
              <button type="button" key={item} data-active={activeNav === index} onClick={() => setActiveNav(index)}>
                <span className={styles.navGlyph}>{index + 1}</span>
                <span>{item}</span>
              </button>
            ))}
          </nav>

          <div className={styles.railFooter}>
            <div className={styles.avatar}>L</div>
            <div><strong>Owner</strong><span>Elm Farm</span></div>
          </div>
        </aside>

        <div className={styles.portalSurface}>
          <header className={styles.surfaceHeader}>
            <div>
              <span>{definition.label.toUpperCase()} PORTAL</span>
              <h2>{definition.elmLabel}</h2>
              <p>{definition.question}</p>
            </div>
            <div className={styles.surfaceMeta}>
              <span>Saturday · Aug 29</span>
              <button type="button" disabled>•••</button>
            </div>
          </header>

          <WorkspaceBody archetype={archetype} />
        </div>
      </section>

      <section className={styles.contractGrid} aria-label="Portal architecture contract">
        <article><span>COORDINATION</span><strong>Own the ambiguity</strong><p>Full system visibility, exceptions, priorities, dependencies, and decisions.</p></article>
        <article><span>EXECUTION</span><strong>Own the next move</strong><p>Bounded work, state reporting, and a day feed without project-management burden.</p></article>
        <article><span>COMMERCIAL</span><strong>Own the commitment</strong><p>Available capacity becomes offers, accounts, orders/bookings, and fulfillment.</p></article>
        <article><span>SHARED SHELL</span><strong>One product, different jurisdiction</strong><p>Navigation rhythm, identity, visual grammar, and interaction patterns stay recognizably Atlas.</p></article>
      </section>
    </main>
  );
}
