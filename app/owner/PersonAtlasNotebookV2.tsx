"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type {
  PersonAtlasLine,
  PersonAtlasReservedSpan,
  PersonAtlasSection,
  PersonAtlasTimeMark,
  PersonAtlasUtilityGroup,
} from "./PersonAtlasChassis";
import styles from "./person-atlas-notebook-v2.module.css";

export type {
  PersonAtlasLine,
  PersonAtlasLineState,
  PersonAtlasReservedSpan,
  PersonAtlasSection,
  PersonAtlasTimeMark,
  PersonAtlasUtilityGroup,
  PersonAtlasUtilityItem,
  PersonAtlasWorksheetFact,
} from "./PersonAtlasChassis";

type PersonAtlasNotebookV2Props = {
  identity: string;
  greeting?: string;
  pageKicker?: string;
  pageTitle?: string;
  dateLabelOverride?: string;
  nowMinuteOverride?: number;
  nowLabelOverride?: string;
  sections: PersonAtlasSection[];
  timeMarks?: PersonAtlasTimeMark[];
  reservedSpans?: PersonAtlasReservedSpan[];
  nextHardEdge?: string;
  utilityGroups?: PersonAtlasUtilityGroup[];
  sourceLinks?: Record<string, string>;
};

const DAY_START_MINUTE = 7 * 60;
const DAY_END_MINUTE = 22 * 60;
const HOUR_TICKS = [8, 10, 12, 14, 16, 18, 20, 22].map((hour) => hour * 60);
const PAGE_WEIGHT = 10;

type NotebookPage = PersonAtlasSection[];

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

function styleAt(position: number): CSSProperties {
  return { "--atlas-time-position": `${position}%` } as CSSProperties;
}

function symbolForLine(line: PersonAtlasLine) {
  if (line.state === "done") return "×";
  if (line.state === "waiting") return ">";
  return "•";
}

function paginateSections(sections: PersonAtlasSection[], currentLine: PersonAtlasLine | null) {
  const cleaned = sections
    .map((section) => ({
      ...section,
      lines: section.lines.filter((line) => line.id !== currentLine?.id),
    }))
    .filter((section) => section.lines.length > 0);

  const pages: NotebookPage[] = [];
  let page: NotebookPage = [];
  let used = currentLine ? 2 : 0;

  const pushPage = () => {
    pages.push(page);
    page = [];
    used = 0;
  };

  for (const section of cleaned) {
    let remainingLines = [...section.lines];
    while (remainingLines.length) {
      const available = PAGE_WEIGHT - used;
      const needed = remainingLines.length + 1;

      if (needed <= available) {
        page.push({ ...section, lines: remainingLines });
        used += needed;
        remainingLines = [];
        continue;
      }

      if (available <= 1) {
        pushPage();
        continue;
      }

      const take = Math.max(1, available - 1);
      page.push({ ...section, lines: remainingLines.slice(0, take) });
      remainingLines = remainingLines.slice(take);
      used += take + 1;
      if (remainingLines.length) pushPage();
    }
  }

  if (page.length || pages.length === 0) pages.push(page);
  return pages;
}

