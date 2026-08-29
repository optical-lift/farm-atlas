"use client";

import { useMemo, useState, type ReactNode } from "react";

import { AtlasAppShell, AtlasCard, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import homeStyles from "@/components/atlas/home/universal-home-v2.module.css";
import DestinationContactCardSpecimen from "../task-card-lab/DestinationContactCardSpecimen";
import FarmRoundCardSpecimen from "../task-card-lab/FarmRoundCardSpecimen";
import HarvestCardSpecimen from "../task-card-lab/HarvestCardSpecimen";
import MowCardSpecimen from "../task-card-lab/MowCardSpecimen";
import OneOffFieldWorkCardSpecimen from "../task-card-lab/OneOffFieldWorkCardSpecimen";
import PickupHandoffCardSpecimen from "../task-card-lab/PickupHandoffCardSpecimen";
import { TransplantCardSpecimen } from "../task-card-lab/RemainingDominionCardSpecimens";
import SowCardSpecimen from "../task-card-lab/SowCardSpecimen";
import VenueCardSpecimen from "../task-card-lab/VenueCardSpecimen";
import WeedCardSpecimen from "../task-card-lab/WeedCardSpecimen";
import styles from "./real-atlas-portal.module.css";

type PersonaKey = "principal" | "anna" | "katie" | "marshall";
type ScopeKey = "principal" | "feast" | "elm";
type PortalTab = "home" | "work" | "workspaces" | "calendar" | "more";
type TaskKey = "destination" | "venue" | "sow" | "weed" | "mow" | "harvest" | "pickup" | "transplant" | "stewardship" | "setup";
type TaskState = "done" | "current" | "next" | "later";

type FakeTask = {
  key: TaskKey;
  family: string;
  title: string;
  place: string;
  detail: string;
  time: string;
  window: "Morning" | "Afternoon" | "Evening";
  state: TaskState;
};

const PERSONAS: Array<{ key: PersonaKey; name: string; role: string; scope: ScopeKey }> = [
  { key: "principal", name: "Principal", role: "Owner / coordination", scope: "principal" },
  { key: "anna", name: "Anna", role: "Farm hand / execution", scope: "elm" },
  { key: "katie", name: "Katie", role: "Commercial / Buyer Desk", scope: "feast" },
  { key: "marshall", name: "Marshall", role: "Shared operations", scope: "elm" },
];

const SCOPE_LABELS: Record<ScopeKey, string> = { principal: "Principal", feast: "Feast Guild", elm: "Elm Farm" };

const TASKS: FakeTask[] = [
  { key: "stewardship", family: "Stewardship", title: "Saturday Farm Round", place: "Elm Farm", detail: "Open the farm and record what changed", time: "6:30", window: "Morning", state: "done" },
  { key: "harvest", family: "Harvest", title: "Harvest ProCut Orange sunflower", place: "Field Rows", detail: "Cut market-ready stems", time: "7:00", window: "Morning", state: "done" },
  { key: "weed", family: "Weed", title: "Weed Field Row 13", place: "Field Rows", detail: "Clear the crop row before heat builds", time: "8:00", window: "Morning", state: "current" },
  { key: "transplant", family: "Transplant", title: "Transplant cabbage into MG7", place: "Main Garden", detail: "Bed is ready after current move", time: "8:45", window: "Morning", state: "next" },
  { key: "sow", family: "Sow", title: "Sow ProCut White Lite", place: "Barn Beds", detail: "Next succession", time: "9:45", window: "Morning", state: "later" },
  { key: "setup", family: "Setup + protect", title: "String the next Barn Bed", place: "Barn Beds", detail: "Prepare support before growth needs it", time: "10:30", window: "Morning", state: "later" },
  { key: "venue", family: "Venue", title: "Reset Farmhouse for workshop", place: "Farmhouse", detail: "Arrival state: guest ready", time: "1:00", window: "Afternoon", state: "later" },
  { key: "pickup", family: "Pickup / handoff", title: "Stage florist pickups", place: "Flower Room", detail: "Hold each order in outbound custody", time: "2:00", window: "Afternoon", state: "later" },
  { key: "destination", family: "Destination", title: "Deliver sample flowers", place: "Springfield route", detail: "Commercial handoff", time: "3:00", window: "Afternoon", state: "later" },
  { key: "mow", family: "Mow", title: "Mow orchard edge", place: "Orchard", detail: "Evening outdoor window", time: "7:15", window: "Evening", state: "later" },
];

const TABS: Array<{ key: PortalTab; label: string; icon: "home" | "work" | "workspaces" | "calendar" | "more" }> = [
  { key: "home", label: "Home", icon: "home" },
  { key: "work", label: "Work", icon: "work" },
  { key: "workspaces", label: "Workspaces", icon: "workspaces" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "more", label: "More", icon: "more" },
];

function DockIcon({ kind }: { kind: "home" | "work" | "workspaces" | "calendar" | "more" }) {
  const common = { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, focusable: false };
  if (kind === "home") return <svg {...common} aria-hidden="true"><path d="M3.75 10.25 12 3.75l8.25 6.5"/><path d="M5.5 9.5v10h13v-10"/><path d="M9.25 19.5v-5.75h5.5v5.75"/></svg>;
  if (kind === "work") return <svg {...common} aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="17" rx="3"/><path d="m8.25 12.25 2.35 2.35 5.25-5.35"/></svg>;
  if (kind === "workspaces") return <svg {...common} aria-hidden="true"><rect x="3.75" y="3.75" width="6.5" height="6.5" rx="1.5"/><rect x="13.75" y="3.75" width="6.5" height="6.5" rx="1.5"/><rect x="3.75" y="13.75" width="6.5" height="6.5" rx="1.5"/><rect x="13.75" y="13.75" width="6.5" height="6.5" rx="1.5"/></svg>;
  if (kind === "calendar") return <svg {...common} aria-hidden="true"><rect x="3.75" y="5.25" width="16.5" height="15" rx="2.5"/><path d="M7.5 3.5v3.5M16.5 3.5v3.5M3.75 9.25h16.5"/></svg>;
  return <svg {...common} aria-hidden="true"><circle cx="5.5" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.35" fill="currentColor" stroke="none"/></svg>;
}

function TaskSpecimen({ taskKey }: { taskKey: TaskKey }) {
  if (taskKey === "destination") return <DestinationContactCardSpecimen />;
  if (taskKey === "venue") return <VenueCardSpecimen />;
  if (taskKey === "sow") return <SowCardSpecimen />;
  if (taskKey === "weed") return <WeedCardSpecimen />;
  if (taskKey === "mow") return <MowCardSpecimen />;
  if (taskKey === "harvest") return <HarvestCardSpecimen />;
  if (taskKey === "pickup") return <PickupHandoffCardSpecimen />;
  if (taskKey === "transplant") return <TransplantCardSpecimen />;
  if (taskKey === "stewardship") return <FarmRoundCardSpecimen />;
  return <OneOffFieldWorkCardSpecimen />;
}

function FakeWeekRail() {
  const days = [
    ["M", "24", "✓"], ["T", "25", "✓"], ["W", "26", "2"], ["T", "27", "4"], ["F", "28", "3"], ["S", "29", "8"], ["S", "30", "—"],
  ];
  return (
    <section className={homeStyles.timeRail} aria-label="Pretend days in this week">
      <div className={homeStyles.days}>
        {days.map(([weekday, day, marker], index) => (
          <button type="button" className={index === 5 ? homeStyles.today : undefined} key={`${weekday}-${day}`}>
            <small>{weekday}</small><strong>{day}</strong><em>{marker}</em>
          </button>
        ))}
      </div>
      <nav className={homeStyles.timeRoutes}><button type="button">‹ Previous week</button><button type="button">This week · 17</button><button type="button">Month ›</button></nav>
    </section>
  );
}

function HeroMove({ category, title, meta, detail, current = false, action }: { category: string; title: string; meta: string; detail?: string; current?: boolean; action?: string }) {
  return (
    <article className={homeStyles.heroMove} data-state="ready" data-position={current ? "current" : "next"}>
      <button type="button" className={homeStyles.heroMoveBody}>
        <small>{category}</small><strong>{title}</strong><span>{meta}</span>{detail ? <em>{detail}</em> : null}
      </button>
      {action ? <button type="button" className={homeStyles.heroAction}>{action}</button> : null}
    </article>
  );
}

function FakeHome({ persona }: { persona: PersonaKey }) {
  const farmHand = persona === "anna" || persona === "marshall";
  const principal = persona === "principal";
  const commercial = persona === "katie";
  return (
    <div className={homeStyles.home}>
      <div className={homeStyles.todayStack}>
        <AtlasCard variant="purple" className={homeStyles.hero} ariaLabel="Pretend Atlas today cover">
          <div className={homeStyles.heroHead}>
            <div className={homeStyles.heroIdentity}><span>{farmHand ? "Your next move" : commercial ? "Commercial today" : "Today at Elm Farm"}</span><em>Saturday, Aug 29</em></div>
            <span className={homeStyles.heroStatus}><b>{farmHand ? "7 more things lined up today" : commercial ? "4 buyer moves open" : "3 of 7 personal tasks dealt with · 4 open"}</b>{principal ? <em>2 decisions need judgment</em> : null}</span>
          </div>
          <div className={homeStyles.heroGrid} data-task-count={farmHand ? 1 : 3}>
            {farmHand ? <HeroMove category="Next at Elm" title={persona === "anna" ? "Weed Field Row 13" : "Adjust north barn door"} meta={persona === "anna" ? "Field Rows · Morning" : "Barn · Project move"} detail="Atlas is holding the rest of the order." current action="Start" /> : null}
            {principal ? <><HeroMove category="Owner" title="Set September operating calendar" meta="Principal · 35 min" current action="Finish"/><HeroMove category="Decision" title="Resolve Thursday capacity" meta="Elm Farm · Community day"/><HeroMove category="Commercial" title="Approve standing-order rule" meta="Buyer Desk · 20 min"/></> : null}
            {commercial ? <><HeroMove category="Buyer" title="Follow up with Ruth’s Flowers" meta="Springfield · sample opportunity" current action="Start"/><HeroMove category="Commitment" title="Confirm House of Flowers order" meta="3 bundles · Friday route"/><HeroMove category="Route" title="Stage Friday delivery loop" meta="3 stops"/></> : null}
          </div>
        </AtlasCard>
        <FakeWeekRail />
      </div>

      {principal ? (
        <AtlasCard as="section" className={homeStyles.lens} ariaLabel="Needs you">
          <header className={homeStyles.lensHeader}><div><span>Owner lane</span><h2>Needs you</h2></div><button type="button">3</button></header>
          <div className={homeStyles.lensList}>
            <button type="button"><div><small>Decision</small><strong>Thursday capacity needs a final call</strong><span>Workshop demand is pressing against the protected community-day shape.</span></div><b>›</b></button>
            <button type="button"><div><small>Blocked</small><strong>MG7 transplant timing is tightening</strong><span>The prerequisite is unresolved while the biological window keeps moving.</span></div><b>›</b></button>
          </div>
        </AtlasCard>
      ) : null}

      {commercial ? (
        <AtlasCard as="section" className={homeStyles.lens} ariaLabel="Commercial pressure">
          <header className={homeStyles.lensHeader}><div><span>Commercial lane</span><h2>This week</h2></div><button type="button">4</button></header>
          <div className={homeStyles.lensList}>
            <button type="button"><div><small>Today</small><strong>Ruth’s Flowers</strong><span>Sample opportunity · contact still open.</span></div><b>›</b></button>
            <button type="button"><div><small>Waiting</small><strong>Schaffitzel’s Flowers</strong><span>Standing-order follow-up has not resolved.</span></div><b>›</b></button>
          </div>
        </AtlasCard>
      ) : null}

      <section className={homeStyles.farmsSection} aria-label="Pretend farm state">
        <div className={homeStyles.farmCards}>
          <article className={homeStyles.farmCard}>
            <header className={homeStyles.farmCardHead}><div><small>{farmHand ? "Working at · Marshfield, MO" : "Stewarding · Marshfield, MO"}</small><h3>Elm Farm</h3></div><span className={homeStyles.frostBadge} data-frost-known="true"><b>47</b><em>days to frost</em></span></header>
            <div className={homeStyles.farmMetrics}><div><b>21</b><span>beds growing</span></div><div><b>1,944</b><span>sq ft active</span></div><div><b>382</b><span>stems this year</span></div></div>
            <div className={homeStyles.bedProgress}><div><span>21 of 34 mapped beds growing</span><b>62%</b></div><i aria-hidden="true"><span style={{ width: "62%" }}/></i></div>
            <footer className={homeStyles.farmCardFoot}><span>18 sowings recorded this year</span><b>Oct 15 boundary</b></footer>
          </article>
        </div>
      </section>
    </div>
  );
}

function FakeTaskRow({ task, onOpen }: { task: FakeTask; onOpen: (key: TaskKey) => void }) {
  const complete = task.state === "done";
  const current = task.state === "current";
  const routeClass = current ? " atlas-day-route-current" : task.state === "next" ? " atlas-day-route-next" : "";
  return (
    <div className={`atlas-day-task-entry${complete ? " atlas-day-complete-entry" : ""}${routeClass}`}>
      <button type="button" className={`atlas-day-task-node${complete ? " is-complete" : ""}`} aria-label={complete ? `Completed ${task.title}` : `Pretend complete ${task.title}`}><span aria-hidden="true"/></button>
      <details className={`atlas-day-task-card atlas-journal-task-row${complete ? " complete" : ""}${routeClass}`} aria-current={current ? "step" : undefined}>
        <summary onClick={(event) => { event.preventDefault(); onOpen(task.key); }}>
          {!complete ? <small className="atlas-day-task-family">{current ? `Current · ${task.family}` : task.family}</small> : null}
          <strong>{task.title}</strong>
          <span>{complete ? "Complete" : `${task.time} · ${task.place}`}</span>
          <em>{task.detail}</em>
          {!complete ? <span className="atlas-day-task-cues"><i>{task.window}</i>{task.state === "next" ? <i>Next</i> : null}</span> : null}
          <b className="atlas-journal-row-caret" aria-hidden="true">⌄</b>
        </summary>
      </details>
    </div>
  );
}

function FakeWorkerDay({ onOpenTask }: { onOpenTask: (key: TaskKey) => void }) {
  const groups = ["Morning", "Afternoon", "Evening"] as const;
  return (
    <div className="atlas-task-page-body">
      <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
        <div className="atlas-day-browse-head"><button type="button" className="atlas-route-back atlas-day-back">← Week</button><div className="atlas-day-browse-title-row"><span>Sat · Aug 29</span><strong>8 open · 2 done</strong></div><p>10 pretend tasks in the real Day presentation</p></div>
        <article className="atlas-day-command-header" data-day-denominator="2/10">
          <div className="atlas-day-command-topline"><div className="atlas-day-command-date"><strong>Saturday, Aug 29</strong><span>8 still in today</span></div><div className="atlas-day-filter-pill atlas-day-view-toggle"><button type="button" className="selected">Timeline</button><button type="button">Zone</button></div></div>
          <div className={styles.dayProgress}><div><span>2 of 10 dealt with</span><b>20%</b></div><i><span style={{ width: "20%" }}/></i></div>
        </article>
        <div className="atlas-day-task-groups">
          <article className="atlas-day-route-group atlas-day-work-order-group atlas-day-timeline-group">
            <h3>Work the day</h3>
            <div className="atlas-day-work-order-list atlas-day-route-spine atlas-day-mixed-timeline">
              {groups.map((group) => (
                <section className={styles.windowGroup} key={group} data-window={group.toLowerCase()}>
                  <header><span>{group}</span><small>{TASKS.filter((task) => task.window === group).length} moves</small></header>
                  {TASKS.filter((task) => task.window === group).map((task) => <FakeTaskRow task={task} onOpen={onOpenTask} key={task.key}/>) }
                </section>
              ))}
            </div>
          </article>
        </div>
        <nav className="atlas-day-adjacent-nav" aria-label="Pretend adjacent days"><button type="button"><span aria-hidden="true">←</span><em>Yesterday</em></button><button type="button"><em>Tomorrow</em><span aria-hidden="true">→</span></button></nav>
      </section>
    </div>
  );
}

function SimpleCard({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return <AtlasCard as="section" className={styles.simpleCard}><header><span>{kicker}</span><h2>{title}</h2></header>{children}</AtlasCard>;
}

function FakeWork({ persona, onOpenTask }: { persona: PersonaKey; onOpenTask: (key: TaskKey) => void }) {
  if (persona === "anna" || persona === "marshall") return <FakeWorkerDay onOpenTask={onOpenTask}/>;
  if (persona === "katie") return <div className={styles.stack}><SimpleCard kicker="THIS WEEK" title="Buyer Desk"><div className={styles.metricGrid}><article><span>Available</span><strong>17</strong><small>Sunflower bundles</small></article><article><span>Committed</span><strong>6</strong><small>Across 3 buyers</small></article><article><span>Need contact</span><strong>4</strong><small>Accounts</small></article></div></SimpleCard><SimpleCard kicker="BUYER PRESSURE" title="Who needs movement"><div className={styles.rowList}><button type="button"><span>Today</span><strong>Ruth’s Flowers</strong><small>Sample opportunity</small><b>›</b></button><button type="button"><span>Waiting</span><strong>Schaffitzel’s Flowers</strong><small>Standing-order question open</small><b>›</b></button><button type="button"><span>Route</span><strong>Friday delivery loop</strong><small>3 stops</small><b>›</b></button></div></SimpleCard></div>;
  return <div className={styles.stack}><SimpleCard kicker="MY WORK" title="Owner obligations"><div className={styles.rowList}><button type="button"><span>Now</span><strong>Set September operating calendar</strong><small>Principal · 35 min</small><b>›</b></button><button type="button"><span>Next</span><strong>Resolve Buyer Desk offer boundary</strong><small>Commercial · 20 min</small><b>›</b></button><button type="button"><span>Later</span><strong>Review Clock architecture</strong><small>Atlas · protected strategic work</small><b>›</b></button></div></SimpleCard><SimpleCard kicker="TEAM TODAY" title="Visible, not in your queue"><div className={styles.rowList}><button type="button"><span>Anna</span><strong>Main Garden</strong><small>Executing current move</small><b>›</b></button><button type="button"><span>Katie</span><strong>Buyer Desk</strong><small>Commercial outreach</small><b>›</b></button></div></SimpleCard></div>;
}

const WORKSPACE_GROUPS = [
  ["Operating reality", ["Production", "Harvest", "Places & Objects", "Projects & Trails", "Care"]],
  ["Commercial", ["Buyer Desk", "Bookings & Events"]],
  ["Governance", ["People & Roles", "Rulebook & Rhythms"]],
] as const;

function FakeWorkspaces({ persona }: { persona: PersonaKey }) {
  const groups = persona === "katie" ? WORKSPACE_GROUPS.filter(([group]) => group === "Commercial") : WORKSPACE_GROUPS;
  return <div className={styles.stack}><section className={styles.routeIntro}><span>WORKSPACES</span><h1>The shared Atlas world.</h1><p>Durable domains use the same card and route language as the live app.</p></section>{groups.map(([group, items]) => <SimpleCard kicker={group.toUpperCase()} title={group} key={group}><div className={styles.routeList}>{items.map((item) => <button type="button" key={item}><div><strong>{item}</strong><span>{item === "Buyer Desk" ? "Accounts, commitments and fulfillment" : "Open shared operating truth"}</span></div><b>›</b></button>)}</div></SimpleCard>)}</div>;
}

function FakeCalendar() {
  return <div className={styles.stack}><section className={styles.routeIntro}><span>CALENDAR</span><h1>Time stays quiet.</h1><p>Use the real day rail and compact commitment rows rather than a separate dashboard language.</p></section><FakeWeekRail/><SimpleCard kicker="SATURDAY · AUG 29" title="Fixed edges"><div className={styles.rowList}><button type="button"><span>8:00</span><strong>Outdoor work window</strong><small>Field conditions favorable</small><b>›</b></button><button type="button"><span>1:00</span><strong>Farmhouse workshop reset</strong><small>Fixed hard edge</small><b>›</b></button><button type="button"><span>3:00</span><strong>Springfield sample route</strong><small>Commercial commitment</small><b>›</b></button></div></SimpleCard></div>;
}

function FakeMore() {
  return <div className={styles.stack}><section className="atlas-more-page__intro"><span>MORE</span><h1>Atlas</h1><p>Identity, deeper tools, governance, and Design Atlas live here without becoming permanent dock clutter.</p></section><section className="atlas-more-page__list"><button type="button"><div><strong>People & roles</strong><span>Authority and membership</span></div><b>›</b></button><button type="button"><div><strong>Rulebook & rhythms</strong><span>Recurring operating law</span></div><b>›</b></button><button type="button"><div><strong>Design Atlas</strong><span>Visual workshop and fake product</span></div><b>›</b></button></section></div>;
}

function DesignLens({ persona, scope, onPersona, onScope }: { persona: PersonaKey; scope: ScopeKey; onPersona: (value: PersonaKey) => void; onScope: (value: ScopeKey) => void }) {
  return (
    <details className={styles.designLens}>
      <summary><span>DESIGN LENS</span><strong>{PERSONAS.find((item) => item.key === persona)?.name} · {SCOPE_LABELS[scope]}</strong><b aria-hidden="true">⌄</b></summary>
      <div>
        <p>Fixture only. This control is not proposed as customer-facing Atlas UI.</p>
        <label><span>View as</span><div>{PERSONAS.map((item) => <button type="button" data-active={persona === item.key} onClick={() => onPersona(item.key)} key={item.key}>{item.name}</button>)}</div></label>
        <label><span>Scope</span><div>{(["principal", "feast", "elm"] as ScopeKey[]).map((item) => <button type="button" data-active={scope === item} onClick={() => onScope(item)} key={item}>{SCOPE_LABELS[item]}</button>)}</div></label>
      </div>
    </details>
  );
}

export default function RealAtlasPortal() {
  const [persona, setPersona] = useState<PersonaKey>("anna");
  const [scope, setScope] = useState<ScopeKey>("elm");
  const [tab, setTab] = useState<PortalTab>("home");
  const [openTask, setOpenTask] = useState<TaskKey | null>(null);
  const personaMeta = useMemo(() => PERSONAS.find((item) => item.key === persona) ?? PERSONAS[1], [persona]);

  function choosePersona(value: PersonaKey) {
    const next = PERSONAS.find((item) => item.key === value) ?? PERSONAS[1];
    setPersona(value); setScope(next.scope); setTab("home"); setOpenTask(null);
  }

  return (
    <AtlasAppShell
      className={`atlas-home-shell ${styles.root}`}
      frameClassName={styles.frame}
      data-atlas-real-portal="true"
      data-live-data-binding="none"
      data-mutation-capability="none"
      afterFrame={
        <nav className="atlas-context-footer" aria-label="Design Atlas pretend destinations">
          <div className="atlas-context-footer__rail" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
            {TABS.map((item) => <button type="button" className="atlas-context-footer__item" aria-current={tab === item.key ? "page" : undefined} onClick={() => setTab(item.key)} key={item.key}><span className="atlas-context-footer__icon" aria-hidden="true"><DockIcon kind={item.icon}/></span><strong>{item.label}</strong></button>)}
          </div>
        </nav>
      }
    >
      <AtlasTopBar title={SCOPE_LABELS[scope]} status={<span className="atlas-weather-line">{persona === "anna" ? "82° · clear" : personaMeta.role}</span>} action={<button type="button" className="atlas-global-note-plus" aria-label="Design Atlas fixture marker">D</button>}/>
      <div className={styles.body}>
        <DesignLens persona={persona} scope={scope} onPersona={choosePersona} onScope={setScope}/>
        {tab === "home" ? <FakeHome persona={persona}/> : null}
        {tab === "work" ? <FakeWork persona={persona} onOpenTask={setOpenTask}/> : null}
        {tab === "workspaces" ? <FakeWorkspaces persona={persona}/> : null}
        {tab === "calendar" ? <FakeCalendar/> : null}
        {tab === "more" ? <FakeMore/> : null}
      </div>
      {persona === "anna" && (tab === "home" || tab === "work") ? <button type="button" className={styles.logFab} aria-label="Pretend one-sentence work log">+</button> : null}
      {openTask ? <div className={styles.taskOverlay} role="dialog" aria-modal="true" aria-label={`${TASKS.find((task) => task.key === openTask)?.family ?? "Task"} specimen`}><div className={styles.taskSheet}><header><div><span>REAL TASK TEMPLATE · FAKE DATA</span><strong>{TASKS.find((task) => task.key === openTask)?.title}</strong><small>Same Task Card Editor specimen, opened from the real Day presentation.</small></div><button type="button" onClick={() => setOpenTask(null)} aria-label="Close pretend task">×</button></header><div className={styles.taskSpecimen}><TaskSpecimen taskKey={openTask}/></div></div></div> : null}
    </AtlasAppShell>
  );
}
