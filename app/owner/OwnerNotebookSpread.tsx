"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import OwnerPersonAtlasFixture from "./OwnerPersonAtlasFixture";
import styles from "./owner-notebook-spread.module.css";
import officeStyles from "./owner-office-shell.module.css";

type OwnerNotebookSpreadProps = {
  personName: string;
};

type ToolKey =
  | "capture"
  | "ask"
  | "find"
  | "context"
  | "inbox"
  | "people"
  | "clock"
  | "memory"
  | "waiting"
  | "commands";

const INDEX_GROUPS = [
  {
    label: "PERSONAL",
    items: [
      { label: "Life", href: "/owner/life", page: "02" },
      { label: "Household", href: "/owner/household", page: "03" },
      { label: "People", page: "04" },
      { label: "Money", page: "05" },
    ],
  },
  {
    label: "WORK",
    items: [
      { label: "Feast Guild", page: "06" },
      { label: "Elm", page: "07" },
      { label: "Write Now", page: "08" },
      { label: "Optical Lift", page: "09" },
    ],
  },
  {
    label: "REFERENCE",
    items: [
      { label: "Ask Atlas", href: "/owner/ask-atlas", page: "10" },
      { label: "Continuity", href: "/owner/continuity", page: "11" },
    ],
  },
];

const TOOL_TABS: Array<{ key: ToolKey; label: string; title: string }> = [
  { key: "capture", label: "Capture", title: "Quick Capture" },
  { key: "ask", label: "Ask", title: "Ask Atlas" },
  { key: "find", label: "Find", title: "Page Finder" },
  { key: "context", label: "Context", title: "Context Lens" },
  { key: "inbox", label: "Inbox", title: "Unprocessed" },
  { key: "people", label: "People", title: "People" },
  { key: "clock", label: "Clock", title: "Day Shape" },
  { key: "memory", label: "Memory", title: "Atlas Memory" },
  { key: "waiting", label: "Waiting", title: "Waiting / Delegated" },
  { key: "commands", label: "Commands", title: "Commands" },
];

const CONTEXTS = [
  { label: "All", code: "ALL" },
  { label: "Personal", code: "P" },
  { label: "Household", code: "H" },
  { label: "Feast Guild", code: "FG" },
  { label: "Elm", code: "E" },
  { label: "Write Now", code: "WN" },
];

