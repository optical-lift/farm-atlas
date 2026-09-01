import Link from "next/link";

import styles from "./atlas-overview.module.css";

type Fact = { label: string; value: string };
type Line = {
  id: string;
  sentence: string;
  state: "done" | "now" | "open" | "waiting";
  worksheet?: {
    kicker?: string;
    facts?: Fact[];
    note?: string;
  };
};
type Section = { label: string; lines: Line[] };
type Counts = { company: number; personal: number; rhythms: number; waitingCompany: number };

function fact(line: Line, label: string) {
  return line.worksheet?.facts?.find((candidate) => candidate.label === label)?.value ?? null;
}

function stateLabel(line: Line, sectionLabel: string) {
  if (line.state === "now") return "In hand";
  if (line.state === "waiting") return "Waiting";
  if (line.state === "done") return "Done";
  if (sectionLabel === "PERSONAL") return "Remembered";
  if (sectionLabel === "RHYTHMS") return "Upcoming";
  return "Assigned";
}

function stateClass(line: Line) {
  if (line.state === "now") return styles.state_now;
  if (line.state === "waiting") return styles.state_waiting;
  if (line.state === "done") return styles.state_done;
  return "";
}

function secondary(line: Line) {
  return fact(line, "Next target")
    ?? fact(line, "When")
    ?? fact(line, "Date")
    ?? fact(line, "Why waiting")
    ?? fact(line, "Execution")
    ?? null;
}

function OverviewRow({ line, sectionLabel, href }: { line: Line; sectionLabel: string; href?: string }) {
  const rowSecondary = secondary(line);
  const body = (
    <>
      <span className={styles.rowMarker} aria-hidden="true" />
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{line.sentence}</span>
        <span className={styles.rowMeta}>
          <span>{line.worksheet?.kicker ?? sectionLabel}</span>
          {rowSecondary ? <span>{rowSecondary}</span> : null}
        </span>
      </span>
      <span className={`${styles.state} ${stateClass(line)}`}>{stateLabel(line, sectionLabel)}</span>
      {href ? <span className={styles.chevron} aria-hidden="true">›</span> : null}
    </>
  );

  if (href) {
    return <Link className={styles.row} href={href}>{body}</Link>;
  }
  return <div className={styles.row}>{body}</div>;
}

export default function AtlasResponsibilityOverview({
  identity,
  dateLabel,
  sections,
  sourceLinks,
  counts,
}: {
  identity: string;
  dateLabel: string;
  sections: Section[];
  sourceLinks: Record<string, string>;
  counts: Counts;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>your atlas</p>
            <p className={styles.identity}>{identity}</p>
            <h1>Overview</h1>
            <p className={styles.intro}>Everything assigned to you or remembered by you lives here. Atlas decides what reaches Today; responsibility does not disappear when it is not in hand.</p>
          </div>
          <div className={styles.date}>{dateLabel}</div>
        </header>

        <nav className={styles.actions} aria-label="Atlas views">
          <Link className={styles.primaryAction} href="/atlas/today">Today</Link>
          <Link href="/atlas/capture">Remember something</Link>
          <Link href="/day">Released work</Link>
        </nav>

        <section className={styles.summary} aria-label="Atlas responsibility counts">
          <div><strong>{counts.company}</strong><span>Company</span></div>
          <div><strong>{counts.personal}</strong><span>Personal</span></div>
          <div><strong>{counts.rhythms}</strong><span>Rhythms</span></div>
          <div><strong>{counts.waitingCompany}</strong><span>Waiting</span></div>
        </section>

        <div className={styles.sections}>
          {sections.length ? sections.map((section) => (
            <section className={styles.section} key={section.label}>
              <div className={styles.sectionHeading}>
                <h2>{section.label === "NOW" ? "In hand" : section.label.toLowerCase()}</h2>
                <span>{section.lines.length}</span>
              </div>
              <div className={styles.rows}>
                {section.lines.map((line) => (
                  <OverviewRow
                    key={line.id}
                    line={line}
                    sectionLabel={section.label}
                    href={sourceLinks[line.id]}
                  />
                ))}
              </div>
            </section>
          )) : (
            <section className={styles.empty}>
              <h2>Nothing is being carried right now.</h2>
              <p>Company responsibilities, personal reminders, and rhythms will appear here when they exist.</p>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
