"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import styles from "./design-atlas.module.css";

type PersonaKey = "principal" | "anna" | "katie" | "marshall";
type ScopeKey = "principal" | "feast" | "elm";
type GlobalTab = "home" | "work" | "workspaces" | "calendar" | "more";
type CalendarView = "day" | "week" | "month";

type Persona = {
  key: PersonaKey;
  name: string;
  role: string;
  initials: string;
  defaultScope: ScopeKey;
  scopes: ScopeKey[];
  note: string;
};

type Workspace = {
  key: string;
  label: string;
  group: "Principal systems" | "Operating reality" | "Commercial" | "Governance";
  detail: string;
  people: PersonaKey[];
};

const PERSONAS: Persona[] = [
  {
    key: "principal",
    name: "Principal",
    role: "Owner / portfolio custody",
    initials: "P",
    defaultScope: "principal",
    scopes: ["principal", "feast", "elm"],
    note: "Sees the whole responsibility system, private planning, money, ambiguity, and operating units.",
  },
  {
    key: "anna",
    name: "Anna",
    role: "Farm hand / execution",
    initials: "A",
    defaultScope: "elm",
    scopes: ["elm"],
    note: "Receives bounded execution, shared farm truth, and state-reporting tools without project-management burden.",
  },
  {
    key: "katie",
    name: "Katie",
    role: "Commercial / Buyer Desk",
    initials: "K",
    defaultScope: "feast",
    scopes: ["feast", "elm"],
    note: "Consumes published availability and owns accounts, commitments, route work, and fulfillment follow-through.",
  },
  {
    key: "marshall",
    name: "Marshall",
    role: "Shared operations",
    initials: "M",
    defaultScope: "elm",
    scopes: ["elm"],
    note: "Uses the same shared operational reality and project/place objects without receiving private owner controls.",
  },
];

const SCOPE_LABELS: Record<ScopeKey, { label: string; kicker: string }> = {
  principal: { label: "Principal", kicker: "ROOT" },
  feast: { label: "Feast Guild", kicker: "PORTFOLIO" },
  elm: { label: "Elm Farm", kicker: "OPERATING UNIT" },
};

const GLOBAL_TABS: Array<{ key: GlobalTab; label: string; glyph: string }> = [
  { key: "home", label: "Home", glyph: "⌂" },
  { key: "work", label: "Work", glyph: "✓" },
  { key: "workspaces", label: "Workspaces", glyph: "▦" },
  { key: "calendar", label: "Calendar", glyph: "□" },
  { key: "more", label: "More", glyph: "•••" },
];

const WORKSPACES: Workspace[] = [
  { key: "portfolio", label: "Portfolio", group: "Principal systems", detail: "Operating units, organizations, responsibility and drill-down.", people: ["principal"] },
  { key: "household", label: "Household & Family", group: "Principal systems", detail: "Private household responsibilities and family systems.", people: ["principal"] },
  { key: "treasury", label: "Treasury", group: "Principal systems", detail: "Money, obligations, runway and business economics.", people: ["principal"] },
  { key: "teams", label: "Teams & Functions", group: "Principal systems", detail: "Functions, responsibility boundaries and people across units.", people: ["principal"] },
  { key: "capacity", label: "Principal Capacity", group: "Principal systems", detail: "Protected strategic time, fixed commitments and owner load.", people: ["principal"] },
  { key: "production", label: "Production", group: "Operating reality", detail: "Crop cycles, succession plans, readiness and production state.", people: ["principal", "anna", "marshall"] },
  { key: "harvest", label: "Harvest", group: "Operating reality", detail: "Crop-to-commerce flow, harvest records and sellable intake.", people: ["principal", "anna", "katie", "marshall"] },
  { key: "places", label: "Places & Objects", group: "Operating reality", detail: "Zone Registry, beds, rooms, equipment and durable farm objects.", people: ["principal", "anna", "marshall"] },
  { key: "projects", label: "Projects & Trails", group: "Operating reality", detail: "Destination-led project Trails, gates, moves and arrival evidence.", people: ["principal", "anna", "marshall"] },
  { key: "care", label: "Care", group: "Operating reality", detail: "Mowing, weeding, tending and repeating physical stewardship.", people: ["principal", "anna", "marshall"] },
  { key: "history", label: "Field History & Metrics", group: "Operating reality", detail: "Observations, completed state changes, field logs and metrics.", people: ["principal", "anna", "marshall"] },
  { key: "buyer-desk", label: "Buyer Desk", group: "Commercial", detail: "This Week, Buyers, Orders, My Route and History.", people: ["principal", "katie"] },
  { key: "bookings", label: "Bookings & Events", group: "Commercial", detail: "Capacity, customer commitments, event fulfillment and follow-up.", people: ["principal", "katie"] },
  { key: "people", label: "People & Roles", group: "Governance", detail: "Membership, authority and role boundaries.", people: ["principal"] },
  { key: "rulebook", label: "Rulebook & Rhythms", group: "Governance", detail: "Operating rules, recurring rhythms, evidence and release logic.", people: ["principal"] },
];

