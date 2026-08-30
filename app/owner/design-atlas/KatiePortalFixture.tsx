"use client";

import { useMemo, useState } from "react";

import styles from "./KatiePortalFixture.module.css";

export type KatieFixtureTab = "home" | "clock" | "training" | "buyer" | "more";

type ScenarioKey = "normal" | "route" | "benchmark" | "race";
type BuyerTab = "week" | "buyers" | "orders" | "route" | "history";
type Effort = "Easy" | "Good" | "Hard" | "Couldn’t finish";

type ClockRow = {
  time: string;
  title: string;
  detail: string;
  tag?: string;
  kind?: "done" | "now" | "occupied" | "next";
};

const SCENARIOS: Array<{ key: ScenarioKey; label: string }> = [
  { key: "normal", label: "Normal day" },
  { key: "route", label: "Elm route day" },
  { key: "benchmark", label: "Benchmark day" },
  { key: "race", label: "Race week" },
];

const CLOCK_FIXTURES: Record<ScenarioKey, { label: string; edge: string; rows: ClockRow[] }> = {
  normal: {
    label: "A normal mixed-responsibility day",
    edge: "Next hard edge · family pickup 3:15 PM",
    rows: [
      { time: "7:30", title: "Daily home reset", detail: "Kitchen + one laundry pass · 15 min", tag: "HOME", kind: "done" },
      { time: "8:00", title: "Breakfast + family start", detail: "Occupied human time · Atlas schedules around it", tag: "OCCUPIED", kind: "occupied" },
      { time: "9:00", title: "Easy run / walk", detail: "25 min · conversational pace", tag: "TRAINING", kind: "now" },
      { time: "10:00", title: "Laundry reset", detail: "Move one load forward · 10 min", tag: "HOME", kind: "next" },
      { time: "12:00", title: "Lunch", detail: "Protected time · not a task", tag: "OCCUPIED", kind: "occupied" },
      { time: "1:30", title: "Buyer follow-up block", detail: "Ruth’s Flowers + two open accounts", tag: "ELM", kind: "next" },
      { time: "4:15", title: "Zone 2 attention", detail: "Kitchen / pantry · one small area · 15 min", tag: "HOME", kind: "next" },
    ],
  },
  route: {
    label: "A Springfield distribution day",
    edge: "Next hard edge · first delivery 10:45 AM",
    rows: [
      { time: "7:15", title: "Daily home reset", detail: "Keep the house from disappearing under route day", tag: "HOME", kind: "done" },
      { time: "8:00", title: "Breakfast + load-out buffer", detail: "Occupied / transition capacity", tag: "OCCUPIED", kind: "occupied" },
      { time: "9:00", title: "Receive Elm inventory", detail: "Published sellable bundles + route custody", tag: "BUYER DOCK", kind: "now" },
      { time: "10:15", title: "Springfield florist round", detail: "Orders + samples + buyer follow-up", tag: "ELM ROUTE", kind: "next" },
      { time: "1:00", title: "Lunch + route reset", detail: "Protected human time", tag: "OCCUPIED", kind: "occupied" },
      { time: "2:00", title: "Return / reconcile remaining flowers", detail: "Unsold custody returns to availability", tag: "BUYER DOCK", kind: "next" },
      { time: "4:30", title: "Easy mobility", detail: "20 min · recovery, not a build session", tag: "TRAINING", kind: "next" },
    ],
  },
  benchmark: {
    label: "A capability-check day",
    edge: "Protected training window · 9:00–10:00 AM",
    rows: [
      { time: "7:30", title: "Daily home reset", detail: "Quick reset before training", tag: "HOME", kind: "done" },
      { time: "8:15", title: "Breakfast + prepare", detail: "Occupied human time", tag: "OCCUPIED", kind: "occupied" },
      { time: "9:00", title: "Run / walk baseline", detail: "Comfortable mile + continuous-time observation", tag: "BENCHMARK", kind: "now" },
      { time: "10:15", title: "Recovery + notes", detail: "Atlas records evidence, not a score to beat", tag: "TRAINING", kind: "next" },
      { time: "1:30", title: "Buyer admin", detail: "Open commercial follow-up only", tag: "ELM", kind: "next" },
      { time: "4:00", title: "Zone 2 attention", detail: "Kitchen / pantry · 15 min", tag: "HOME", kind: "next" },
    ],
  },
  race: {
    label: "Race week protects freshness",
    edge: "Dec. 6 · Tri at the Y",
    rows: [
      { time: "7:45", title: "Daily home reset", detail: "Minimum viable household rhythm", tag: "HOME", kind: "done" },
      { time: "9:00", title: "Short easy movement", detail: "20 min · deliberately light", tag: "TRAINING", kind: "now" },
      { time: "10:00", title: "Recovery / fuel / normal life", detail: "Protected occupied time", tag: "OCCUPIED", kind: "occupied" },
      { time: "1:00", title: "Buyer follow-ups", detail: "Only the commercial work that truly belongs today", tag: "ELM", kind: "next" },
      { time: "4:00", title: "Race preparation", detail: "Gear + logistics · no fitness-building work", tag: "TRAINING", kind: "next" },
      { time: "7:00", title: "Quiet evening", detail: "Recovery is part of the campaign", tag: "OCCUPIED", kind: "occupied" },
    ],
  },
};

