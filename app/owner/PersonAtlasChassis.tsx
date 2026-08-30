"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import styles from "./person-atlas-chassis.module.css";

export type PersonAtlasLineState = "done" | "now" | "open" | "waiting";

export type PersonAtlasWorksheetFact = {
  label: string;
  value: string;
};

export type PersonAtlasLine = {
  id: string;
  sentence: string;
  state: PersonAtlasLineState;
  worksheet?: {
    kicker?: string;
    facts?: PersonAtlasWorksheetFact[];
    note?: string;
  };
};

export type PersonAtlasSection = {
  label: string;
  lines: PersonAtlasLine[];
};

export type PersonAtlasTimeMark = {
  id: string;
  minute: number;
  label: string;
  kind?: "move" | "hard" | "protected";
};

export type PersonAtlasReservedSpan = {
  id: string;
  startMinute: number;
  endMinute: number;
  label: string;
};

export type PersonAtlasUtilityItem = {
  label: string;
  detail?: string;
  href?: string;
  onSelect?: () => void;
};

export type PersonAtlasUtilityGroup = {
  label: string;
  items: PersonAtlasUtilityItem[];
};

type PersonAtlasChassisProps = {
  identity: string;
  identityDetail: string;
  pageKicker?: string;
  pageTitle?: string;
  pageIntro?: string;
  sections: PersonAtlasSection[];
  timeMarks?: PersonAtlasTimeMark[];
  reservedSpans?: PersonAtlasReservedSpan[];
  nextHardEdge?: string;
  utilityGroups?: PersonAtlasUtilityGroup[];
  footer?: ReactNode;
  fixtureLabel?: string;
};

const DAY_START_MINUTE = 7 * 60;
const DAY_END_MINUTE = 22 * 60;
const HOUR_TICKS = [8, 10, 12, 14, 16, 18, 20, 22].map((hour) => hour * 60);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function positionForMinute(minute: number) {
  return ((clamp(minute, DAY_START_MINUTE, DAY_END_MINUTE) - DAY_START_MINUTE) / (DAY_END_MINUTE - DAY_START_MINUTE)) * 100;
}