export default function OwnerNotebookSpread({ personName }: OwnerNotebookSpreadProps) {
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [captureDraft, setCaptureDraft] = useState("");
  const [capturedItems, setCapturedItems] = useState<string[]>([]);
  const [finderQuery, setFinderQuery] = useState("");
  const [context, setContext] = useState("All");

  const activeDefinition = TOOL_TABS.find((tool) => tool.key === activeTool) ?? null;
  const activeContext = CONTEXTS.find((item) => item.label === context) ?? CONTEXTS[0];
  const allIndexItems = useMemo(() => INDEX_GROUPS.flatMap((group) => group.items), []);
  const finderResults = useMemo(() => {
    const query = finderQuery.trim().toLowerCase();
    if (!query) return allIndexItems;
    return allIndexItems.filter((item) => item.label.toLowerCase().includes(query));
  }, [allIndexItems, finderQuery]);

  function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = captureDraft.trim();
    if (!value) return;
    setCapturedItems((items) => [value, ...items]);
    setCaptureDraft("");
  }

  function renderToolPanel() {
    if (!activeTool || !activeDefinition) return null;

    if (activeTool === "capture") {
      return (
        <>
          <p className={styles.toolEyebrow}>CAPTURE</p>
          <h2>{activeDefinition.title}</h2>
          <form className={styles.captureForm} onSubmit={submitCapture}>
            <textarea
              value={captureDraft}
              onChange={(event) => setCaptureDraft(event.target.value)}
              placeholder="Write anything…"
              aria-label="Quick capture"
            />
            <button type="submit" disabled={!captureDraft.trim()}>Add to inbox</button>
          </form>
          <p className={styles.toolNote}>Session-only in this design prototype.</p>
        </>
      );
    }

    if (activeTool === "ask") {
      return (
        <>
          <p className={styles.toolEyebrow}>ASK</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.promptList}>
            <span>What needs my attention next?</span>
            <span>What am I waiting on?</span>
            <span>What can move?</span>
          </div>
          <Link className={styles.primaryToolLink} href="/owner/ask-atlas">Open Ask Atlas</Link>
        </>
      );
    }

    if (activeTool === "find") {
      return (
        <>
          <p className={styles.toolEyebrow}>INDEX</p>
          <h2>{activeDefinition.title}</h2>
          <input
            className={styles.finderInput}
            value={finderQuery}
            onChange={(event) => setFinderQuery(event.target.value)}
            placeholder="Find a spread"
            aria-label="Find a notebook spread"
          />
          <div className={styles.finderResults}>
            {finderResults.map((item) => item.href ? (
              <Link href={item.href} key={item.label}>
                <strong>{item.label}</strong><span>{item.page}</span>
              </Link>
            ) : (
              <div key={item.label}>
                <strong>{item.label}</strong><span>{item.page}</span>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (activeTool === "context") {
      return (
        <>
          <p className={styles.toolEyebrow}>CONTEXT</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.contextList}>
            {CONTEXTS.map((item) => (
              <button
                type="button"
                data-selected={context === item.label}
                onClick={() => setContext(item.label)}
                key={item.label}
              >
                <span>{item.label}</span><i aria-hidden="true">{context === item.label ? "•" : ""}</i>
              </button>
            ))}
          </div>
        </>
      );
    }

    if (activeTool === "inbox") {
      return (
        <>
          <p className={styles.toolEyebrow}>UNPLACED</p>
          <h2>{activeDefinition.title}</h2>
          {capturedItems.length ? (
            <div className={styles.inboxList}>
              {capturedItems.map((item, index) => <p key={`${item}:${index}`}>• {item}</p>)}
            </div>
          ) : (
            <p className={styles.emptyPanel}>Nothing waiting.</p>
          )}
        </>
      );
    }

    if (activeTool === "people") {
      return (
        <>
          <p className={styles.toolEyebrow}>PEOPLE</p>
          <h2>{activeDefinition.title}</h2>
          <dl className={styles.statList}>
            <div><dt>Replies</dt><dd>0</dd></div>
            <div><dt>Follow-ups</dt><dd>0</dd></div>
            <div><dt>Dates</dt><dd>0</dd></div>
          </dl>
        </>
      );
    }

    if (activeTool === "clock") {
      return (
        <>
          <p className={styles.toolEyebrow}>TODAY</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.clockList}>
            <div><time>5:15</time><span>Groceries</span></div>
            <div><time>6:30</time><span>Family · fixed</span></div>
            <div><time>8:00</time><span>Write Now · protected</span></div>
          </div>
        </>
      );
    }

    if (activeTool === "memory") {
      return (
        <>
          <p className={styles.toolEyebrow}>MEMORY</p>
          <h2>{activeDefinition.title}</h2>
          <dl className={styles.memoryList}>
            <div><dt>Page</dt><dd>Today · 01</dd></div>
            <div><dt>Open lines</dt><dd>5</dd></div>
            <div><dt>Worlds</dt><dd>5 connected</dd></div>
            <div><dt>Next fixed</dt><dd>6:30 PM</dd></div>
          </dl>
        </>
      );
    }

    if (activeTool === "waiting") {
      return (
        <>
          <p className={styles.toolEyebrow}>WAITING</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.waitingCard}>
            <span>HELD</span>
            <p>Keep person-owned state off the Clock until placement authority is proven.</p>
          </div>
        </>
      );
    }

    return (
      <>
        <p className={styles.toolEyebrow}>TOOLS</p>
        <h2>{activeDefinition.title}</h2>
        <div className={styles.commandList}>
          <button type="button" onClick={() => setActiveTool("capture")}>Capture</button>
          <button type="button" onClick={() => setActiveTool("find")}>Find a page</button>
          <Link href="/owner/ask-atlas">Ask Atlas</Link>
          <Link href="/owner/life">Life</Link>
          <Link href="/owner/household">Household</Link>
          <Link href="/owner/design-atlas">Design Atlas</Link>
        </div>
      </>
    );
  }

  return (
    <div
      className={`${styles.workspace} ${officeStyles.workspace}`}
      data-atlas-owner-tool-tabs="true"
      data-atlas-context-rail="true"
      data-context={context}
    >
      <div className={`${styles.spread} ${officeStyles.spread}`} data-atlas-open-notebook="true">
        <div className={`${styles.leftPage} ${officeStyles.leftPage}`}>
          <OwnerPersonAtlasFixture personName={personName} />
          <footer className={styles.leftFolio} aria-label="Today page 01, active">
            <span>01</span>
            <i aria-hidden="true">•</i>
          </footer>
        </div>

        <aside className={`${styles.facingPage} ${styles.dotPage} ${officeStyles.facingPage}`} aria-label="Atlas index facing page">
          <div className={styles.indexBody}>
            <header className={styles.indexHeader}>
              <h1>Index</h1>
            </header>

            {INDEX_GROUPS.map((group) => (
              <section className={styles.indexGroup} key={group.label}>
                <h2>{group.label}</h2>
                <div>
                  {group.items.map((item) => {
                    const row = (
                      <>
                        <strong>{item.label}</strong>
                        <i aria-hidden="true" />
                        <span>{item.page}</span>
                      </>
                    );

                    if (item.href) {
                      return (
                        <Link className={styles.indexRow} href={item.href} key={`${group.label}:${item.label}`}>
                          {row}
                        </Link>
                      );
                    }

                    return (
                      <div className={styles.indexRow} data-muted="true" key={`${group.label}:${item.label}`}>
                        {row}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <footer className={styles.facingFolio} aria-label="Index page 00">
            <span>00</span>
          </footer>
        </aside>
      </div>

      <div className={`${styles.toolDock} ${officeStyles.toolDock}`} data-open={Boolean(activeTool)}>
        <aside className={`${styles.toolPanel} ${officeStyles.toolPanel}`} aria-label={activeDefinition?.title ?? "Atlas tools"}>
          <div className={`${styles.toolPanelInner} ${officeStyles.toolPanelInner}`}>{renderToolPanel()}</div>
        </aside>

        <nav className={`${styles.toolTabs} ${officeStyles.toolTabs}`} aria-label="Atlas notebook tools">
          {TOOL_TABS.map((tool) => (
            <button
              type="button"
              className={`${styles.toolTab} ${officeStyles.toolTab}`}
              data-active={activeTool === tool.key}
              aria-expanded={activeTool === tool.key}
              onClick={() => setActiveTool((current) => current === tool.key ? null : tool.key)}
              key={tool.key}
            >
              {tool.label}
            </button>
          ))}
        </nav>
      </div>

      <aside className={officeStyles.contextRail} aria-label="Atlas context rail">
        <Link className={officeStyles.atlasMark} href="/owner" aria-label="Atlas notebook">A</Link>
        <nav className={officeStyles.contextMarks} aria-label="Atlas contexts">
          {CONTEXTS.map((item) => (
            <button
              type="button"
              className={officeStyles.contextMark}
              data-active={context === item.label}
              aria-label={item.label}
              title={item.label}
              onClick={() => setContext(item.label)}
              key={item.label}
            />
          ))}
        </nav>
        <div className={officeStyles.contextCode} aria-live="polite">{activeContext.code}</div>
        <button className={officeStyles.accountMark} type="button" aria-label={`${personName} account`}>L</button>
      </aside>
    </div>
  );
}
