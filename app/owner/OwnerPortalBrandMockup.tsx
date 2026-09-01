"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "./owner-portal-brand.module.css";

type ViewKey = "today" | "week" | "life" | "people" | "work" | "money";

type DetailFact = {
  label: string;
  value: string;
};

type Detail = {
  eyebrow: string;
  title: string;
  summary?: string;
  facts: DetailFact[];
};

type OwnerPortalBrandMockupProps = {
  personName: string;
};

const VIEWS: Array<{ key: ViewKey; label: string; note: string }> = [
  { key: "today", label: "Today", note: "What has the floor" },
  { key: "week", label: "Week", note: "Capacity and protection" },
  { key: "life", label: "Life", note: "The whole field" },
  { key: "people", label: "People", note: "Relationships over time" },
  { key: "work", label: "Work", note: "Seats and outcomes" },
  { key: "money", label: "Money", note: "House position" },
];

const CONTEXTS = [
  { label: "All of my Atlas", detail: "Personal + every lawful connection" },
  { label: "Personal", detail: "Private to you" },
  { label: "Household", detail: "Private household domain" },
  { label: "Feast Guild", detail: "Owned institution" },
  { label: "Elm", detail: "Operating unit" },
  { label: "Write Now", detail: "Owned institution" },
  { label: "Optical Lift", detail: "Owned institution" },
];

const DETAIL_LIBRARY: Record<string, Detail> = {
  septemberShape: {
    eyebrow: "FEAST GUILD · PRINCIPAL",
    title: "Set September’s Feast Guild booking shape",
    summary: "Atlas is giving this the floor because the decision affects future capacity and requires owner judgment.",
    facts: [
      { label: "Why now", value: "September is close enough that waiting begins to consume good options." },
      { label: "Authority", value: "Principal decision" },
      { label: "Time truth", value: "Movable today; should not drift indefinitely" },
      { label: "Visibility", value: "Institutional decision; private calendar facts stay private" },
      { label: "Source", value: "Design fixture for the new person-owned Atlas shell" },
    ],
  },
  familyDinner: {
    eyebrow: "PRIVATE · FIXED TIME",
    title: "Family dinner",
    summary: "Private truth may reserve time without becoming visible to a connected institution.",
    facts: [
      { label: "Time", value: "6:30 PM" },
      { label: "Custody", value: "Private personal time contract" },
      { label: "Shared outward", value: "Unavailable during this window" },
      { label: "Not shared", value: "The private reason for the reservation" },
    ],
  },
  flowerWindow: {
    eyebrow: "ELM · WINDOW AT RISK",
    title: "Friday florist volume may need an owner decision",
    summary: "The operating system should surface the consequence and decision, not a worker’s unfinished task list.",
    facts: [
      { label: "Signal", value: "Demand may outrun currently confirmed harvest-ready volume" },
      { label: "Owner question", value: "Reduce commitment, source more supply, or accept the risk" },
      { label: "Escalation law", value: "Delegated work reaches you only after an explicit threshold is crossed" },
      { label: "Source", value: "Fixture-only exception pattern" },
    ],
  },
  cropRotation: {
    eyebrow: "ELM · PROTECTED FUTURE",
    title: "Protect time for Elm 2027 crop rotation",
    summary: "Quiet future work should receive protected territory before current operations consume the entire horizon.",
    facts: [
      { label: "Horizon", value: "H2 / future preparation" },
      { label: "Owner capability", value: "Think · plan · decide" },
      { label: "Protection", value: "Reserved strategic block" },
      { label: "Reason", value: "Preparation loses value if it starts only after planting choices are already constrained" },
    ],
  },
  waitingRoom: {
    eyebrow: "WAITING ROOM · PROTECTED FUTURE",
    title: "Design the overwintering perennial landscape",
    summary: "This belongs in Atlas before the sowing window becomes urgent.",
    facts: [
      { label: "Horizon", value: "H2" },
      { label: "Window", value: "Prepare before the Sept/Oct sowing window closes" },
      { label: "Claim", value: "Protected future-building work" },
      { label: "Status", value: "Quiet, but legitimate" },
    ],
  },
  farmThree: {
    eyebrow: "PORTFOLIO · H3",
    title: "Keep the Farm 3 acquisition thesis alive",
    summary: "An option can belong to the portfolio before acquisition, funding, or an operating record exists.",
    facts: [
      { label: "Lifecycle", value: "Strategic option" },
      { label: "Horizon", value: "H3" },
      { label: "Capital", value: "Not yet committed" },
      { label: "Next value milestone", value: "Clarify acquisition criteria and reconsideration conditions" },
    ],
  },
  treasury: {
    eyebrow: "MONEY · OWNER DECISION",
    title: "Two capital decisions are waiting for a real house position",
    summary: "Atlas should not pretend money feeds are live when source coverage and freshness are unknown.",
    facts: [
      { label: "Current state", value: "Preview structure only — no financial values are being fabricated" },
      { label: "Required view", value: "Liquid resources, committed outflows, expected inflows, recurring obligations, 30/60/90-day trajectory" },
      { label: "Required provenance", value: "Source, as-of time, coverage, freshness, included accounts/entities" },
      { label: "Decision rule", value: "Capital requests should compete with time, attention, and authority needs — not cash alone" },
    ],
  },
  relationship: {
    eyebrow: "RELATIONSHIP",
    title: "A promised follow-up is nearing its window",
    summary: "Relationship pages should preserve promises and cadence without turning people into a CRM score.",
    facts: [
      { label: "Grammar", value: "Promised by us" },
      { label: "What Atlas remembers", value: "The promise, the relationship, the last meaningful touch, and the next legitimate window" },
      { label: "What it avoids", value: "Generic engagement scoring or manufactured urgency" },
    ],
  },
};