const HOUSE_TASKS = [
  { key: "dishwasher", title: "Kitchen reset", detail: "Unload / reload enough to reset the room" },
  { key: "laundry", title: "One laundry pass", detail: "Move one load forward — not the whole mountain" },
  { key: "pickup", title: "10-minute pickup", detail: "Return the main living area to baseline" },
];

const ZONE_TASKS = [
  "Clear one pantry shelf",
  "Wipe refrigerator + cabinet touch points",
  "Check one food-storage shelf for what needs used",
];

const CAPABILITIES = [
  { label: "Swim continuously for 5 minutes", done: true, note: "demonstrated" },
  { label: "Swim continuously for 10 minutes", done: false, note: "next milestone" },
  { label: "Swim continuously for 15 minutes", done: false, note: "Tri requirement" },
  { label: "Bike continuously for 30 minutes", done: true, note: "demonstrated" },
  { label: "Run / walk continuously for 30 minutes", done: false, note: "building" },
  { label: "First swim → bike combination", done: false, note: "later block" },
  { label: "First bike → run combination", done: false, note: "later block" },
  { label: "15 / 15 / 15 practice triathlon", done: false, note: "race prep" },
];

const BUYERS = [
  { initials: "RF", name: "Ruth’s Flowers", city: "Springfield", state: "Warm · order open", tone: "purple" as const },
  { initials: "LF", name: "Linda’s Flowers", city: "Marshfield", state: "Waiting", tone: "warn" as const },
  { initials: "MS", name: "Main Street Floral", city: "Nixa", state: "Not contacted", tone: undefined },
];

