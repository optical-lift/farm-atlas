"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import styles from "./household-collection.module.css";

type HouseholdCollectionFixtureProps = {
  personName: string;
};

type HouseholdPage = {
  number: string;
  label: string;
  title: string;
  subtitle?: string;
  sections: Array<{
    label: string;
    rows: Array<{
      mark?: string;
      title: string;
      detail?: string;
      tone?: "quiet" | "active" | "done";
    }>;
  }>;
};

const PAGES: HouseholdPage[] = [
  {
    number: "08",
    label: "collection",
    title: "Household",
    subtitle: "Sunday · home rhythm",
    sections: [
      {
        label: "right now",
        rows: [
          { mark: "*", title: "Reset the kitchen and shine the sink", detail: "evening routine", tone: "active" },
          { mark: "•", title: "Clear one hot spot", detail: "2 minutes" },
          { mark: "•", title: "Check tomorrow before bed", detail: "calendar + carryover" },
        ],
      },
      {
        label: "this week",
        rows: [
          { mark: "5", title: "Living room", detail: "current zone · 15 minutes at a time", tone: "active" },
          { mark: ">", title: "Entrance · porch · dining room", detail: "next zone" },
          { mark: "•", title: "Weekly home blessing", detail: "quick whole-house reset, not detail cleaning" },
        ],
      },
      {
        label: "steady things",
        rows: [
          { mark: "☀", title: "Morning routine", detail: "start the house before adding extra work" },
          { mark: "☾", title: "Before-bed routine", detail: "close today so tomorrow starts lighter" },
          { mark: "15", title: "Declutter before detail-cleaning", detail: "timer-bound; stop when time is up" },
        ],
      },
    ],
  },
  {
    number: "09",
    label: "household map",
    title: "Zones",
    subtitle: "monthly rotation",
    sections: [
      {
        label: "1 · opening week",
        rows: [
          { mark: "1", title: "Entrance · front porch · dining room", detail: "short week when the month begins midweek" },
        ],
      },
      {
        label: "2 · first full week",
        rows: [
          { mark: "2", title: "Kitchen", detail: "declutter first; detailed work only when clear" },
        ],
      },
      {
        label: "3 · second full week",
        rows: [
          { mark: "3", title: "Main bathroom + one other room", detail: "choose only one additional room" },
        ],
      },
      {
        label: "4 · third full week",
        rows: [
          { mark: "4", title: "Primary bedroom · closet · bath", detail: "protect the room used for rest" },
        ],
      },
      {
        label: "5 · closing week",
        rows: [
          { mark: "5", title: "Living room", detail: "often a partial week; can share a calendar week with Zone 1", tone: "active" },
        ],
      },
    ],
  },
  {
    number: "10",
    label: "control journal",
    title: "Rhythms",
    subtitle: "daily · weekly · monthly",
    sections: [
      {
        label: "daily anchors",
        rows: [
          { mark: "☀", title: "Morning", detail: "dress · bathroom reset · dishwasher · breakfast" },
          { mark: "☾", title: "Before bed", detail: "sink · hot spots · calendar · sleep" },
          { mark: "15", title: "Zone / declutter", detail: "one short timer-bound pass" },
        ],
      },
      {
        label: "basic weekly plan",
        rows: [
          { mark: "S", title: "Sunday · renew", detail: "prepare for the week" },
          { mark: "M", title: "Monday · home blessing", detail: "whole-house maintenance pass" },
          { mark: "T", title: "Tuesday · free / plan", detail: "keep margin in the week" },
          { mark: "W", title: "Wednesday · anti-procrastination", detail: "move one avoided thing" },
          { mark: "T", title: "Thursday · errands", detail: "groceries · appointments · outside-the-house work" },
          { mark: "F", title: "Friday · car + books", detail: "reset loose ends before the weekend" },
          { mark: "S", title: "Saturday · family fun", detail: "do not let cleaning consume the day" },
        ],
      },
      {
        label: "home blessing",
        rows: [
          { mark: "7", title: "Seven quick whole-house passes", detail: "timer-led; stop and move on instead of perfecting" },
          { mark: "≠", title: "Not zone cleaning", detail: "the blessing maintains; the zone goes deeper" },
        ],
      },
    ],
  },
];

export default function HouseholdCollectionFixture({ personName }: HouseholdCollectionFixtureProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = PAGES[pageIndex] ?? PAGES[0];
  const rangeLabel = useMemo(() => `${PAGES[0].number}–${PAGES[PAGES.length - 1].number}`, []);

  return (
    <main className={styles.root} data-atlas-household-collection="true">
      <section className={styles.page}>
        <header className={styles.topChrome}>
          <Link href="/owner" className={styles.back} aria-label="Return to Today">←</Link>
          <div>
            <span>household</span>
            <strong>{personName}</strong>
          </div>
          <Link href="/owner" className={styles.indexLink}>index</Link>
        </header>

        <article className={styles.collectionPage}>
          <header className={styles.collectionHeader}>
            <div>
              <span>{page.label}</span>
              <h1>{page.title}</h1>
            </div>
            <small>{page.subtitle}</small>
          </header>

          <div className={styles.sections}>
            {page.sections.map((section) => (
              <section className={styles.section} key={`${page.number}:${section.label}`}>
                <h2>{section.label}</h2>
                <div className={styles.rows}>
                  {section.rows.map((row) => (
                    <div className={styles.row} data-tone={row.tone ?? "quiet"} key={`${section.label}:${row.title}`}>
                      <b aria-hidden="true">{row.mark ?? "•"}</b>
                      <div>
                        <strong>{row.title}</strong>
                        {row.detail ? <span>{row.detail}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>

        <nav className={styles.pageNav} aria-label="Household collection pages">
          <button type="button" onClick={() => setPageIndex((value) => Math.max(0, value - 1))} disabled={pageIndex === 0}>‹</button>
          <span className={styles.thread}>household · {rangeLabel}</span>
          <strong>{page.number}</strong>
          <button type="button" onClick={() => setPageIndex((value) => Math.min(PAGES.length - 1, value + 1))} disabled={pageIndex === PAGES.length - 1}>›</button>
        </nav>
      </section>
    </main>
  );
}