function SectionLabel({ children, count }: { children: string; count?: number }) {
  return (
    <div className={styles.sectionLabel}>
      <span>{children}</span>
      {typeof count === "number" ? <b>{count}</b> : null}
    </div>
  );
}

function Mark({ children, tone = "quiet" }: { children: string; tone?: "quiet" | "strong" | "warning" }) {
  return <span className={styles.mark} data-tone={tone}>{children}</span>;
}

export default function OwnerPortalBrandMockup({ personName }: OwnerPortalBrandMockupProps) {
  const [view, setView] = useState<ViewKey>("today");
  const [context, setContext] = useState(CONTEXTS[0].label);
  const [contextOpen, setContextOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [dateLabel, setDateLabel] = useState("Today");
  const [notice, setNotice] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [previewCaptures, setPreviewCaptures] = useState<string[]>([]);

  useEffect(() => {
    setDateLabel(new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date()));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const firstName = useMemo(() => personName.trim().split(/\s+/)[0] || "Atlas", [personName]);

  function previewAction(message: string) {
    setNotice(`${message} · preview only; nothing was written to production.`);
  }

  function keepCapture() {
    const cleaned = captureText.trim();
    if (!cleaned) return;
    setPreviewCaptures((current) => [cleaned, ...current]);
    setCaptureText("");
    setCaptureOpen(false);
    setNotice("Captured into this browser preview only. Refreshing the page will clear it.");
  }

  return (
    <main className={styles.root} data-atlas-owner-brand-mockup="true">
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.brandCluster}>
            <span className={styles.brand}>ATLAS</span>
            <span className={styles.previewFlag}>DESIGN PREVIEW · READ ONLY</span>
          </div>

          <div className={styles.topActions}>
            <div className={styles.contextControl}>
              <button type="button" className={styles.contextButton} onClick={() => setContextOpen((open) => !open)}>
                <span>{context}</span>
                <b aria-hidden="true">⌄</b>
              </button>
              {contextOpen ? (
                <div className={styles.contextMenu}>
                  <p>LOOK THROUGH</p>
                  {CONTEXTS.map((item) => (
                    <button
                      type="button"
                      key={item.label}
                      data-active={context === item.label}
                      onClick={() => {
                        setContext(item.label);
                        setContextOpen(false);
                      }}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button type="button" className={styles.utilityButton} onClick={() => setAskOpen(true)}>
              Ask Atlas
            </button>
            <button type="button" className={styles.utilityButton} onClick={() => setCaptureOpen(true)}>
              Capture
            </button>
            <button
              type="button"
              className={styles.exceptionButton}
              aria-label="Open Atlas exceptions"
              onClick={() => setExceptionsOpen(true)}
            >
              <span>!</span>
              <b>2</b>
            </button>
            <button type="button" className={styles.personButton} onClick={() => setView("life")} aria-label="Open your Atlas">
              {firstName.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.rail}>
            <div className={styles.identity}>
              <span>YOUR ATLAS</span>
              <strong>{personName}</strong>
              <small>One life · every lawful responsibility</small>
            </div>

            <nav className={styles.primaryNav} aria-label="Atlas views">
              {VIEWS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  data-active={view === item.key}
                  onClick={() => setView(item.key)}
                >
                  <span>{item.label}</span>
                  <small>{item.note}</small>
                </button>
              ))}
            </nav>

            <div className={styles.railGroup}>
              <SectionLabel>CONNECTED</SectionLabel>
              <button type="button" className={styles.connectionRow} onClick={() => setContext("Personal")}>
                <i data-state="private" />
                <span><strong>Personal</strong><small>private</small></span>
              </button>
              <button type="button" className={styles.connectionRow} onClick={() => setContext("Household")}>
                <i data-state="private" />
                <span><strong>Household</strong><small>private</small></span>
              </button>
              <button type="button" className={styles.connectionRow} onClick={() => setContext("Feast Guild")}>
                <i data-state="shared" />
                <span><strong>Feast Guild</strong><small>owned institution</small></span>
              </button>
              <button type="button" className={styles.connectionRow} onClick={() => setContext("Elm")}>
                <i data-state="shared" />
                <span><strong>Elm</strong><small>operating unit</small></span>
              </button>
              <button type="button" className={styles.connectionRow} onClick={() => setContext("Write Now")}>
                <i data-state="shared" />
                <span><strong>Write Now</strong><small>owned institution</small></span>
              </button>
            </div>

            <div className={styles.railGroup}>
              <SectionLabel>TOOLS</SectionLabel>
              <Link className={styles.toolLink} href="/owner/ask-atlas"><span>Ask Atlas</span><small>live read-only intelligence</small></Link>
              <Link className={styles.toolLink} href="/owner/continuity"><span>Continuity</span><small>messages and promises</small></Link>
              <Link className={styles.toolLink} href="/owner/life"><span>Personal Atlas</span><small>live goals + observations</small></Link>
              <Link className={styles.toolLink} href="/owner/household"><span>Household</span><small>private home system</small></Link>
              <Link className={styles.toolLink} href="/owner/design-atlas"><span>Design Atlas</span><small>architecture proof</small></Link>
            </div>

            <p className={styles.privacyNote}>Private truth may shape your day without being disclosed to a connected institution.</p>
          </aside>

          <section className={styles.content}>
            {view === "today" ? (
              <>
                <header className={styles.pageHeader}>
                  <div>
                    <span className={styles.eyebrow}>{dateLabel}</span>
                    <h1>Today</h1>
                    <p>Two things require you. Atlas can keep the rest quiet.</p>
                  </div>
                  <div className={styles.pageHeaderMeta}>
                    <span>LOOKING THROUGH</span>
                    <strong>{context}</strong>
                  </div>
                </header>

                <div className={styles.todayGrid}>
                  <div className={styles.todayMain}>
                    <section className={styles.nowSection}>
                      <SectionLabel>NOW</SectionLabel>
                      <button type="button" className={styles.nowLine} onClick={() => setDetail(DETAIL_LIBRARY.septemberShape)}>
                        <Mark tone="strong">●</Mark>
                        <span>
                          <strong>Set September’s Feast Guild booking shape</strong>
                          <small>Principal decision · movable today</small>
                        </span>
                        <b>Open</b>
                      </button>
                      <div className={styles.nowActions}>
                        <button type="button" onClick={() => setDetail(DETAIL_LIBRARY.septemberShape)}>Open</button>
                        <button type="button" onClick={() => previewAction("Marked complete")}>Done</button>
                        <button type="button" onClick={() => previewAction("Moved within the day")}>Move</button>
                        <button type="button" onClick={() => previewAction("Recorded a blocker")}>Blocked</button>
                      </div>
                    </section>

                    <section className={styles.listSection}>
                      <SectionLabel count={4}>NEXT</SectionLabel>
                      <button type="button" className={styles.workLine} onClick={() => setDetail(DETAIL_LIBRARY.flowerWindow)}>
                        <span className={styles.timeCell}>4:15</span>
                        <Mark>○</Mark>
                        <span className={styles.lineCopy}><strong>Review Friday florist volume before commitments harden</strong><small>Elm · owner decision if the threshold is crossed</small></span>
                      </button>
                      <button type="button" className={styles.workLine} onClick={() => setDetail(DETAIL_LIBRARY.familyDinner)}>
                        <span className={styles.timeCell}>6:30</span>
                        <Mark>■</Mark>
                        <span className={styles.lineCopy}><strong>Reserved private time</strong><small>Private reason protected · institutions receive availability only</small></span>
                      </button>
                      <button type="button" className={styles.workLine} onClick={() => setDetail(DETAIL_LIBRARY.cropRotation)}>
                        <span className={styles.timeCell}>8:00</span>
                        <Mark>○</Mark>
                        <span className={styles.lineCopy}><strong>Protect 45 minutes for Elm 2027 crop rotation</strong><small>H2 · quiet future work</small></span>
                      </button>
                      <button type="button" className={styles.workLine} onClick={() => setDetail(DETAIL_LIBRARY.relationship)}>
                        <span className={styles.timeCell}>later</span>
                        <Mark>○</Mark>
                        <span className={styles.lineCopy}><strong>Send the promised relationship follow-up</strong><small>People · promised by us</small></span>
                      </button>
                    </section>

                    {previewCaptures.length ? (
                      <section className={styles.listSection}>
                        <SectionLabel count={previewCaptures.length}>PREVIEW INBOX</SectionLabel>
                        {previewCaptures.map((item, index) => (
                          <div className={styles.previewCapture} key={`${item}:${index}`}>
                            <Mark>○</Mark>
                            <span>{item}</span>
                            <small>browser-only</small>
                          </div>
                        ))}
                      </section>
                    ) : null}

                    <section className={styles.listSection}>
                      <SectionLabel count={3}>WAITING / CONTAINED</SectionLabel>
                      <div className={styles.quietLine}>
                        <Mark>→</Mark>
                        <span><strong>Raised-bed repair</strong><small>Waiting on the person/tool dependency · not allowed to nag the day</small></span>
                      </div>
                      <div className={styles.quietLine}>
                        <Mark>→</Mark>
                        <span><strong>Ordinary delegated farm misses</strong><small>Remain in operations unless an escalation threshold is crossed</small></span>
                      </div>
                      <div className={styles.quietLine}>
                        <Mark>→</Mark>
                        <span><strong>Unfunded future ideas</strong><small>Remembered without pretending they are executable now</small></span>
                      </div>
                    </section>
                  </div>

                  <aside className={styles.todayAside}>
                    <section className={styles.asideSection}>
                      <SectionLabel>DAY SHAPE</SectionLabel>
                      <div className={styles.dayShape}>
                        <div><span>now</span><strong>Principal decision</strong></div>
                        <div><span>4:15</span><strong>Review window</strong></div>
                        <div data-private="true"><span>6:30</span><strong>Reserved</strong></div>
                        <div><span>8:00</span><strong>Protected future</strong></div>
                      </div>
                      <p>Day proves membership. Time placement is choreography, not source truth.</p>
                    </section>

                    <section className={styles.asideSection}>
                      <SectionLabel count={2}>NEEDS HANDLING</SectionLabel>
                      <button type="button" className={styles.alertLine} onClick={() => setDetail(DETAIL_LIBRARY.flowerWindow)}>
                        <Mark tone="warning">!</Mark>
                        <span><strong>Friday flower commitment window</strong><small>Potential capacity decision</small></span>
                      </button>
                      <button type="button" className={styles.alertLine} onClick={() => setDetail(DETAIL_LIBRARY.treasury)}>
                        <Mark tone="warning">$</Mark>
                        <span><strong>Capital decisions need a house position</strong><small>Coverage not yet connected in this preview</small></span>
                      </button>
                    </section>

                    <section className={styles.asideSection}>
                      <SectionLabel>QUIET FUTURE</SectionLabel>
                      <button type="button" className={styles.futureLine} onClick={() => setDetail(DETAIL_LIBRARY.cropRotation)}><span>H2</span><strong>Elm 2027 crop rotation</strong></button>
                      <button type="button" className={styles.futureLine} onClick={() => setDetail(DETAIL_LIBRARY.waitingRoom)}><span>H2</span><strong>Waiting Room landscape</strong></button>
                      <button type="button" className={styles.futureLine} onClick={() => setDetail(DETAIL_LIBRARY.farmThree)}><span>H3</span><strong>Farm 3 acquisition thesis</strong></button>
                    </section>

                    <section className={styles.asideSection}>
                      <SectionLabel>UNDER CONTROL</SectionLabel>
                      <div className={styles.healthLine}><strong>Household</strong><span>protected</span></div>
                      <div className={styles.healthLine}><strong>Feast Guild</strong><span>watching 1 window</span></div>
                      <div className={styles.healthLine}><strong>Elm operations</strong><span>contained</span></div>
                      <div className={styles.healthLine}><strong>Private goals</strong><span>remembered</span></div>
                    </section>
                  </aside>
                </div>
              </>
            ) : null}

            {view === "week" ? (
              <>
                <header className={styles.pageHeader}>
                  <div>
                    <span className={styles.eyebrow}>CAPACITY · PROTECTION · WINDOWS</span>
                    <h1>Week</h1>
                    <p>Protect the shape of the week before louder work consumes it.</p>
                  </div>
                  <div className={styles.pageHeaderMeta}><span>MODE</span><strong>Collaborative</strong></div>
                </header>

                <section className={styles.weekTable}>
                  <div className={styles.weekHead}><span>DAY</span><span>FIXED</span><span>PROTECTED</span><span>ATLAS READ</span></div>
                  {[
                    ["Mon", "2 fixed", "45 min future", "balanced"],
                    ["Tue", "1 fixed", "90 min strategy", "room"],
                    ["Wed", "3 fixed", "30 min household", "tight after 2"],
                    ["Thu", "2 fixed", "45 min writing", "watch delivery window"],
                    ["Fri", "1 fixed", "60 min portfolio", "flower decision may land"],
                    ["Sat", "family block", "open", "mostly protected"],
                    ["Sun", "meal + family", "weekly review", "quiet"],
                  ].map(([day, fixed, protected, read]) => (
                    <button type="button" className={styles.weekRow} key={day} onClick={() => previewAction(`Opened ${day} day plan`)}>
                      <strong>{day}</strong><span>{fixed}</span><span>{protected}</span><span>{read}</span>
                    </button>
                  ))}
                </section>

                <div className={styles.twoColumnSections}>
                  <section className={styles.ruleSection}>
                    <SectionLabel count={2}>AT RISK</SectionLabel>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.flowerWindow)}><Mark tone="warning">!</Mark><span><strong>Friday flower commitment window</strong><small>Decision only if operations cross tolerance</small></span></button>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.treasury)}><Mark tone="warning">$</Mark><span><strong>Capital allocation without complete source coverage</strong><small>Do not manufacture a financial answer</small></span></button>
                  </section>
                  <section className={styles.ruleSection}>
                    <SectionLabel count={3}>PROTECTED</SectionLabel>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.cropRotation)}><Mark>○</Mark><span><strong>Elm 2027 planning</strong><small>quiet future</small></span></button>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.waitingRoom)}><Mark>○</Mark><span><strong>Waiting Room design</strong><small>seasonal window</small></span></button>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.farmThree)}><Mark>○</Mark><span><strong>Farm 3 thesis</strong><small>H3 attention debt protection</small></span></button>
                  </section>
                </div>
              </>
            ) : null}

            {view === "life" ? (
              <>
                <header className={styles.pageHeader}>
                  <div>
                    <span className={styles.eyebrow}>THE WHOLE FIELD</span>
                    <h1>Your Atlas</h1>
                    <p>The person is the root. Companies, households, goals, and projects connect without becoming the container.</p>
                  </div>
                  <div className={styles.pageHeaderMeta}><span>PRIVACY</span><strong>Jurisdiction preserved</strong></div>
                </header>

                <section className={styles.domainTable}>
                  <div className={styles.domainHead}><span>DOMAIN</span><span>ATLAS IS HOLDING</span><span>STATE</span></div>
                  <Link className={styles.domainRow} href="/owner/life"><span><strong>Personal</strong><small>private goals · observations · future</small></span><span>5K goal, creative work, private commitments</span><b>live slice</b></Link>
                  <Link className={styles.domainRow} href="/owner/household"><span><strong>Household</strong><small>private home system</small></span><span>rhythms, meals, zones, family constraints</span><b>protected</b></Link>
                  <button type="button" className={styles.domainRow} onClick={() => setContext("Feast Guild")}><span><strong>Feast Guild</strong><small>owned institution</small></span><span>portfolio, capital, authority, outcomes</span><b>connected</b></button>
                  <button type="button" className={styles.domainRow} onClick={() => setContext("Elm")}><span><strong>Elm</strong><small>operating unit</small></span><span>operations feed evidence upward by exception</span><b>contained</b></button>
                  <button type="button" className={styles.domainRow} onClick={() => setContext("Write Now")}><span><strong>Write Now</strong><small>owned institution</small></span><span>protected creation and future value</span><b>quiet</b></button>
                  <button type="button" className={styles.domainRow} onClick={() => setDetail(DETAIL_LIBRARY.farmThree)}><span><strong>Farm 3</strong><small>strategic option</small></span><span>acquisition thesis before acquisition</span><b>H3</b></button>
                </section>

                <div className={styles.lifeFooterGrid}>
                  <section className={styles.ruleSection}>
                    <SectionLabel>WHAT ATLAS MAY SHARE</SectionLabel>
                    <p className={styles.prose}>Work results, custody, commitments, governed availability, and the institutional truth a connected seat is entitled to receive.</p>
                  </section>
                  <section className={styles.ruleSection}>
                    <SectionLabel>WHAT STAYS PRIVATE</SectionLabel>
                    <p className={styles.prose}>The private reason behind protected time, household detail, private goals, personal notes, and unrelated institutional truth.</p>
                  </section>
                </div>
              </>
            ) : null}

            {view === "people" ? (
              <>
                <header className={styles.pageHeader}>
                  <div>
                    <span className={styles.eyebrow}>RELATIONSHIPS OVER TIME</span>
                    <h1>People</h1>
                    <p>Remember promises and meaningful cadence without turning relationships into a sales score.</p>
                  </div>
                </header>

                <div className={styles.peopleColumns}>
                  <section className={styles.ruleSection}>
                    <SectionLabel count={2}>NEEDS A TOUCH</SectionLabel>
                    <button type="button" className={styles.personLine} onClick={() => setDetail(DETAIL_LIBRARY.relationship)}><Mark tone="strong">●</Mark><span><strong>Promised follow-up</strong><small>we said we would circle back this week</small></span></button>
                    <button type="button" className={styles.personLine} onClick={() => previewAction("Opened relationship history")}><Mark>○</Mark><span><strong>Quiet relationship</strong><small>cadence has gone long enough to deserve a human touch</small></span></button>
                  </section>
                  <section className={styles.ruleSection}>
                    <SectionLabel count={2}>WAITING ON THEM</SectionLabel>
                    <div className={styles.personLine}><Mark>→</Mark><span><strong>Pricing answer</strong><small>last touch Tuesday · no action from you yet</small></span></div>
                    <div className={styles.personLine}><Mark>→</Mark><span><strong>Availability confirmation</strong><small>Atlas remembers the promise without nagging</small></span></div>
                  </section>
                  <section className={styles.ruleSection}>
                    <SectionLabel count={1}>PROMISED BY US</SectionLabel>
                    <button type="button" className={styles.personLine} onClick={() => setDetail(DETAIL_LIBRARY.relationship)}><Mark tone="warning">!</Mark><span><strong>Send the promised update</strong><small>window closes tomorrow</small></span></button>
                  </section>
                </div>
              </>
            ) : null}

            {view === "work" ? (
              <>
                <header className={styles.pageHeader}>
                  <div>
                    <span className={styles.eyebrow}>SEATS · RESPONSIBILITY · OUTCOMES</span>
                    <h1>Work</h1>
                    <p>Institutions connect responsibility into your Atlas. They do not take over your Atlas.</p>
                  </div>
                  <div className={styles.pageHeaderMeta}><span>RULE</span><strong>Accountability, not surveillance</strong></div>
                </header>

                <section className={styles.seatTable}>
                  <div className={styles.seatHead}><span>INSTITUTION / SEAT</span><span>RESPONSIBILITY</span><span>STATE</span><span>NEEDS YOU</span></div>
                  <button type="button" className={styles.seatRow} onClick={() => setContext("Feast Guild")}><span><strong>Feast Guild</strong><small>Principal</small></span><span>capital · portfolio · outcomes</span><b>on track</b><em>1 decision</em></button>
                  <button type="button" className={styles.seatRow} onClick={() => setContext("Elm")}><span><strong>Elm</strong><small>Operating unit</small></span><span>production · harvest · fulfillment evidence</span><b>contained</b><em>1 window</em></button>
                  <button type="button" className={styles.seatRow} onClick={() => setContext("Write Now")}><span><strong>Write Now</strong><small>Principal + execution</small></span><span>protected creation · future value</span><b>quiet</b><em>0</em></button>
                  <button type="button" className={styles.seatRow} onClick={() => setContext("Optical Lift")}><span><strong>Optical Lift</strong><small>Owned institution</small></span><span>client / project responsibility</span><b>stable</b><em>0</em></button>
                </section>

                <div className={styles.twoColumnSections}>
                  <section className={styles.ruleSection}>
                    <SectionLabel>ORGANIZATIONAL TRUTH</SectionLabel>
                    <p className={styles.prose}>Every responsibility should preserve the obligation, responsible person, required-by truth, definition of done, accountable owner, and current outcome state.</p>
                  </section>
                  <section className={styles.ruleSection}>
                    <SectionLabel>PERSONAL ATTENTION</SectionLabel>
                    <p className={styles.prose}>Atlas may compress what you look at right now. It may not erase the responsibilities, outcomes, or evidence that remain true underneath.</p>
                  </section>
                </div>
              </>
            ) : null}

            {view === "money" ? (
              <>
                <header className={styles.pageHeader}>
                  <div>
                    <span className={styles.eyebrow}>HOUSE POSITION</span>
                    <h1>Money</h1>
                    <p>A Principal view of resources, commitments, trajectory, and capital — with source coverage visible.</p>
                  </div>
                  <div className={styles.pageHeaderMeta}><span>DATA</span><strong>Preview structure · no live values</strong></div>
                </header>

                <section className={styles.moneyStrip}>
                  <div><span>LIQUID</span><strong>—</strong><small>source not connected here</small></div>
                  <div><span>COMMITTED OUTFLOWS</span><strong>—</strong><small>30 days</small></div>
                  <div><span>EXPECTED INFLOWS</span><strong>—</strong><small>30 days</small></div>
                  <div><span>CAPITAL REQUESTS</span><strong>2</strong><small>fixture decisions</small></div>
                </section>

                <section className={styles.moneySource}>
                  <div><span>AS OF</span><strong>Not connected in this mockup</strong></div>
                  <div><span>COVERAGE</span><strong>No financial accounts queried</strong></div>
                  <div><span>FRESHNESS</span><strong>Unknown — Atlas must not call this live</strong></div>
                  <div><span>ENTITIES</span><strong>Would list included people / companies / accounts</strong></div>
                </section>

                <div className={styles.twoColumnSections}>
                  <section className={styles.ruleSection}>
                    <SectionLabel count={2}>CAPITAL DECISIONS</SectionLabel>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.treasury)}><Mark tone="warning">$</Mark><span><strong>Decision waiting on complete house position</strong><small>cash is one capital class, not the only one</small></span></button>
                    <button type="button" className={styles.ruleRow} onClick={() => setDetail(DETAIL_LIBRARY.farmThree)}><Mark>○</Mark><span><strong>Farm 3 remains an option, not a commitment</strong><small>no false funding assumption</small></span></button>
                  </section>
                  <section className={styles.ruleSection}>
                    <SectionLabel>30 / 60 / 90</SectionLabel>
                    <div className={styles.trajectory}><span>30</span><i /><strong>coverage required</strong></div>
                    <div className={styles.trajectory}><span>60</span><i /><strong>coverage required</strong></div>
                    <div className={styles.trajectory}><span>90</span><i /><strong>coverage required</strong></div>
                  </section>
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>

      {detail ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setDetail(null)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={detail.title} onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.drawerHeader}>
              <div><span>{detail.eyebrow}</span><h2>{detail.title}</h2></div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close detail">×</button>
            </header>
            {detail.summary ? <p className={styles.drawerSummary}>{detail.summary}</p> : null}
            <dl className={styles.factList}>
              {detail.facts.map((fact) => (
                <div key={`${fact.label}:${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
              ))}
            </dl>
            <div className={styles.drawerActions}>
              <button type="button" onClick={() => previewAction("Accepted Atlas’s placement")}>Keep here</button>
              <button type="button" onClick={() => previewAction("Opened move controls")}>Move</button>
              <button type="button" onClick={() => previewAction("Recorded a blocker")}>Blocked</button>
            </div>
            <p className={styles.fixtureWarning}>Design fixture only. These controls demonstrate the future interaction grammar and do not mutate Atlas production truth.</p>
          </aside>
        </div>
      ) : null}

      {askOpen ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setAskOpen(false)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Ask Atlas preview" onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.drawerHeader}>
              <div><span>ASK ATLAS</span><h2>One intelligence, scoped by context.</h2></div>
              <button type="button" onClick={() => setAskOpen(false)} aria-label="Close Ask Atlas preview">×</button>
            </header>
            <p className={styles.drawerSummary}>The same Ask Atlas should be able to reason across your Atlas while respecting the jurisdiction and disclosure rules of the context you are in.</p>
            <div className={styles.promptList}>
              <button type="button" onClick={() => previewAction("Asked: What do I need to do next?")}>What do I need to do next?</button>
              <button type="button" onClick={() => previewAction("Asked: Is anything at risk this week?")}>Is anything at risk this week?</button>
              <button type="button" onClick={() => previewAction("Asked: What am I forgetting about the future?")}>What am I forgetting about the future?</button>
              <button type="button" onClick={() => previewAction("Asked: Is Feast Guild under control?")}>Is Feast Guild under control?</button>
            </div>
            <Link className={styles.liveLink} href="/owner/ask-atlas">Open the live read-only Ask Atlas →</Link>
          </aside>
        </div>
      ) : null}

      {captureOpen ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setCaptureOpen(false)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Capture preview" onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.drawerHeader}>
              <div><span>CAPTURE</span><h2>Get it out of your head.</h2></div>
              <button type="button" onClick={() => setCaptureOpen(false)} aria-label="Close capture preview">×</button>
            </header>
            <p className={styles.drawerSummary}>Eventually Atlas should classify the thought after capture rather than forcing you to choose a database before you can remember something.</p>
            <textarea className={styles.captureInput} value={captureText} onChange={(event) => setCaptureText(event.target.value)} placeholder="Type the thought, promise, need, question, or observation…" autoFocus />
            <div className={styles.captureKinds}><span>note</span><span>need</span><span>promise</span><span>question</span><span>observation</span></div>
            <button type="button" className={styles.primaryDrawerAction} onClick={keepCapture} disabled={!captureText.trim()}>Keep in this preview</button>
            <p className={styles.fixtureWarning}>Browser-only mock behavior. Nothing is saved to production.</p>
          </aside>
        </div>
      ) : null}

      {exceptionsOpen ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setExceptionsOpen(false)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Exceptions" onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.drawerHeader}>
              <div><span>BELL · EXCEPTIONS</span><h2>Only what has earned the interruption.</h2></div>
              <button type="button" onClick={() => setExceptionsOpen(false)} aria-label="Close exceptions">×</button>
            </header>
            <div className={styles.exceptionList}>
              <button type="button" onClick={() => { setExceptionsOpen(false); setDetail(DETAIL_LIBRARY.flowerWindow); }}><Mark tone="warning">!</Mark><span><strong>Window at risk</strong><small>Friday florist commitment may require a capacity decision.</small></span></button>
              <button type="button" onClick={() => { setExceptionsOpen(false); setDetail(DETAIL_LIBRARY.treasury); }}><Mark tone="warning">$</Mark><span><strong>Capital decision</strong><small>Do not decide from an incomplete house position.</small></span></button>
            </div>
            <p className={styles.fixtureWarning}>Bell is modeled as an exception system, not an overdue-task feed.</p>
          </aside>
        </div>
      ) : null}

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    </main>
  );
}