function Badge({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" | "purple" }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

function SectionHeader({ kicker, title, right }: { kicker: string; title: string; right?: React.ReactNode }) {
  return <header className={styles.sectionHeader}><div><span>{kicker}</span><h2>{title}</h2></div>{right}</header>;
}

function KatieClock() {
  const [scenario, setScenario] = useState<ScenarioKey>("normal");
  const fixture = CLOCK_FIXTURES[scenario];
  return (
    <div className={styles.stack}>
      <section className={styles.intro}>
        <span>CLOCK · COMPILED DAY</span>
        <h1>One day. All of Katie’s real responsibilities.</h1>
        <p>Household, training, family time and Elm work compete for the same finite day without becoming the same kind of work.</p>
      </section>

      <nav className={styles.scenarioRail} aria-label="Fake Katie day scenarios">
        {SCENARIOS.map((item) => <button type="button" key={item.key} data-active={scenario === item.key} onClick={() => setScenario(item.key)}>{item.label}</button>)}
      </nav>

      <section className={styles.clockCard}>
        <header className={styles.clockHeader}>
          <div><span>TODAY</span><h1>{fixture.label}</h1><p>Clock shows intended temporal custody. Rich detail stays inside the world that owns it.</p></div>
          <strong>{fixture.edge}</strong>
        </header>
        <div className={styles.timeline}>
          {fixture.rows.map((row, index) => <article className={styles.timeRow} data-kind={row.kind} key={`${row.time}:${row.title}:${index}`}>
            <time>{row.time}</time><i className={styles.rail} />
            <div className={styles.timeBody}><strong>{row.title}</strong><span>{row.detail}</span>{row.tag ? <small>{row.tag}</small> : null}</div>
          </article>)}
        </div>
      </section>

      <section className={styles.clockCard}>
        <SectionHeader kicker="LIVING DAY" title="What Atlas knows actually happened" right={<Badge tone="good">Evidence</Badge>} />
        <div className={styles.daySummary}><article><strong>4 things done</strong><span>3 Atlas moves · 1 Katie logged</span></article><article><strong>2 still need attention</strong><span>Open Atlas obligations remain open</span></article></div>
        <div className={styles.observationList}>
          <article className={styles.observationRow}><span className={styles.checkDot}>✓</span><div><strong>Daily home reset</strong><span>Atlas rhythm · completed</span></div><Badge tone="good">7:48</Badge></article>
          <article className={styles.observationRow}><span className={styles.checkDot}>✓</span><div><strong>Put away groceries and cleared the counter</strong><span>Katie logged this · evidence, not a fabricated task</span></div><Badge>8:26</Badge></article>
        </div>
        <p className={styles.fixtureNote}>Fixture rule being tested: Clock never rewrites itself to pretend it scheduled unscheduled household work. Day can remember it truthfully anyway.</p>
      </section>
    </div>
  );
}

function KatieHome() {
  const [done, setDone] = useState<Record<string, boolean>>({ dishwasher: true, laundry: false, pickup: false });
  const [zoneDone, setZoneDone] = useState<Record<number, boolean>>({});
  return (
    <div className={styles.stack}>
      <section className={styles.intro}><span>HOME · HOUSEHOLD</span><h1>Home works by rhythm, not backlog.</h1><p>Atlas keeps ordinary household responsibility visible without turning Katie’s life into an endless chore database.</p></section>

      <section className={styles.homeCard}>
        <SectionHeader kicker="DAILY RESET" title="Keep the baseline" right={<Badge>{Object.values(done).filter(Boolean).length} / {HOUSE_TASKS.length}</Badge>} />
        <div className={styles.checkList}>{HOUSE_TASKS.map((task) => <button type="button" key={task.key} className={styles.checkRow} data-done={Boolean(done[task.key])} onClick={() => setDone((current) => ({ ...current, [task.key]: !current[task.key] }))}>
          <span className={styles.checkDot}>{done[task.key] ? "✓" : ""}</span><div><strong>{task.title}</strong><span>{task.detail}</span></div><Badge>{done[task.key] ? "Done" : "Today"}</Badge>
        </button>)}</div>
      </section>

      <section className={styles.homeCard}>
        <SectionHeader kicker="THIS WEEK" title="Zone 2 · Kitchen / pantry" right={<Badge tone="purple">15 min at a time</Badge>} />
        <div className={styles.zoneHero}><strong>Attention rotation, not “clean the whole kitchen.”</strong><p>Atlas chooses a small useful bite of the current zone. The point is to keep household stewardship from becoming invisible or overwhelming.</p></div>
        <div className={styles.zoneStrip} aria-label="Five household zones"><span>1</span><span data-current="true">2</span><span>3</span><span>4</span><span>5</span></div>
        <div className={styles.checkList}>{ZONE_TASKS.map((task, index) => <button type="button" className={styles.checkRow} data-done={Boolean(zoneDone[index])} key={task} onClick={() => setZoneDone((current) => ({ ...current, [index]: !current[index] }))}>
          <span className={styles.checkDot}>{zoneDone[index] ? "✓" : ""}</span><div><strong>{task}</strong><span>One bounded Zone 2 move</span></div><Badge>{zoneDone[index] ? "Done" : "This week"}</Badge>
        </button>)}</div>
      </section>

      <section className={styles.homeCard}>
        <SectionHeader kicker="HOUSEHOLD LAW" title="Protected personal capacity" />
        <div className={styles.profileList}>
          <article className={styles.profileRow}><Badge tone="good">Private</Badge><div><strong>Household work stays personal</strong><span>It can constrain Katie’s day without becoming Elm work, a farm task, or an Owner escalation.</span></div><span /></article>
          <article className={styles.profileRow}><Badge>Rhythm</Badge><div><strong>Ordinary care can recur quietly</strong><span>Atlas should generate only the useful bite for today, not dump the whole household universe into Clock.</span></div><span /></article>
        </div>
      </section>
    </div>
  );
}

function KatieTraining() {
  const [finished, setFinished] = useState(false);
  const [effort, setEffort] = useState<Effort | null>(null);
  return (
    <div className={styles.stack}>
      <section className={styles.campaignHero}><span>DECEMBER TRAINING CAMPAIGN</span><h1>Build the capability, then prove it.</h1><p>One campaign carries Katie toward both races. Sessions are generated from the plan; only today’s session enters Clock.</p></section>

      <div className={styles.eventGrid}>
        <article className={styles.eventCard}><span>DECEMBER 6 · 2026</span><h2>YMCA Tri at the Y</h2><p>15 min swim → 15 min bike → 15 min run</p><div className={styles.eventMeta}><strong>45 min</strong><span>continuous multi-discipline effort</span></div></article>
        <article className={styles.eventCard}><span>DECEMBER 11 · 2026</span><h2>Santa’s CHRISTMAS EXPLOSION 5K</h2><p>3.1-mile mixed-terrain night race</p><div className={styles.eventMeta}><strong>3.1 mi</strong><span>run / walk readiness</span></div></article>
      </div>

      <section className={styles.trainingCard}>
        <SectionHeader kicker="CURRENT STATE" title="Foundation" right={<Badge tone="purple">Fixture readiness</Badge>} />
        <div className={styles.readiness}><article><strong>40%</strong><span>SWIM</span></article><article><strong>55%</strong><span>BIKE</span></article><article><strong>35%</strong><span>RUN</span></article><article><strong>35%</strong><span>5K</span></article></div>
        <p className={styles.fixtureNote}>These percentages are deliberately fake Design Atlas data. The real product should calculate readiness from demonstrated capabilities and observations, not arbitrary streaks.</p>
      </section>

      <section className={styles.trainingCard}>
        <SectionHeader kicker="TODAY’S SESSION" title="Easy run / walk" right={<Badge>{finished ? "Finished" : "25 min"}</Badge>} />
        <div className={styles.sessionHero}>
          <h2>Conversational effort</h2><p>Today’s goal is comfortable continuous movement, not speed.</p>
          <div className={styles.sessionSteps}><span>5 min easy walk warm-up</span><span>15 min relaxed run / walk</span><span>5 min easy cool-down</span></div>
          {!finished ? <button className={styles.primaryButton} type="button" onClick={() => setFinished(true)}>Finished</button> : <>
            <strong>How did it feel?</strong>
            <div className={styles.effortRow}>{(["Easy", "Good", "Hard", "Couldn’t finish"] as Effort[]).map((item) => <button type="button" key={item} data-active={effort === item} onClick={() => setEffort(item)}>{item}</button>)}</div>
            {effort ? <p className={styles.helper}>Recorded as training observation: <strong>{effort}</strong>. In the real system this evidence informs progression; it does not merely color a completed task.</p> : null}
          </>}
        </div>
      </section>

      <section className={styles.trainingCard}>
        <SectionHeader kicker="DEMONSTRATED CAPABILITY" title="What Katie is becoming able to do" />
        <div className={styles.progressList}>{CAPABILITIES.map((item) => <article className={styles.progressRow} data-done={item.done} key={item.label}><i>{item.done ? "✓" : ""}</i><span>{item.label}</span><small>{item.note}</small></article>)}</div>
      </section>

      <section className={styles.trainingCard}>
        <SectionHeader kicker="BENCHMARKS" title="Periodic evidence, not constant testing" />
        <div className={styles.profileList}>
          <article className={styles.profileRow}><Badge tone="good">Baseline</Badge><div><strong>Comfortable run / walk + swim + 15-min bike</strong><span>Establish what is true before Atlas progresses the plan.</span></div><span /></article>
          <article className={styles.profileRow}><Badge>Sep 21</Badge><div><strong>Repeat benchmark</strong><span>Look for demonstrated change.</span></div><span /></article>
          <article className={styles.profileRow}><Badge>Oct 19</Badge><div><strong>Repeat benchmark</strong><span>Build-phase checkpoint.</span></div><span /></article>
          <article className={styles.profileRow}><Badge>Nov 16</Badge><div><strong>Race-readiness benchmark</strong><span>Final evidence before rehearsal + taper.</span></div><span /></article>
        </div>
      </section>
    </div>
  );
}

function BuyerDockDetail({ onBack }: { onBack: () => void }) {
  const [paid, setPaid] = useState(false);
  const [receiptSent, setReceiptSent] = useState(false);
  const [goingOut, setGoingOut] = useState(false);
  return <div className={styles.buyerDock}>
    <button type="button" className={styles.secondaryButton} onClick={onBack}>‹ Buyers</button>
    <section className={styles.buyerCard}>
      <div className={styles.buyerTopline}><div className={styles.buyerIdentity}><span>BUYER DOCK</span><h1>Ruth’s Flowers</h1><p>Springfield · relationship workspace</p></div><Badge tone="purple">Warm</Badge></div>
      <div className={styles.statusGrid}><article><span>Order</span><strong>Confirmed</strong></article><article><span>Payment</span><strong>{paid ? "Paid" : "Unpaid"}</strong></article><article><span>Fulfillment</span><strong>{goingOut ? "Going Out" : "Waiting"}</strong></article></div>
      <div className={styles.orderHero}><strong>4 × Sunflower bunch — $12.50</strong><span>Total · $50.00 · fake canonical order</span></div>
      <div className={styles.actionRow}><button className={styles.primaryButton} type="button" disabled={paid} onClick={() => setPaid(true)}>{paid ? "Payment confirmed" : "Take payment · $50"}</button><button className={styles.secondaryButton} type="button" disabled={!paid || receiptSent} onClick={() => setReceiptSent(true)}>{receiptSent ? "Receipt sent" : "Send receipt"}</button><button className={styles.secondaryButton} type="button" disabled={goingOut} onClick={() => setGoingOut(true)}>{goingOut ? "On route" : "Add to route"}</button></div>
    </section>

    <section className={styles.buyerCard}><SectionHeader kicker="RELATIONSHIP THREAD" title="One buyer story" /><div className={styles.historyList}>
      <article className={styles.historyRow}><Badge>9:04</Badge><div><strong>Availability emailed</strong><span>Sunflower bunches available this week</span></div><span /></article>
      <article className={styles.historyRow}><Badge>9:18</Badge><div><strong>Response logged</strong><span>Interested in four bunches</span></div><span /></article>
      <article className={styles.historyRow}><Badge tone="good">9:20</Badge><div><strong>Order created</strong><span>4 bunches · exact sellable inventory claimed</span></div><span /></article>
      {paid ? <article className={styles.historyRow}><Badge tone="good">Now</Badge><div><strong>Stripe payment confirmed</strong><span>$50 · payment state changed only after confirmation</span></div><span /></article> : null}
      {receiptSent ? <article className={styles.historyRow}><Badge tone="good">Now</Badge><div><strong>Receipt sent</strong><span>Official payment receipt</span></div><span /></article> : null}
      {goingOut ? <article className={styles.historyRow}><Badge tone="purple">Route</Badge><div><strong>Added to fulfillment route</strong><span>Physical custody is now going out</span></div><span /></article> : null}
    </div></section>

    <section className={styles.buyerCard}><SectionHeader kicker="QUICK ACTIONS" title="Relationship work" /><div className={styles.actionRow}><button className={styles.secondaryButton} type="button">Email</button><button className={styles.secondaryButton} type="button">Log response</button><button className={styles.secondaryButton} type="button">Edit order</button><button className={styles.secondaryButton} type="button">Add note</button></div><p className={styles.fixtureNote}>All buttons in Design Atlas are local fixture interactions. No Stripe call, email, order mutation, inventory reservation, or route write leaves this screen.</p></section>
  </div>;
}

function KatieBuyer() {
  const [tab, setTab] = useState<BuyerTab>("week");
  const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null);
  if (selectedBuyer === "ruth") return <BuyerDockDetail onBack={() => setSelectedBuyer(null)} />;
  return <div className={styles.stack}>
    <section className={styles.intro}><span>ELM · BUYER DESK</span><h1>Sell what Atlas says Katie is allowed to sell.</h1><p>Physical harvest truth belongs upstream. Owner release creates commercial availability; Katie turns that into buyer relationships, orders and fulfillment.</p></section>
    <nav className={styles.subnav} aria-label="Fake Buyer Desk sections">{([['week','This Week'],['buyers','Buyers'],['orders','Orders'],['route','My Route'],['history','History']] as Array<[BuyerTab,string]>).map(([key,label]) => <button type="button" key={key} data-active={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>

    {tab === "week" ? <>
      <section className={styles.buyerCard}><SectionHeader kicker="PUBLISHED AVAILABILITY" title="Sunflower bunches" right={<Badge tone="good">12 remaining</Badge>} /><div className={styles.metricGrid}><article><span>Published</span><strong>20</strong><small>Owner release</small></article><article><span>Ordered</span><strong>8</strong><small>Canonical claims</small></article><article><span>Remaining</span><strong>12</strong><small>Katie may sell</small></article></div><div className={styles.availabilityBar}><i /></div><p className={styles.fixtureNote}>Ready inventory is not automatically Katie inventory. This fixture uses the newer authority membrane: physical Ready → Owner release → sellable availability.</p></section>
      <section className={styles.buyerCard}><SectionHeader kicker="BUYER PRESSURE" title="Who needs attention" /><div className={styles.buyerList}>{BUYERS.map((buyer, index) => <button type="button" key={buyer.name} className={styles.buyerRow} onClick={() => index === 0 ? setSelectedBuyer("ruth") : setTab("buyers")}><span className={styles.avatar}>{buyer.initials}</span><div><strong>{buyer.name}</strong><span>{buyer.city}</span></div><Badge tone={buyer.tone}>{buyer.state}</Badge></button>)}</div></section>
    </> : null}

    {tab === "buyers" ? <section className={styles.buyerCard}><SectionHeader kicker="ACCOUNTS" title="Buyer relationships" /><div className={styles.buyerList}>{BUYERS.map((buyer, index) => <button type="button" key={buyer.name} className={styles.buyerRow} onClick={() => index === 0 ? setSelectedBuyer("ruth") : undefined}><span className={styles.avatar}>{buyer.initials}</span><div><strong>{buyer.name}</strong><span>{buyer.city} · relationship memory follows the buyer</span></div><Badge tone={buyer.tone}>{buyer.state}</Badge></button>)}</div></section> : null}

    {tab === "orders" ? <section className={styles.buyerCard}><SectionHeader kicker="CANONICAL ORDERS" title="Orders" /><div className={styles.orderList}>
      <article className={styles.orderRow}><Badge tone="good">Confirmed</Badge><div><strong>Ruth’s Flowers · 4 bunches</strong><span>$50 · Unpaid · Thursday delivery</span></div><Badge>Waiting</Badge></article>
      <article className={styles.orderRow}><Badge tone="warn">Draft</Badge><div><strong>Main Street Floral · 3 bunches</strong><span>Price set · buyer confirmation needed</span></div><Badge>Unpaid</Badge></article>
      <article className={styles.orderRow}><Badge tone="good">Confirmed</Badge><div><strong>Linda’s Flowers · 1 sample + 2 bunches</strong><span>Paid · Friday route</span></div><Badge tone="purple">Going Out</Badge></article>
    </div></section> : null}

    {tab === "route" ? <section className={styles.buyerCard}><SectionHeader kicker="MY ROUTE" title="Springfield florist round" right={<Badge>3 stops</Badge>} /><div className={styles.routeList}>
      <article className={styles.routeRow}><span className={styles.avatar}>1</span><div><strong>Ruth’s Flowers</strong><span>4 sunflower bunches · payment still open</span></div><Badge>Deliver</Badge></article>
      <article className={styles.routeRow}><span className={styles.avatar}>2</span><div><strong>Linda’s Flowers</strong><span>2 bunches + sample · paid</span></div><Badge tone="good">Ready</Badge></article>
      <article className={styles.routeRow}><span className={styles.avatar}>3</span><div><strong>Main Street Floral</strong><span>Prospect · 4 sellable bunches in route custody</span></div><Badge tone="warn">Sell / return</Badge></article>
    </div><div className={styles.actionRow}><button className={styles.secondaryButton} type="button">Return remaining</button></div><p className={styles.fixtureNote}>Carried flowers remain inventory. They do not become sales until an actual commitment exists.</p></section> : null}

    {tab === "history" ? <section className={styles.buyerCard}><SectionHeader kicker="COMMERCIAL MEMORY" title="Recent relationship events" /><div className={styles.historyList}>
      <article className={styles.historyRow}><Badge>Aug 29</Badge><div><strong>Ruth’s Flowers · response logged</strong><span>Interested in four sunflower bunches</span></div><span /></article>
      <article className={styles.historyRow}><Badge>Aug 28</Badge><div><strong>Linda’s Flowers · sample left</strong><span>Follow up after Friday</span></div><span /></article>
      <article className={styles.historyRow}><Badge>Aug 27</Badge><div><strong>Main Street Floral · added as prospect</strong><span>Nixa route candidate</span></div><span /></article>
    </div></section> : null}
  </div>;
}

function KatieMe() {
  return <div className={styles.stack}>
    <section className={styles.intro}><span>ME · IDENTITY + BOUNDARIES</span><h1>Katie has one Atlas account, not one app per role.</h1><p>Personal domains stay private. Elm grants only the commercial authority required for Buyer Desk work.</p></section>
    <section className={styles.homeCard}><SectionHeader kicker="PERSONAL" title="Private domains" /><div className={styles.profileList}><article className={styles.profileRow}><Badge tone="good">Private</Badge><div><strong>Household</strong><span>Rhythms, zones and household obligations</span></div><span /></article><article className={styles.profileRow}><Badge tone="good">Private</Badge><div><strong>Training</strong><span>Goals, sessions, observations and demonstrated capability</span></div><span /></article></div></section>
    <section className={styles.homeCard}><SectionHeader kicker="ELM AUTHORITY" title="Buyer / Distribution" /><div className={styles.profileList}><article className={styles.profileRow}><Badge tone="purple">Allowed</Badge><div><strong>Sell published inventory</strong><span>Create orders, collect verified payment, send receipts, execute assigned route</span></div><span /></article><article className={styles.profileRow}><Badge tone="warn">Not allowed</Badge><div><strong>Manufacture physical or commercial truth</strong><span>No harvest rewriting, no increasing Owner-published availability, no manual Stripe-success claims</span></div><span /></article></div></section>
    <section className={styles.homeCard}><SectionHeader kicker="CAPACITY" title="One person, one finite day" /><p className={styles.helper}>Atlas may use household, family and training commitments to understand Katie’s available capacity. That does not make the contents of those private domains Elm commercial data.</p></section>
  </div>;
}

export default function KatiePortalFixture({ tab }: { tab: KatieFixtureTab }) {
  const surface = useMemo(() => {
    if (tab === "home") return <KatieHome />;
    if (tab === "clock") return <KatieClock />;
    if (tab === "training") return <KatieTraining />;
    if (tab === "buyer") return <KatieBuyer />;
    return <KatieMe />;
  }, [tab]);
  return surface;
}