function Pill({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "good" | "warn" | "urgent" }) {
  return <span className={styles.pill} data-tone={tone}>{children}</span>;
}

function Panel({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children: ReactNode; action?: string }) {
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

function PrincipalHome({ scope }: { scope: ScopeKey }) {
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}>
        <span>PRINCIPAL HOME · {SCOPE_LABELS[scope].label.toUpperCase()}</span>
        <h1>What needs your judgment?</h1>
        <p>Atlas handles ordinary remembering and sequencing. This surface keeps ambiguity, commitments, capacity and real responsibility in your custody.</p>
      </section>

      <Panel eyebrow="NEEDS YOU" title="Decisions and exceptions">
        <div className={styles.attentionList}>
          <article><Pill tone="urgent">Decision</Pill><div><strong>Thursday capacity needs a final call</strong><small>Workshop demand is pressing against the protected community-day shape.</small></div><b>›</b></article>
          <article><Pill tone="warn">Blocked</Pill><div><strong>MG7 transplant timing is tightening</strong><small>The prerequisite remains unresolved while the biological window keeps moving.</small></div><b>›</b></article>
          <article><Pill>Approval</Pill><div><strong>Commercial wants another standing-order offer</strong><small>Availability exists; the price and commitment pattern still need owner judgment.</small></div><b>›</b></article>
        </div>
      </Panel>

      <div className={styles.twoCol}>
        <Panel eyebrow="MY WORK" title="Owner obligations">
          <div className={styles.simpleList}>
            <article><span>NOW</span><div><strong>Finish September operating calendar</strong><small>Principal · 35 min</small></div></article>
            <article><span>NEXT</span><div><strong>Resolve Buyer Desk offer boundary</strong><small>Commercial · 20 min</small></div></article>
            <article><span>LATER</span><div><strong>Review Clock architecture</strong><small>Atlas · protected strategic work</small></div></article>
          </div>
          <div className={styles.truthNote}><strong>My Work is never a team dump.</strong><span>Anna, Katie and Marshall appear in team state, not inside your personal queue.</span></div>
        </Panel>

        <Panel eyebrow="PORTFOLIO PULSE" title="Responsibility at a glance">
          <div className={styles.metricGrid}>
            <article><span>Operating units</span><strong>3</strong><small>Elm + portfolio units</small></article>
            <article><span>Needs judgment</span><strong>3</strong><small>Across current scope</small></article>
            <article><span>Commercial</span><strong>17</strong><small>Sellable bundles</small></article>
            <article><span>Capacity</span><strong>18</strong><small>Open booking slots</small></article>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AnnaHome() {
  return (
    <div className={styles.pageStack}>
      <section className={styles.executionHero}>
        <div className={styles.dateTile}><span>SAT</span><strong>29</strong><small>August</small></div>
        <div>
          <span>YOUR NEXT MOVE</span>
          <h1>Weed MG7 until the transplant area is clear</h1>
          <p>Main Garden · current outdoor window</p>
          <div className={styles.actionRow}><button type="button" disabled>Done</button><button type="button" disabled>Made progress</button><button type="button" disabled>Need something</button></div>
        </div>
      </section>

      <Panel eyebrow="DAY FEED" title="What changed today">
        <div className={styles.timeline}>
          <article><time>7:42</time><i data-state="done" /><div><strong>Harvested 9 sunflower bundles</strong><small>Harvest truth recorded</small></div></article>
          <article><time>9:18</time><i data-state="done" /><div><strong>Watered Main Garden</strong><small>Farm state changed</small></div></article>
          <article><time>NOW</time><i data-state="now" /><div><strong>Weed MG7</strong><small>Current bounded move</small></div></article>
        </div>
      </Panel>

      <div className={styles.twoCol}>
        <Panel eyebrow="SHIFT" title="Today"><div className={styles.bigStat}><strong>3h 06m</strong><span>Clocked in · 22h 54m this week</span></div></Panel>
        <Panel eyebrow="FARM CONDITIONS" title="Execution context"><div className={styles.statusRows}><article><span>Outdoor window</span><b>Open</b></article><article><span>Heat pressure</span><b>Low</b></article><article><span>Next hard edge</span><b>11:00 AM</b></article></div></Panel>
      </div>
    </div>
  );
}

function KatieHome() {
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}>
        <span>COMMERCIAL HOME</span>
        <h1>Turn available capacity into commitments.</h1>
        <p>Buyer Desk consumes published operational truth, then owns outreach, orders, route work and fulfillment follow-through.</p>
      </section>

      <div className={styles.metricGrid}>
        <article><span>Sellable now</span><strong>17</strong><small>Sunflower bundles</small></article>
        <article><span>Need contact</span><strong>4</strong><small>Buyer accounts</small></article>
        <article><span>Committed</span><strong>6</strong><small>Bundles</small></article>
        <article><span>Friday route</span><strong>3</strong><small>Stops</small></article>
      </div>

      <Panel eyebrow="THIS WEEK" title="Commercial pressure">
        <div className={styles.attentionList}>
          <article><Pill tone="urgent">Today</Pill><div><strong>Ruth’s Flowers</strong><small>Sample opportunity · contact still open.</small></div><b>›</b></article>
          <article><Pill tone="warn">Waiting</Pill><div><strong>Schaffitzel’s Flowers</strong><small>Standing-order follow-up has not resolved.</small></div><b>›</b></article>
          <article><Pill>Route</Pill><div><strong>Friday delivery loop</strong><small>3 stops · one draft order still needs confirmation.</small></div><b>›</b></article>
        </div>
      </Panel>
    </div>
  );
}

