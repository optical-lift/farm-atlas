"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import OwnerPersonAtlasFixture from "./OwnerPersonAtlasFixture";
import styles from "./owner-notebook-spread.module.css";

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
  { key: "people", label: "People", title: "People Nearby" },
  { key: "clock", label: "Clock", title: "Day Shape" },
  { key: "memory", label: "Memory", title: "Atlas Memory" },
  { key: "waiting", label: "Waiting", title: "Waiting / Delegated" },
  { key: "commands", label: "Commands", title: "Command Strip" },
];

const CONTEXTS = ["All", "Personal", "Household", "Feast Guild", "Elm", "Write Now"];

export default function OwnerNotebookSpread({ personName }: OwnerNotebookSpreadProps) {
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [captureDraft, setCaptureDraft] = useState("");
  const [capturedItems, setCapturedItems] = useState<string[]>([]);
  const [finderQuery, setFinderQuery] = useState("");
  const [context, setContext] = useState("All");

  const activeDefinition = TOOL_TABS.find((tool) => tool.key === activeTool) ?? null;
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
          <p className={styles.toolEyebrow}>GET IT OUT OF YOUR HEAD</p>
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
          <p className={styles.toolNote}>This prototype keeps captures in this browser session only.</p>
        </>
      );
    }

    if (activeTool === "ask") {
      return (
        <>
          <p className={styles.toolEyebrow}>READ ACROSS THE NOTEBOOK</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.promptList}>
            <span>What needs my attention next?</span>
            <span>What am I waiting on?</span>
            <span>What can move without breaking anything?</span>
          </div>
          <Link className={styles.primaryToolLink} href="/owner/ask-atlas">Open Ask Atlas</Link>
        </>
      );
    }

    if (activeTool === "find") {
      return (
        <>
          <p className={styles.toolEyebrow}>THUMB INDEX</p>
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
          <p className={styles.toolEyebrow}>WHAT ATLAS IS LOOKING THROUGH</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.contextList}>
            {CONTEXTS.map((item) => (
              <button
                type="button"
                data-selected={context === item}
                onClick={() => setContext(item)}
                key={item}
              >
                <span>{item}</span><i aria-hidden="true">{context === item ? "•" : ""}</i>
              </button>
            ))}
          </div>
          <p className={styles.toolNote}>The notebook stays the same object; this changes the lens used to read it.</p>
        </>
      );
    }

    if (activeTool === "inbox") {
      return (
        <>
          <p className={styles.toolEyebrow}>NOT YET PLACED</p>
          <h2>{activeDefinition.title}</h2>
          {capturedItems.length ? (
            <div className={styles.inboxList}>
              {capturedItems.map((item, index) => <p key={`${item}:${index}`}>• {item}</p>)}
            </div>
          ) : (
            <p className={styles.emptyPanel}>Nothing is waiting to be processed in this prototype.</p>
          )}
        </>
      );
    }

    if (activeTool === "people") {
      return (
        <>
          <p className={styles.toolEyebrow}>RELATIONSHIPS OVER TIME</p>
          <h2>{activeDefinition.title}</h2>
          <dl className={styles.statList}>
            <div><dt>Replies waiting</dt><dd>0</dd></div>
            <div><dt>Promised follow-ups</dt><dd>0</dd></div>
            <div><dt>Upcoming dates</dt><dd>0</dd></div>
          </dl>
          <p className={styles.toolNote}>People stay quiet here until Atlas has an actual relationship obligation to surface.</p>
        </>
      );
    }

    if (activeTool === "clock") {
      return (
        <>
          <p className={styles.toolEyebrow}>TODAY’S HARD EDGES</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.clockList}>
            <div><time>5:15</time><span>Groceries</span></div>
            <div><time>6:30</time><span>Family · fixed</span></div>
            <div><time>8:00</time><span>Write Now · protected</span></div>
          </div>
          <p className={styles.toolNote}>The full chronology can stay here while Today shows only what changes your next move.</p>
        </>
      );
    }

    if (activeTool === "memory") {
      return (
        <>
          <p className={styles.toolEyebrow}>WHAT ATLAS KNOWS ABOUT THIS PAGE</p>
          <h2>{activeDefinition.title}</h2>
          <dl className={styles.memoryList}>
            <div><dt>Page</dt><dd>Today · 01</dd></div>
            <div><dt>Open lines</dt><dd>5</dd></div>
            <div><dt>Connected worlds</dt><dd>Personal · Household · Feast Guild · Elm · Write Now</dd></div>
            <div><dt>Next hard edge</dt><dd>Family · 6:30 PM</dd></div>
          </dl>
        </>
      );
    }

    if (activeTool === "waiting") {
      return (
        <>
          <p className={styles.toolEyebrow}>REMEMBERED, NOT IN YOUR HAND</p>
          <h2>{activeDefinition.title}</h2>
          <div className={styles.waitingCard}>
            <span>HELD</span>
            <p>Keep person-owned state off the Clock until placement authority is proven.</p>
          </div>
          <p className={styles.toolNote}>Waiting work can leave the active page without disappearing from Atlas.</p>
        </>
      );
    }

    return (
      <>
        <p className={styles.toolEyebrow}>NOTEBOOK CONTROLS</p>
        <h2>{activeDefinition.title}</h2>
        <div className={styles.commandList}>
          <button type="button" onClick={() => setActiveTool("capture")}>Capture</button>
          <button type="button" onClick={() => setActiveTool("find")}>Find a page</button>
          <Link href="/owner/ask-atlas">Ask Atlas</Link>
          <Link href="/owner/life">Open Life</Link>
          <Link href="/owner/household">Open Household</Link>
          <Link href="/owner/design-atlas">Design Atlas</Link>
        </div>
      </>
    );
  }

  return (
    <div className={styles.workspace} data-atlas-owner-tool-tabs="true">
      <div className={styles.spread} data-atlas-open-notebook="true">
        <div className={styles.leftPage}>
          <OwnerPersonAtlasFixture personName={personName} />
          <footer className={styles.leftFolio} aria-label="Today page 01, active">
            <span>01</span>
            <i aria-hidden="true">•</i>
          </footer>
        </div>

        <aside className={`${styles.facingPage} ${styles.dotPage}`} aria-label="Atlas index facing page">
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

      <div className={styles.toolDock} data-open={Boolean(activeTool)}>
        <aside className={styles.toolPanel} aria-label={activeDefinition?.title ?? "Atlas tools"}>
          <div className={styles.toolPanelInner}>{renderToolPanel()}</div>
        </aside>

        <nav className={styles.toolTabs} aria-label="Atlas notebook tools">
          {TOOL_TABS.map((tool) => (
            <button
              type="button"
              className={styles.toolTab}
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
    </div>
  );
}