export default function PersonAtlasNotebookV2({
  identity,
  greeting = "hello",
  pageKicker,
  pageTitle = "Today",
  dateLabelOverride,
  nowMinuteOverride,
  nowLabelOverride,
  sections,
  timeMarks = [],
  reservedSpans = [],
  nextHardEdge,
  utilityGroups = [],
  sourceLinks = {},
}: PersonAtlasNotebookV2Props) {
  const [now, setNow] = useState<Date | null>(null);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<PersonAtlasLine | null>(null);
  const [inspectedMark, setInspectedMark] = useState<PersonAtlasTimeMark | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    if (typeof nowMinuteOverride === "number" && nowLabelOverride) return;
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [nowLabelOverride, nowMinuteOverride]);

  const liveNowMinute = now ? now.getHours() * 60 + now.getMinutes() : 12 * 60;
  const nowMinute = typeof nowMinuteOverride === "number" ? nowMinuteOverride : liveNowMinute;
  const nowPosition = positionForMinute(nowMinute);
  const liveNowLabel = now
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now)
    : "Now";
  const nowLabel = nowLabelOverride ?? liveNowLabel;
  const liveDateLabel = now
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now)
    : "Today";
  const dateLabel = dateLabelOverride ?? liveDateLabel;

  const currentLine = useMemo(
    () => sections.flatMap((section) => section.lines).find((line) => line.state === "now") ?? null,
    [sections],
  );
  const pages = useMemo(() => paginateSections(sections, currentLine), [currentLine, sections]);
  const safePageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const pageSections = pages[safePageIndex] ?? [];
  const showKicker = Boolean(pageKicker?.trim() && pageKicker.trim().toLowerCase() !== pageTitle.trim().toLowerCase());

  useEffect(() => {
    if (pageIndex !== safePageIndex) setPageIndex(safePageIndex);
  }, [pageIndex, safePageIndex]);

  const lineContents = (line: PersonAtlasLine, current = false) => (
    <>
      <span aria-hidden="true">{current ? "* •" : symbolForLine(line)}</span>
      <strong>{line.sentence}</strong>
    </>
  );

  const renderLine = (line: PersonAtlasLine, current = false) => {
    const sourceHref = sourceLinks[line.id];
    const className = current ? `${styles.taskLine} ${styles.currentTask}` : styles.taskLine;

    if (sourceHref) {
      return (
        <Link
          className={className}
          data-state={line.state}
          href={sourceHref}
          key={line.id}
          aria-label={`${line.sentence}. Open its source.`}
        >
          {lineContents(line, current)}
        </Link>
      );
    }

    return (
      <button
        type="button"
        className={className}
        data-state={line.state}
        key={line.id}
        onClick={() => setSelectedLine(line)}
      >
        {lineContents(line, current)}
      </button>
    );
  };

  if (selectedLine) {
    return (
      <main className={styles.root} data-atlas-person-chassis="true" data-atlas-person-notebook-v2="true">
        <section className={`${styles.page} ${styles.dotPage}`} aria-label={`Opened Atlas item: ${selectedLine.sentence}`}>
          <header className={styles.topChrome}>
            <button type="button" className={styles.backButton} onClick={() => setSelectedLine(null)} aria-label="Return to Today">←</button>
            <div className={styles.greetingBlock}>
              <span>{selectedLine.worksheet?.kicker ?? greeting}</span>
              <strong>{identity}</strong>
            </div>
            <span aria-hidden="true" />
          </header>

          <article className={styles.worksheet}>
            <h1>{selectedLine.sentence}</h1>
            {selectedLine.worksheet?.facts?.length ? (
              <dl>
                {selectedLine.worksheet.facts.map((fact) => (
                  <div key={`${fact.label}:${fact.value}`}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {selectedLine.worksheet?.note ? <p>{selectedLine.worksheet.note}</p> : null}
          </article>

          <nav className={styles.pageNav} aria-label="Opened item navigation">
            <button type="button" onClick={() => setSelectedLine(null)}>‹</button>
            <button type="button" onClick={() => { setSelectedLine(null); setUtilityOpen(true); }}>index</button>
            <span>item</span>
            <button type="button" onClick={() => setSelectedLine(null)}>›</button>
          </nav>
        </section>
      </main>
    );
  }

  if (utilityOpen) {
    return (
      <main className={styles.root} data-atlas-person-chassis="true" data-atlas-person-notebook-v2="true">
        <section className={`${styles.page} ${styles.dotPage}`} aria-label="Atlas index">
          <header className={styles.topChrome}>
            <button type="button" className={styles.backButton} onClick={() => setUtilityOpen(false)} aria-label="Return to Today">←</button>
            <div className={styles.greetingBlock}>
              <span>index</span>
              <strong>{identity}</strong>
            </div>
            <span aria-hidden="true" />
          </header>

          <div className={styles.indexPage}>
            {utilityGroups.map((group) => (
              <section className={styles.indexGroup} key={group.label}>
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
                      return <Link className={styles.indexRow} href={item.href} key={`${group.label}:${item.label}`}>{body}</Link>;
                    }
                    return (
                      <button
                        className={styles.indexRow}
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

          <nav className={styles.pageNav} aria-label="Index navigation">
            <button type="button" onClick={() => setUtilityOpen(false)}>‹</button>
            <strong>index</strong>
            <span>00</span>
            <button type="button" onClick={() => setUtilityOpen(false)}>›</button>
          </nav>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.root} data-atlas-person-chassis="true" data-atlas-person-notebook-v2="true">
      <section className={`${styles.page} ${styles.dotPage}`}>
        <header className={styles.topChrome}>
          <div className={styles.greetingBlock}>
            <span>{greeting}</span>
            <strong>{identity}</strong>
          </div>
          <button type="button" className={styles.moreButton} onClick={() => setUtilityOpen(true)} aria-label="Open Atlas index">⋮</button>
        </header>

        <div className={styles.notebookBody}>
          <article className={styles.dayPage}>
            <header className={styles.dayHeader}>
              <div>
                <h1>{pageTitle}</h1>
                <span>{showKicker ? `${pageKicker} · ` : ""}{dateLabel}</span>
              </div>
              <i aria-hidden="true" />
            </header>

            {safePageIndex === 0 && currentLine ? (
              <section className={styles.nowBlock} aria-label={`Now, ${nowLabel}`}>
                <div className={styles.nowRule}>
                  <span>* now · {nowLabel}</span>
                  {nextHardEdge ? <small>{nextHardEdge}</small> : null}
                </div>
                {renderLine(currentLine, true)}
              </section>
            ) : null}

            <div className={styles.sections}>
              {pageSections.map((section, sectionIndex) => (
                <section className={styles.section} key={`${safePageIndex}:${section.label}:${sectionIndex}`}>
                  <h2>{section.label}</h2>
                  <div className={styles.lineList}>
                    {section.lines.map((line) => renderLine(line))}
                  </div>
                </section>
              ))}
            </div>
          </article>

          <aside className={styles.timeMargin} aria-label="Today time margin">
            <div className={styles.timeCaption}>time</div>
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
              <span className={styles.nowMarker} style={styleAt(nowPosition)} aria-label={`Now, ${nowLabel}`}><i /></span>
              {inspectedMark ? (
                <span className={styles.inspectLabel} style={styleAt(positionForMinute(inspectedMark.minute))}>
                  <small>looking at</small>
                  <strong>{minuteLabel(inspectedMark.minute)}</strong>
                  <em>{inspectedMark.label}</em>
                </span>
              ) : null}
            </div>
          </aside>
        </div>

        <nav className={styles.pageNav} aria-label="Notebook page navigation">
          <button
            type="button"
            onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
            disabled={safePageIndex === 0}
            aria-label="Previous notebook page"
          >‹</button>
          <button type="button" onClick={() => setUtilityOpen(true)}>index</button>
          <span>{String(safePageIndex + 1).padStart(2, "0")} / {String(pages.length).padStart(2, "0")}</span>
          <button
            type="button"
            onClick={() => setPageIndex((value) => Math.min(pages.length - 1, value + 1))}
            disabled={safePageIndex >= pages.length - 1}
            aria-label="Next notebook page"
          >›</button>
        </nav>
      </section>
    </main>
  );
}