function MarshallHome() {
  return (
    <div className={styles.pageStack}>
      <section className={styles.executionHero}>
        <div className={styles.dateTile}><span>SAT</span><strong>29</strong><small>August</small></div>
        <div>
          <span>YOUR NEXT MOVE</span>
          <h1>Finish the north barn door adjustment</h1>
          <p>Barn · project move attached to the shared place object</p>
          <div className={styles.actionRow}><button type="button" disabled>Done</button><button type="button" disabled>Made progress</button><button type="button" disabled>Need something</button></div>
        </div>
      </section>

      <Panel eyebrow="PROJECT TRAIL" title="Where this move is going">
        <div className={styles.trail}>
          <article data-state="done"><span>1</span><div><strong>Inspect hinge alignment</strong><small>Arrived</small></div></article>
          <article data-state="now"><span>2</span><div><strong>Adjust north barn door</strong><small>Current move</small></div></article>
          <article><span>3</span><div><strong>Verify clean close</strong><small>Locked behind current move</small></div></article>
        </div>
      </Panel>

      <Panel eyebrow="SHARED REALITY" title="Places and projects stay communal">
        <div className={styles.workspaceMiniGrid}><article><strong>Barn</strong><span>4 open state changes</span></article><article><strong>Venue rooms</strong><span>2 project trails</span></article><article><strong>Equipment</strong><span>1 readiness issue</span></article></div>
      </Panel>
    </div>
  );
}

function PrincipalWork() {
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}><span>WORK</span><h1>Your obligations, not everybody’s tasks.</h1><p>Owner work preserves thinking, judgment and fixed commitments while team execution remains visible through context.</p></section>
      <Panel eyebrow="OWNER OBLIGATIONS" title="Now / Next / This week">
        <div className={styles.simpleList}>
          <article><span>NOW</span><div><strong>Set September public calendar</strong><small>Fixed external commitment</small></div></article>
          <article><span>NEXT</span><div><strong>Choose commercial standing-order rule</strong><small>Required before recurring offers can release</small></div></article>
          <article><span>WEEK</span><div><strong>Complete reusable Atlas onboarding architecture</strong><small>Protected strategic work</small></div></article>
        </div>
      </Panel>
      <Panel eyebrow="TEAM STATE" title="Not your queue">
        <div className={styles.personList}><article><span>A</span><div><strong>Anna</strong><small>Executing · Main Garden</small></div><Pill tone="good">Moving</Pill></article><article><span>K</span><div><strong>Katie</strong><small>Commercial follow-up</small></div><Pill>Outreach</Pill></article><article><span>M</span><div><strong>Marshall</strong><small>Project move · Barn</small></div><Pill tone="good">Moving</Pill></article></div>
      </Panel>
    </div>
  );
}

function ExecutionWork({ persona }: { persona: "anna" | "marshall" }) {
  const isAnna = persona === "anna";
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}><span>WORK · EXECUTION</span><h1>{isAnna ? "Clock is the execution neighborhood." : "One bounded move at a time."}</h1><p>Atlas owns sequencing and remembers what is waiting. The worker reports reality and continues.</p></section>
      {isAnna ? <AnnaHome /> : <MarshallHome />}
    </div>
  );
}

