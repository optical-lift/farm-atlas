"use client";

import Link from "next/link";

import styles from "./household-collection.module.css";

type HouseholdCollectionFixtureProps = {
  personName: string;
};

const SOURCE_SECTIONS = [
  {
    label: "current state",
    rows: [
      { mark: "5", title: "Living room", detail: "current FlyLady zone · closing days of the month", tone: "active" as const },
      { mark: "S", title: "Sunday · renew", detail: "current weekly rhythm" },
      { mark: "☀", title: "Morning routine", detail: "armed daily" },
      { mark: "☾", title: "Before-bed routine", detail: "armed daily" },
    ],
  },
  {
    label: "rules that can emit work",
    rows: [
      { mark: "15", title: "Zone work", detail: "one timer-bound pass in the current zone; declutter before detail cleaning" },
      { mark: "7", title: "Weekly home blessing", detail: "separate whole-house maintenance rhythm; not zone cleaning" },
      { mark: "↻", title: "Zone rotation", detail: "entrance / porch / dining → kitchen → bath + one room → primary bedroom → living room" },
    ],
  },
  {
    label: "recent evidence",
    rows: [
      { mark: "×", title: "Before-bed routine", detail: "Saturday · logged complete", tone: "done" as const },
      { mark: "×", title: "Weekly home blessing", detail: "Monday · logged complete", tone: "done" as const },
      { mark: "–", title: "Living room zone", detail: "no zone pass logged yet in this closing-week window" },
    ],
  },
];

export default function HouseholdCollectionFixture({ personName }: HouseholdCollectionFixtureProps) {
  return (
    <main className={styles.root} data-atlas-household-collection="true">
      <section className={styles.page}>
        <header className={styles.topChrome}>
          <Link href="/owner" className={styles.back} aria-label="Return to Today">←</Link>
          <div>
            <span>source</span>
            <strong>{personName}</strong>
          </div>
          <Link href="/owner" className={styles.indexLink}>today</Link>
        </header>

        <article className={styles.collectionPage}>
          <header className={styles.collectionHeader}>
            <div>
              <span>household source</span>
              <h1>Household</h1>
            </div>
            <small>private system</small>
          </header>

          <div className={styles.sections}>
            {SOURCE_SECTIONS.map((section) => (
              <section className={styles.section} key={section.label}>
                <h2>{section.label}</h2>
                <div className={styles.rows}>
                  {section.rows.map((row) => (
                    <div className={styles.row} data-tone={row.tone ?? "quiet"} key={`${section.label}:${row.title}`}>
                      <b aria-hidden="true">{row.mark}</b>
                      <div>
                        <strong>{row.title}</strong>
                        <span>{row.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>

        <nav className={styles.pageNav} aria-label="Household source navigation">
          <button type="button" disabled aria-hidden="true">‹</button>
          <span className={styles.thread}>source · feeds Today</span>
          <strong>08</strong>
          <button type="button" disabled aria-hidden="true">›</button>
        </nav>
      </section>
    </main>
  );
}