function minuteLabel(minute: number) {
  const hour24 = Math.floor(minute / 60);
  const minuteValue = minute % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}${minuteValue ? `:${String(minuteValue).padStart(2, "0")}` : ""} ${period}`;
}

function lineSymbol(state: PersonAtlasLineState) {
  if (state === "done") return "×";
  if (state === "now") return "●";
  if (state === "waiting") return ">";
  return "○";
}

function styleAt(position: number): CSSProperties {
  return { "--atlas-time-position": `${position}%` } as CSSProperties;
}

export default function PersonAtlasChassis({
  identity,
  identityDetail,
  pageKicker = "TODAY",
  pageTitle = "Today",
  pageIntro,
  sections,
  timeMarks = [],
  reservedSpans = [],
  nextHardEdge,
  utilityGroups = [],
  footer,
  fixtureLabel = "FUTURE ATLAS · FIXTURE ONLY",
}: PersonAtlasChassisProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<PersonAtlasLine | null>(null);
  const [inspectedMark, setInspectedMark] = useState<PersonAtlasTimeMark | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const nowMinute = now ? now.getHours() * 60 + now.getMinutes() : 12 * 60;
  const nowPosition = positionForMinute(nowMinute);
  const nowLabel = now
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now)
    : "Now";
  const dateLabel = now
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now)
    : "Today";

  const currentLine = useMemo(
    () => sections.flatMap((section) => section.lines).find((line) => line.state === "now") ?? null,
    [sections],
  );

  if (selectedLine) {
    return (
      <main className={styles.root} data-atlas-person-chassis="true" data-atlas-fixture-only="true">
        <section className={`${styles.fullPage} ${styles.dotPage}`} aria-label={`Opened Atlas item: ${selectedLine.sentence}`}>
          <header className={styles.pageChrome}>
            <button type="button" className={styles.backButton} onClick={() => setSelectedLine(null)} aria-label="Return to Today">←</button>
            <div>
              <span>{selectedLine.worksheet?.kicker ?? "OPENED ITEM"}</span>
              <strong>{identity}</strong>
            </div>
            <small>{fixtureLabel}</small>
          </header>

          <article className={styles.worksheet}>
            <h1 className={styles.handTitle}>{selectedLine.sentence}</h1>
            {selectedLine.worksheet?.facts?.length ? (
              <dl className={styles.factList}>
                {selectedLine.worksheet.facts.map((fact) => (
                  <div key={`${fact.label}:${fact.value}`}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {selectedLine.worksheet?.note ? <p className={styles.worksheetNote}>{selectedLine.worksheet.note}</p> : null}
            <div className={styles.fixtureAction}>No live mutation is connected to this page.</div>
          </article>
        </section>
      </main>
    );
  }

  if (utilityOpen) {
    return (
      <main className={styles.root} data-atlas-person-chassis="true" data-atlas-fixture-only="true">
        <section className={`${styles.fullPage} ${styles.dotPage}`} aria-label="Atlas index">
          <header className={styles.pageChrome}>
            <button type="button" className={styles.backButton} onClick={() => setUtilityOpen(false)} aria-label="Return to Today">←</button>
            <div>
              <span>ATLAS</span>
              <strong>{identity}</strong>
            </div>
            <small>{fixtureLabel}</small>
          </header>

          <div className={styles.utilityPage}>
            <h1>Everything else can stay quiet until you ask for it.</h1>
            {utilityGroups.map((group) => (
              <section className={styles.utilityGroup} key={group.label}>
                <h2>{group.label}</h2>
                <div>
                  {group.items.map((item) => {
                    const body = (
                      <>
                        <strong>{item.label}</strong>
                        {item.detail ? <span>{item.detail}</span> : null}
                        <b aria-hidden="true">›</b>
                      </>
                    );
                    if (item.href) {
                      return <Link className={styles.utilityRow} href={item.href} key={`${group.label}:${item.label}`}>{body}</Link>;
                    }
                    return (
                      <button
                        className={styles.utilityRow}
                        type="button"
                        key={`${group.label}:${item.label}`}
                        onClick={() => item.onSelect?.()}
                        disabled={!item.onSelect}
                      >
                        {body}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.root} data-atlas-person-chassis="true" data-atlas-fixture-only="true">
      <section className={`${styles.fullPage} ${styles.dotPage}`}>
        <header className={styles.pageChrome}>
          <div className={styles.identityBlock}>
            <span>{fixtureLabel}</span>
            <strong>{identity}</strong>
            <small>{identityDetail}</small>
          </div>
          <button type="button" className={styles.moreButton} onClick={() => setUtilityOpen(true)} aria-label="Open Atlas index">•••</button>
        </header>

        <div className={styles.dayLayout}>
          <article className={styles.dayPage}>
            <header className={styles.dayHeader}>
              <span>{pageKicker}</span>
              <h1>{pageTitle}</h1>
              <p>{dateLabel}</p>
              {pageIntro ? <small>{pageIntro}</small> : null}
            </header>

            {currentLine ? (
              <section className={styles.nowBlock} aria-label={`Now, ${nowLabel}`}>
                <div className={styles.nowRule}>
                  <span>NOW · {nowLabel}</span>
                  {nextHardEdge ? <small>{nextHardEdge}</small> : null}
                </div>
                <button type="button" className={styles.nowLine} onClick={() => setSelectedLine(currentLine)}>
                  <span aria-hidden="true">●</span>
                  <strong>{currentLine.sentence}</strong>
                </button>
              </section>
            ) : null}

            <div className={styles.sections}>
              {sections.map((section) => (
                <section className={styles.section} key={section.label}>
                  <h2>{section.label}</h2>
                  <div className={styles.lineList}>
                    {section.lines.filter((line) => line.id !== currentLine?.id).map((line) => (
                      <button
                        type="button"
                        className={styles.humanLine}
                        data-state={line.state}
                        key={line.id}
                        onClick={() => setSelectedLine(line)}
                      >
                        <span aria-hidden="true">{lineSymbol(line.state)}</span>
                        <strong>{line.sentence}</strong>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {footer ? <footer className={styles.pageFooter}>{footer}</footer> : null}
          </article>

          <aside className={styles.timeMargin} aria-label="Today time margin">
            <div className={styles.timeCaption}>TIME</div>
            <div className={styles.timeTrack}>
              <i className={styles.timeBase} aria-hidden="true" />
              {HOUR_TICKS.map((minute) => (
                <span className={styles.hourTick} style={styleAt(positionForMinute(minute))} key={minute}>
                  <i aria-hidden="true" />
                  <small>{minuteLabel(minute).replace(" ", "\n")}</small>
                </span>
              ))}
              {reservedSpans.map((span) => (
                <span
                  className={styles.reservedSpan}
                  style={{
                    "--atlas-time-position": `${positionForMinute(span.startMinute)}%`,
                    "--atlas-time-size": `${Math.max(1.5, positionForMinute(span.endMinute) - positionForMinute(span.startMinute))}%`,
                  } as CSSProperties}
                  title={span.label}
                  key={span.id}
                />
              ))}
              {timeMarks.map((mark) => (
                <button
                  type="button"
                  className={styles.timeMark}
                  data-kind={mark.kind ?? "move"}
                  data-inspected={inspectedMark?.id === mark.id}
                  style={styleAt(positionForMinute(mark.minute))}
                  key={mark.id}
                  onClick={() => setInspectedMark((current) => current?.id === mark.id ? null : mark)}
                  aria-label={`Inspect ${mark.label} at ${minuteLabel(mark.minute)}`}
                >
                  <i />
                </button>
              ))}
              <span className={styles.nowMarker} style={styleAt(nowPosition)} aria-label={`Now, ${nowLabel}`}>
                <i />
              </span>
              {inspectedMark ? (
                <span className={styles.inspectLabel} style={styleAt(positionForMinute(inspectedMark.minute))}>
                  <small>LOOKING AT</small>
                  <strong>{minuteLabel(inspectedMark.minute)}</strong>
                  <em>{inspectedMark.label}</em>
                </span>
              ) : null}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