function BuyerDesk() {
  const [tab, setTab] = useState<"week" | "buyers" | "orders" | "route" | "history">("week");
  const tabs = [{ key: "week" as const, label: "This Week" }, { key: "buyers" as const, label: "Buyers" }, { key: "orders" as const, label: "Orders" }, { key: "route" as const, label: "My Route" }, { key: "history" as const, label: "History" }];
  return (
    <div className={styles.pageStack}>
      <section className={styles.workspaceTitle}><span>COMMERCIAL WORKSPACE</span><h1>Buyer Desk</h1><p>Availability comes in from operations. Commercial creates offers, commitments and fulfillment state.</p></section>
      <nav className={styles.subnav} aria-label="Buyer Desk sections">{tabs.map((item) => <button type="button" key={item.key} data-active={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav>
      {tab === "week" ? <>
        <div className={styles.metricGrid}><article><span>Available</span><strong>17</strong><small>Sunflower bundles</small></article><article><span>Committed</span><strong>6</strong><small>Across 3 buyers</small></article><article><span>Open accounts</span><strong>4</strong><small>Need contact</small></article><article><span>Route</span><strong>3</strong><small>Friday stops</small></article></div>
        <Panel eyebrow="AVAILABLE CAPACITY" title="What can be sold"><div className={styles.capacityCard}><div><strong>Sunflower bundles</strong><small>9 harvested today · 8 carryover</small></div><b>17 available</b><span><i style={{ width: "35%" }} /></span><p>Published by operations. Commercial cannot rewrite harvest truth.</p></div></Panel>
        <Panel eyebrow="BUYER PRESSURE" title="Who needs contact"><div className={styles.attentionList}><article><Pill tone="urgent">Today</Pill><div><strong>Ruth’s Flowers</strong><small>Sample opportunity</small></div><b>›</b></article><article><Pill tone="warn">Waiting</Pill><div><strong>Schaffitzel’s Flowers</strong><small>Standing-order question open</small></div><b>›</b></article><article><Pill>Follow up</Pill><div><strong>Messiah Lutheran</strong><small>Voicemail left</small></div><b>›</b></article></div></Panel>
      </> : null}
      {tab === "buyers" ? <Panel eyebrow="ACCOUNTS" title="Buyers"><div className={styles.accountGrid}><article><span>RF</span><div><strong>Ruth’s Flowers</strong><small>Florist · active prospect</small></div><Pill tone="urgent">Today</Pill></article><article><span>SF</span><div><strong>Schaffitzel’s Flowers</strong><small>Florist · follow-up open</small></div><Pill tone="warn">Waiting</Pill></article><article><span>ML</span><div><strong>Messiah Lutheran</strong><small>Church · contact attempted</small></div><Pill>Open</Pill></article></div></Panel> : null}
      {tab === "orders" ? <Panel eyebrow="COMMITMENTS" title="Orders"><div className={styles.orderTable}><article><strong>Rose Among Thorns</strong><span>2 bundles</span><span>Pickup</span><Pill tone="good">Confirmed</Pill></article><article><strong>House of Flowers</strong><span>3 bundles</span><span>Friday route</span><Pill tone="warn">Draft</Pill></article><article><strong>Private event</strong><span>1 bouquet</span><span>Saturday</span><Pill tone="good">Confirmed</Pill></article></div></Panel> : null}
      {tab === "route" ? <Panel eyebrow="FULFILLMENT" title="Friday route"><div className={styles.routeList}><article><span>1</span><div><strong>Elm Farm</strong><small>Load confirmed orders</small></div></article><article><span>2</span><div><strong>Rose Among Thorns</strong><small>2 bundles</small></div></article><article><span>3</span><div><strong>House of Flowers</strong><small>Confirm before loading</small></div></article></div></Panel> : null}
      {tab === "history" ? <Panel eyebrow="ACCOUNT MEMORY" title="History"><div className={styles.timeline}><article><time>AUG 28</time><i data-state="done" /><div><strong>Follow-up sent to Schaffitzel’s</strong><small>Standing-order question</small></div></article><article><time>AUG 27</time><i data-state="done" /><div><strong>Rose Among Thorns confirmed</strong><small>2 sunflower bundles</small></div></article><article><time>AUG 26</time><i data-state="done" /><div><strong>Messiah Lutheran called</strong><small>Voicemail left</small></div></article></div></Panel> : null}
    </div>
  );
}

function WorkspaceDetail({ workspace, onBack }: { workspace: Workspace; onBack: () => void }) {
  if (workspace.key === "buyer-desk") return <div><button className={styles.backButton} type="button" onClick={onBack}>‹ All workspaces</button><BuyerDesk /></div>;

  const content: Record<string, ReactNode> = {
    portfolio: <><div className={styles.metricGrid}><article><span>Portfolio units</span><strong>3</strong><small>Current responsibility map</small></article><article><span>Active people</span><strong>4</strong><small>Across functions</small></article><article><span>Needs judgment</span><strong>3</strong><small>Cross-unit</small></article><article><span>Fixed commitments</span><strong>7</strong><small>Next 14 days</small></article></div><Panel eyebrow="UNITS" title="Portfolio map"><div className={styles.workspaceMiniGrid}><article><strong>Elm Farm</strong><span>Operating unit · production + venue</span></article><article><strong>Waiting Room</strong><span>Portfolio unit</span></article><article><strong>Farm 3</strong><span>Portfolio unit</span></article></div></Panel></>,
    household: <Panel eyebrow="PRIVATE PRINCIPAL SYSTEM" title="Household & Family"><p className={styles.bodyCopy}>Household responsibilities live beside business responsibility at Principal scope, but never leak into a farm worker’s operating view.</p></Panel>,
    treasury: <><div className={styles.metricGrid}><article><span>Cash view</span><strong>Private</strong><small>Principal only</small></article><article><span>Upcoming obligations</span><strong>6</strong><small>Next 30 days</small></article><article><span>Revenue streams</span><strong>4</strong><small>Portfolio</small></article><article><span>Review</span><strong>Weekly</strong><small>Principal rhythm</small></article></div><Panel eyebrow="TREASURY" title="Money belongs at Principal scope"><p className={styles.bodyCopy}>Economics can inform owner decisions without becoming worker-facing execution language.</p></Panel></>,
    teams: <Panel eyebrow="FUNCTION MAP" title="Teams & Functions"><div className={styles.personList}><article><span>O</span><div><strong>Principal</strong><small>Portfolio custody + ambiguity</small></div><Pill>Private</Pill></article><article><span>A</span><div><strong>Anna</strong><small>Farm execution</small></div><Pill tone="good">Elm</Pill></article><article><span>K</span><div><strong>Katie</strong><small>Commercial</small></div><Pill tone="good">Feast Guild</Pill></article><article><span>M</span><div><strong>Marshall</strong><small>Shared operations</small></div><Pill tone="good">Elm</Pill></article></div></Panel>,
    capacity: <Panel eyebrow="PRINCIPAL CAPACITY" title="Protect the thinking"><div className={styles.calendarRows}><article><span>MON</span><div><strong>6 booking slots</strong><small>Customer-facing capacity</small></div></article><article><span>TUE</span><div><strong>6 booking slots</strong><small>Customer-facing capacity</small></div></article><article><span>WED</span><div><strong>6 booking slots</strong><small>Customer-facing capacity</small></div></article><article><span>THU</span><div><strong>Community / workshop day</strong><small>Protected shape</small></div></article></div></Panel>,
    production: <><Panel eyebrow="CROP CYCLES" title="Production state"><div className={styles.pipeline}><article data-state="done"><span>1</span><div><strong>Sown</strong><small>Canonical crop-cycle identity</small></div></article><article data-state="done"><span>2</span><div><strong>Growing</strong><small>Readiness + observations</small></div></article><article data-state="now"><span>3</span><div><strong>Harvest window</strong><small>Current biological state</small></div></article><article><span>4</span><div><strong>Close cycle</strong><small>After final harvest</small></div></article></div></Panel><Panel eyebrow="SUCCESSION" title="What comes next"><div className={styles.simpleList}><article><span>SEP 2</span><div><strong>White sunflower succession</strong><small>Barn Beds</small></div></article><article><span>SEP 5</span><div><strong>Fall cabbage transplant window</strong><small>Destination readiness required</small></div></article></div></Panel></>,
    harvest: <><Panel eyebrow="CROP → COMMERCE" title="Harvest command center"><div className={styles.harvestFlow}><article><span>FIELD</span><strong>Ready to cut</strong><small>Crop cycles publish readiness</small></article><b>→</b><article><span>HARVEST</span><strong>9 bundles</strong><small>Recorded today</small></article><b>→</b><article><span>SELLABLE</span><strong>17 bundles</strong><small>Published inventory</small></article><b>→</b><article><span>OUTBOUND</span><strong>6 committed</strong><small>Pickup / delivery custody</small></article></div></Panel><Panel eyebrow="PICKUP DOCK" title="Outbound custody"><div className={styles.orderTable}><article><strong>Rose Among Thorns</strong><span>2 bundles</span><span>Pickup</span><Pill tone="good">Reserved</Pill></article><article><strong>House of Flowers</strong><span>3 bundles</span><span>Route</span><Pill tone="warn">Draft</Pill></article></div></Panel></>,
    places: <><Panel eyebrow="ZONE REGISTRY" title="Places are durable objects"><div className={styles.workspaceMiniGrid}><article><strong>Main Garden</strong><span>4 quadrants + center</span></article><article><strong>Barn Beds</strong><span>Production beds</span></article><article><strong>Venue rooms</strong><span>Durable room objects</span></article><article><strong>Berry Walk</strong><span>Production beds</span></article></div></Panel><Panel eyebrow="OBJECT STATE" title="Work attaches to the world"><p className={styles.bodyCopy}>Beds, rooms, equipment and other durable objects carry state, history, tasks and project relationships. People do not need separate private copies of the same place.</p></Panel></>,
    projects: <><Panel eyebrow="UNIVERSAL TRAIL" title="Projects move toward destinations"><div className={styles.trail}><article data-state="done"><span>1</span><div><strong>Define destination</strong><small>What must be true when we arrive</small></div></article><article data-state="now"><span>2</span><div><strong>Current move</strong><small>One executable slice</small></div></article><article><span>3</span><div><strong>Gate</strong><small>Requires evidence before release</small></div></article><article><span>4</span><div><strong>Arrival</strong><small>Destination evidence</small></div></article></div></Panel><Panel eyebrow="CURRENT PROJECTS" title="Shared initiatives"><div className={styles.simpleList}><article><span>NOW</span><div><strong>Finish north barn door</strong><small>Barn · shared place object</small></div></article><article><span>NEXT</span><div><strong>Prepare fall transplant dock</strong><small>Reusable project pattern</small></div></article></div></Panel></>,
    care: <Panel eyebrow="REPEATING STEWARDSHIP" title="Care"><div className={styles.workspaceMiniGrid}><article><strong>Weeding</strong><span>Bed state + transplant consequences</span></article><article><strong>Mowing</strong><span>Persistent care cards + directives</span></article><article><strong>Tending</strong><span>Physical state changes</span></article><article><strong>Readiness</strong><span>Resources + prerequisites</span></article></div></Panel>,
    history: <><Panel eyebrow="FIELD HISTORY" title="Reality over checkboxes"><div className={styles.timeline}><article><time>7:42</time><i data-state="done" /><div><strong>9 sunflower bundles harvested</strong><small>Harvest event</small></div></article><article><time>9:18</time><i data-state="done" /><div><strong>Main Garden watered</strong><small>Field-state change</small></div></article><article><time>10:05</time><i data-state="done" /><div><strong>Barn door hinge inspected</strong><small>Project evidence</small></div></article></div></Panel><Panel eyebrow="METRICS" title="Operational patterns"><div className={styles.metricGrid}><article><span>Harvest</span><strong>9</strong><small>Bundles today</small></article><article><span>State changes</span><strong>14</strong><small>Today</small></article><article><span>Blocked</span><strong>2</strong><small>Need resolution</small></article><article><span>Projects moving</span><strong>4</strong><small>Current</small></article></div></Panel></>,
    bookings: <><Panel eyebrow="CAPACITY → COMMITMENT" title="Bookings & Events"><div className={styles.calendarRows}><article><span>MON</span><div><strong>6 public slots</strong><small>Published capacity</small></div></article><article><span>TUE</span><div><strong>6 public slots</strong><small>Published capacity</small></div></article><article><span>WED</span><div><strong>6 public slots</strong><small>Published capacity</small></div></article><article><span>THU</span><div><strong>Community day</strong><small>Workshop / collaboration</small></div></article><article><span>FRI</span><div><strong>High-ticket event block</strong><small>Protected commercial capacity</small></div></article></div></Panel></>,
    people: <Panel eyebrow="AUTHORITY" title="People & Roles"><div className={styles.personList}><article><span>P</span><div><strong>Principal</strong><small>Private planning + portfolio authority</small></div><Pill>Owner</Pill></article><article><span>A</span><div><strong>Farm hand</strong><small>Worker Day + shared operating truth</small></div><Pill>Execution</Pill></article><article><span>K</span><div><strong>Commercial</strong><small>Buyer Desk + fulfillment</small></div><Pill>Sales</Pill></article></div></Panel>,
    rulebook: <><Panel eyebrow="RULEBOOK" title="Rhythms and release logic"><div className={styles.simpleList}><article><span>DAILY</span><div><strong>Worker Day choreography</strong><small>Bounded execution from canonical truth</small></div></article><article><span>WEEKLY</span><div><strong>Harvest + commercial review</strong><small>Availability and commitments</small></div></article><article><span>MONTHLY</span><div><strong>Operating review</strong><small>Evidence, exceptions and rule changes</small></div></article></div></Panel></>,
  };

  return (
    <div className={styles.pageStack}>
      <button className={styles.backButton} type="button" onClick={onBack}>‹ All workspaces</button>
      <section className={styles.workspaceTitle}><span>{workspace.group.toUpperCase()}</span><h1>{workspace.label}</h1><p>{workspace.detail}</p></section>
      {content[workspace.key] ?? <Panel title={workspace.label}><p className={styles.bodyCopy}>This workspace is part of the future information architecture. Its detailed specimen has not been designed yet.</p></Panel>}
    </div>
  );
}

function Workspaces({ persona }: { persona: PersonaKey }) {
  const [selected, setSelected] = useState<string | null>(null);
  const visible = useMemo(() => WORKSPACES.filter((workspace) => workspace.people.includes(persona)), [persona]);
  const selectedWorkspace = visible.find((workspace) => workspace.key === selected) ?? null;
  if (selectedWorkspace) return <WorkspaceDetail workspace={selectedWorkspace} onBack={() => setSelected(null)} />;

  const groups: Workspace["group"][] = ["Principal systems", "Operating reality", "Commercial", "Governance"];
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}><span>WORKSPACES</span><h1>The shared Atlas world.</h1><p>Global navigation stays small. Durable domains live here and appear only when the current person has a reason to enter them.</p></section>
      {groups.map((group) => {
        const items = visible.filter((workspace) => workspace.group === group);
        if (items.length === 0) return null;
        return <section className={styles.workspaceGroup} key={group}><header><span>{group}</span><small>{items.length} visible</small></header><div className={styles.workspaceGrid}>{items.map((workspace) => <button type="button" key={workspace.key} onClick={() => setSelected(workspace.key)}><div><strong>{workspace.label}</strong><span>{workspace.detail}</span></div><b>›</b></button>)}</div></section>;
      })}
    </div>
  );
}

function Calendar({ persona }: { persona: PersonaKey }) {
  const [view, setView] = useState<CalendarView>("week");
  const roleCopy = persona === "principal" ? "Owner choreography, fixed commitments and protected capacity." : persona === "katie" ? "Routes, follow-ups, fulfillment and buyer commitments." : "Assigned work projection and operating commitments; Atlas owns rescheduling.";
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}><span>CALENDAR</span><h1>Time is a shared projection.</h1><p>{roleCopy}</p></section>
      <nav className={styles.segmented}>{(["day", "week", "month"] as CalendarView[]).map((item) => <button type="button" key={item} data-active={view === item} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
      {view === "day" ? <Panel eyebrow="SATURDAY · AUG 29" title="Today"><div className={styles.calendarRows}><article><span>7:00</span><div><strong>Outdoor work window</strong><small>Farm conditions favorable</small></div></article><article><span>9:30</span><div><strong>{persona === "katie" ? "Buyer follow-up block" : persona === "principal" ? "Owner work block" : "Current move"}</strong><small>Role-specific projection</small></div></article><article><span>1:00</span><div><strong>Protected indoor / admin window</strong><small>Shared operating shape</small></div></article></div></Panel> : null}
      {view === "week" ? <Panel eyebrow="AUG 24–30" title="This week"><div className={styles.weekGrid}><article><span>MON</span><strong>Bookings</strong><small>6 slots</small></article><article><span>TUE</span><strong>Bookings</strong><small>6 slots</small></article><article><span>WED</span><strong>Bookings</strong><small>6 slots</small></article><article><span>THU</span><strong>Community</strong><small>Workshop day</small></article><article><span>FRI</span><strong>Commercial</strong><small>Events + route</small></article><article><span>SAT</span><strong>Commercial</strong><small>High-ticket event</small></article><article><span>SUN</span><strong>Recovery</strong><small>Protected</small></article></div></Panel> : null}
      {view === "month" ? <Panel eyebrow="SEPTEMBER" title="Month shape"><div className={styles.monthShape}><article><span>MON–WED</span><strong>Bookings</strong><small>18 weekly slots</small></article><article><span>THU</span><strong>Community + workshops</strong><small>Recurring public rhythm</small></article><article><span>FRI–SAT</span><strong>High-ticket events</strong><small>Commercial capacity</small></article><article><span>MONTHLY</span><strong>Grower community</strong><small>Collaboration rhythm</small></article></div></Panel> : null}
    </div>
  );
}

function MorePage({ persona }: { persona: PersonaKey }) {
  return (
    <div className={styles.pageStack}>
      <section className={styles.hero}><span>MORE</span><h1>Controls, identity and deeper tools.</h1><p>Anything that must exist globally but does not deserve permanent dock space lands here.</p></section>
      <Panel eyebrow="ACCOUNT" title="Identity"><div className={styles.moreList}><article><div><strong>Profile & sign-in</strong><span>Account, password and device access</span></div><b>›</b></article><article><div><strong>Atlas app</strong><span>Install, device and alert transport</span></div><b>›</b></article></div></Panel>
      <Panel eyebrow="ROLE VISIBILITY" title="Why this lens looks this way"><p className={styles.bodyCopy}>{PERSONAS.find((item) => item.key === persona)?.note}</p></Panel>
      {persona === "principal" ? <Panel eyebrow="OWNER TOOLS" title="Governance & design"><div className={styles.moreList}><article><div><strong>People & roles</strong><span>Authority and membership</span></div><b>›</b></article><article><div><strong>Rulebook & rhythms</strong><span>Recurring operating law</span></div><b>›</b></article><article><div><strong>Task Card Editor</strong><span>Design approved task families</span></div><b>›</b></article><article><div><strong>Clock + Day Editor</strong><span>Design execution surfaces</span></div><b>›</b></article></div></Panel> : null}
    </div>
  );
}

function Home({ persona, scope }: { persona: PersonaKey; scope: ScopeKey }) {
  if (persona === "anna") return <AnnaHome />;
  if (persona === "katie") return <KatieHome />;
  if (persona === "marshall") return <MarshallHome />;
  return <PrincipalHome scope={scope} />;
}

function Work({ persona }: { persona: PersonaKey }) {
  if (persona === "katie") return <BuyerDesk />;
  if (persona === "anna" || persona === "marshall") return <ExecutionWork persona={persona} />;
  return <PrincipalWork />;
}

export default function DesignAtlas() {
  const [persona, setPersona] = useState<PersonaKey>("principal");
  const [scope, setScope] = useState<ScopeKey>("principal");
  const [tab, setTab] = useState<GlobalTab>("home");
  const [bellOpen, setBellOpen] = useState(false);

  const currentPersona = PERSONAS.find((item) => item.key === persona) ?? PERSONAS[0];
  const scopeMeta = SCOPE_LABELS[scope];

  function choosePersona(next: PersonaKey) {
    const nextPersona = PERSONAS.find((item) => item.key === next) ?? PERSONAS[0];
    setPersona(next);
    setScope(nextPersona.defaultScope);
    setTab("home");
    setBellOpen(false);
  }

  return (
    <main className={styles.root} data-atlas-design-portal="fixture-only">
      <header className={styles.globalHeader}>
        <div className={styles.brand}><span>A</span><div><strong>Atlas</strong><small>{scopeMeta.kicker}</small></div></div>
        <div className={styles.scopeIdentity}><span>{scopeMeta.label}</span><small>{currentPersona.role}</small></div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.bell} data-open={bellOpen} onClick={() => setBellOpen((value) => !value)} aria-label="Open fake Atlas activity">◌</button>
          <div className={styles.userAvatar}>{currentPersona.initials}</div>
          <Link href="/more" className={styles.exit} aria-label="Exit Design Atlas">×</Link>
        </div>
      </header>

      <section className={styles.designLens}>
        <div className={styles.designLensTitle}><span>DESIGN LENS</span><strong>Real fake portal</strong><small>Nothing here reads or writes Atlas.</small></div>
        <div className={styles.lensControls}>
          <div className={styles.controlGroup}><span>VIEW AS</span><div>{PERSONAS.map((item) => <button type="button" key={item.key} data-active={persona === item.key} onClick={() => choosePersona(item.key)}>{item.name}</button>)}</div></div>
          <div className={styles.controlGroup}><span>SCOPE</span><div>{currentPersona.scopes.map((item) => <button type="button" key={item} data-active={scope === item} onClick={() => { setScope(item); setTab("home"); }}>{SCOPE_LABELS[item].label}</button>)}</div></div>
        </div>
        <p><strong>Global shell candidate:</strong> Header + Home / Work / Workspaces / Calendar / More stay in the same place while the role lens changes what each surface contains.</p>
      </section>

      {bellOpen ? <aside className={styles.bellPanel}><header><span>ACTIVITY</span><button type="button" onClick={() => setBellOpen(false)}>×</button></header><article><Pill tone="urgent">New</Pill><div><strong>One decision needs attention</strong><small>Thursday capacity</small></div></article><article><Pill>Movement</Pill><div><strong>Harvest state changed</strong><small>9 bundles added today</small></div></article><article><Pill tone="good">Resolved</Pill><div><strong>One project gate cleared</strong><small>Barn project</small></div></article></aside> : null}

      <section className={styles.content}>
        {tab === "home" ? <Home persona={persona} scope={scope} /> : null}
        {tab === "work" ? <Work persona={persona} /> : null}
        {tab === "workspaces" ? <Workspaces persona={persona} /> : null}
        {tab === "calendar" ? <Calendar persona={persona} /> : null}
        {tab === "more" ? <MorePage persona={persona} /> : null}
      </section>

      {persona === "anna" && (tab === "home" || tab === "work") ? <button type="button" disabled className={styles.workLogFab} aria-label="Fake one-sentence work log">+</button> : null}

      <nav className={styles.globalFooter} aria-label="Design Atlas global tabs">
        {GLOBAL_TABS.map((item) => <button type="button" key={item.key} data-active={tab === item.key} onClick={() => { setTab(item.key); setBellOpen(false); }}><span>{item.glyph}</span><strong>{item.label}</strong></button>)}
      </nav>
    </main>
  );
}
