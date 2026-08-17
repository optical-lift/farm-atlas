import Link from "next/link";
import { redirect } from "next/navigation";

import {
  readPrincipalSelfContext,
  type HousePositionCurrencySummary,
  type PrincipalAttentionItem,
  type PrincipalClockCandidate,
  type PrincipalGreatGameScore,
  type PrincipalPortfolioThesis,
  type PrincipalPortfolioUnit,
} from "@/lib/atlas-data/principal-context";
import { getAtlasSession } from "@/lib/atlas/session";

import styles from "./principal.module.css";

export const dynamic = "force-dynamic";

const floorLabels: Record<number, string> = {
  1: "Human / fixed-time reality",
  2: "Closing window",
  3: "Protected rhythm / strategy",
  4: "Owner decision",
  5: "Planned value creation",
  6: "Delegated exception",
  7: "Backlog / optional",
};

function formatDateTime(value: string | null | undefined, timeZone: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: string | null | undefined, timeZone: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMoney(value: number | null | undefined, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function floorLabel(value: number | null | undefined) {
  if (!value) return "Unclassified";
  return `Class ${value} · ${floorLabels[value] ?? "Principal candidate"}`;
}

function PortfolioRows({ units }: { units: PrincipalPortfolioUnit[] }) {
  if (!units.length) return <p className={styles.empty}>No portfolio units are active yet.</p>;

  return (
    <div className={styles.list}>
      {units.map((unit) => (
        <div className={styles.row} key={unit.id}>
          <div className={styles.rowTop}>
            <div>
              <p className={styles.rowTitle}>{unit.name}</p>
              <p className={styles.rowMeta}>
                {unit.portfolioRole ?? unit.unitKind} · {unit.lifecycleState}
              </p>
            </div>
            {unit.horizon ? <span className={styles.horizon}>{unit.horizon}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttentionRows({ items, timeZone }: { items: PrincipalAttentionItem[]; timeZone: string }) {
  if (!items.length) return <p className={styles.empty}>No attention policies are currently due.</p>;

  return (
    <div className={styles.list}>
      {items.slice(0, 6).map((item) => (
        <div className={styles.row} key={`${item.subjectType}:${item.subjectId}`}>
          <div className={styles.rowTop}>
            <div>
              <p className={styles.rowTitle}>{item.title}</p>
              <p className={styles.rowMeta}>
                {item.attentionState ?? "tracked"}
                {item.nextDueAt ? ` · due ${formatDate(item.nextDueAt, timeZone)}` : ""}
              </p>
            </div>
            {item.attentionDebtDays && item.attentionDebtDays > 0 ? (
              <span className={`${styles.horizon} ${styles.attentionDebt}`}>
                {item.attentionDebtDays}d debt
              </span>
            ) : item.horizon ? (
              <span className={styles.horizon}>{item.horizon}</span>
            ) : null}
          </div>
          {item.reasonForFloor ? <p className={styles.rowMeta}>{item.reasonForFloor}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ThesisRows({ theses, timeZone }: { theses: PrincipalPortfolioThesis[]; timeZone: string }) {
  if (!theses.length) return <p className={styles.empty}>No portfolio theses are active yet.</p>;

  return (
    <div className={styles.list}>
      {theses.slice(0, 5).map((thesis) => (
        <div className={styles.row} key={thesis.id}>
          <div className={styles.rowTop}>
            <div>
              <p className={styles.rowTitle}>{thesis.portfolioUnitName}</p>
              <p className={styles.rowMeta}>{thesis.thesisStatement ?? "Thesis statement not written yet."}</p>
            </div>
            {thesis.horizon ? <span className={styles.horizon}>{thesis.horizon}</span> : null}
          </div>
          {thesis.nextValueMilestone ? (
            <p className={styles.rowMeta}>Next value milestone: {thesis.nextValueMilestone}</p>
          ) : null}
          {thesis.nextReviewAt ? (
            <p className={styles.rowMeta}>Review: {formatDate(thesis.nextReviewAt, timeZone)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CandidateRows({ items, timeZone }: { items: PrincipalClockCandidate[]; timeZone: string }) {
  if (!items.length) return <p className={styles.empty}>Nothing else has earned the Principal floor.</p>;

  return (
    <div className={styles.list}>
      {items.slice(0, 6).map((item) => (
        <div className={styles.row} key={`${item.sourceType}:${item.sourceId}`}>
          <p className={styles.rowTitle}>{item.title}</p>
          <p className={styles.rowMeta}>
            {floorLabel(item.floorClass)}
            {item.horizon ? ` · ${item.horizon}` : ""}
          </p>
          {item.reasonForFloor ? <p className={styles.rowMeta}>{item.reasonForFloor}</p> : null}
          {item.mustBeginBy ? (
            <p className={styles.rowMeta}>Must begin by {formatDateTime(item.mustBeginBy, timeZone)}</p>
          ) : item.windowEnd ? (
            <p className={styles.rowMeta}>Window closes {formatDateTime(item.windowEnd, timeZone)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ScoreRows({ scores }: { scores: PrincipalGreatGameScore[] }) {
  if (!scores.length) return <p className={styles.empty}>No Great Game scorecards are reporting yet.</p>;

  return (
    <div className={styles.list}>
      {scores.slice(0, 5).map((score) => (
        <div className={styles.row} key={score.scorecardId}>
          <div className={styles.rowTop}>
            <div>
              <p className={styles.rowTitle}>{score.name}</p>
              <p className={styles.rowMeta}>
                {[score.functionName, score.portfolioUnitName].filter(Boolean).join(" · ") || "Institution scorecard"}
              </p>
            </div>
            {score.trend ? <span className={styles.horizon}>{score.trend}</span> : null}
          </div>
          {score.nextPlay ? <p className={styles.rowMeta}>Next play: {score.nextPlay}</p> : null}
        </div>
      ))}
    </div>
  );
}

function MoneySummary({ summary }: { summary: HousePositionCurrencySummary }) {
  return (
    <div className={styles.moneyGrid}>
      <div className={styles.moneyCell}>
        <span className={styles.metaLabel}>Liquid resources</span>
        <span className={styles.moneyNumber}>{formatMoney(summary.liquidResources, summary.currency)}</span>
      </div>
      <div className={styles.moneyCell}>
        <span className={styles.metaLabel}>30-day position</span>
        <span className={styles.moneyNumber}>{formatMoney(summary.projectedLiquidity30, summary.currency)}</span>
      </div>
      <div className={styles.moneyCell}>
        <span className={styles.metaLabel}>60-day position</span>
        <span className={styles.moneyNumber}>{formatMoney(summary.projectedLiquidity60, summary.currency)}</span>
      </div>
      <div className={styles.moneyCell}>
        <span className={styles.metaLabel}>90-day position</span>
        <span className={styles.moneyNumber}>{formatMoney(summary.projectedLiquidity90, summary.currency)}</span>
      </div>
    </div>
  );
}

export default async function PrincipalPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/auth/login?next=/principal");

  const context = await readPrincipalSelfContext();
  if (context.state !== "ready" || !context.principal) {
    return (
      <main className={styles.shell}>
        <div className={styles.frame}>
          <section className={styles.header}>
            <p className={styles.kicker}>Atlas · Principal / Life</p>
            <h1 className={styles.title}>Principal context required</h1>
            <p className={styles.subtitle}>
              Your Atlas login is valid, but no active Principal identity is attached to it yet. Farm execution remains separate and unchanged.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const timeZone = context.principal.homeTimezone || "America/Chicago";
  const clock = context.principalClock;
  const floor = clock?.floor ?? null;
  const office = context.principalOffice;
  const housePosition = office?.housePosition;
  const units = context.portfolioUnits ?? [];
  const attention = office?.attention ?? [];
  const theses = office?.portfolioTheses ?? [];
  const scores = office?.greatGame ?? [];
  const functions = office?.operatingFunctions ?? [];
  const candidates = context.clockCandidates ?? [];
  const ownerObligations = candidates.filter((candidate) => candidate.sourceType === "owner_obligation");
  const otherCandidates = candidates.filter((candidate) => candidate.sourceType !== "owner_obligation");
  const currencySummaries = housePosition?.currencySummaries ?? [];

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <p className={styles.kicker}>Atlas · Principal / Life</p>
          <h1 className={styles.title}>{context.principal.name}</h1>
          <p className={styles.subtitle}>
            The whole field of responsibility in one place: people, household, portfolio, protected future, money, attention, authority, and the work that has actually earned the floor.
          </p>
          <div className={styles.statusRow}>
            <span className={styles.pill}>{units.length} portfolio units</span>
            <span className={styles.pill}>{functions.length} operating functions</span>
            <span className={styles.pill}>{attention.length} attention subjects</span>
            <span className={styles.pill}>Clock: {clock?.state ?? "unavailable"}</span>
          </div>
        </header>

        <section className={styles.floorCard} aria-labelledby="principal-floor-title">
          <p className={styles.sectionEyebrow}>Who gets to talk first</p>
          <h2 className={styles.sectionTitle} id="principal-floor-title">Principal Clock</h2>
          {floor?.title ? (
            <>
              <h3 className={styles.floorTitle}>{floor.title}</h3>
              <p className={styles.bodyText}>
                {floor.reason_for_floor ?? "This candidate currently has the strongest right to the Principal floor."}
              </p>
              <div className={styles.metaGrid}>
                <div className={styles.metaCell}>
                  <span className={styles.metaLabel}>Right to floor</span>
                  <span className={styles.metaValue}>{floorLabel(floor.floor_class)}</span>
                </div>
                <div className={styles.metaCell}>
                  <span className={styles.metaLabel}>Timing state</span>
                  <span className={styles.metaValue}>{floor.timing_state ?? "Open"}</span>
                </div>
                <div className={styles.metaCell}>
                  <span className={styles.metaLabel}>Expected owner time</span>
                  <span className={styles.metaValue}>
                    {floor.expected_minutes ? `${floor.expected_minutes} min` : "Not estimated"}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className={styles.empty}>Nothing currently has a right to interrupt the Principal.</p>
          )}
        </section>

        <div className={styles.grid}>
          <div className={styles.stack}>
            <section className={styles.card} aria-labelledby="portfolio-title">
              <p className={styles.sectionEyebrow}>Feast Guild / Portfolio</p>
              <h2 className={styles.sectionTitle} id="portfolio-title">H1 must not erase H2 or H3</h2>
              <PortfolioRows units={units} />
            </section>

            <section className={styles.card} aria-labelledby="obligations-title">
              <p className={styles.sectionEyebrow}>Ownership</p>
              <h2 className={styles.sectionTitle} id="obligations-title">Owner obligations</h2>
              <p className={styles.bodyText}>Thinking and preparation that must exist before a conventional due date becomes urgent.</p>
              <CandidateRows items={ownerObligations} timeZone={timeZone} />
            </section>

            <section className={styles.card} aria-labelledby="attention-title">
              <p className={styles.sectionEyebrow}>Attention capital</p>
              <h2 className={styles.sectionTitle} id="attention-title">What cannot be forgotten</h2>
              <AttentionRows items={attention} timeZone={timeZone} />
            </section>

            <section className={styles.card} aria-labelledby="thesis-title">
              <p className={styles.sectionEyebrow}>Portfolio Office</p>
              <h2 className={styles.sectionTitle} id="thesis-title">Theses and next value milestones</h2>
              <ThesisRows theses={theses} timeZone={timeZone} />
            </section>
          </div>

          <aside className={styles.stack}>
            <section className={styles.card} aria-labelledby="household-title">
              <p className={styles.sectionEyebrow}>Household & Family</p>
              <h2 className={styles.sectionTitle} id="household-title">Protected domain</h2>
              <p className={styles.bodyText}>
                {context.household
                  ? "Household reality is attached to this Principal context and participates in capacity and Clock arbitration."
                  : "No active household is attached yet."}
              </p>
            </section>

            <section className={styles.card} aria-labelledby="house-position-title">
              <p className={styles.sectionEyebrow}>Treasury</p>
              <h2 className={styles.sectionTitle} id="house-position-title">House Position</h2>
              <p className={styles.bodyText}>
                State: {housePosition?.state ?? "not available"}
                {housePosition?.asOf ? ` · as of ${formatDateTime(housePosition.asOf, timeZone)}` : ""}
              </p>
              {housePosition?.coverage?.state || housePosition?.freshness ? (
                <div className={styles.statusRow}>
                  {housePosition.coverage?.state ? <span className={styles.pill}>Coverage: {housePosition.coverage.state}</span> : null}
                  {housePosition.freshness ? <span className={styles.pill}>Freshness: {housePosition.freshness}</span> : null}
                </div>
              ) : null}
              {currencySummaries.length ? (
                currencySummaries.map((summary) => <MoneySummary key={summary.currency} summary={summary} />)
              ) : (
                <p className={styles.empty}>No financial snapshot is loaded yet. Atlas will not pretend an unknown feed is live.</p>
              )}
            </section>

            <section className={styles.card} aria-labelledby="score-title">
              <p className={styles.sectionEyebrow}>Great Game</p>
              <h2 className={styles.sectionTitle} id="score-title">Operating scoreboards</h2>
              <ScoreRows scores={scores} />
            </section>

            <section className={styles.card} aria-labelledby="next-floor-title">
              <p className={styles.sectionEyebrow}>Contained candidates</p>
              <h2 className={styles.sectionTitle} id="next-floor-title">What is waiting behind the floor</h2>
              <CandidateRows items={otherCandidates} timeZone={timeZone} />
            </section>

            <section className={styles.card} aria-labelledby="navigation-title">
              <p className={styles.sectionEyebrow}>Operating lenses</p>
              <h2 className={styles.sectionTitle} id="navigation-title">Execution stays separate</h2>
              <p className={styles.bodyText}>Farm execution truth remains available without becoming the root of the Principal day.</p>
              <div className={styles.nav}>
                <Link className={styles.navLink} href="/day">Worker Day</Link>
                <Link className={styles.navLink} href="/clock">Farm Clock</Link>
                <Link className={styles.navLink} href="/owner">Legacy Owner surface</Link>
              </div>
            </section>
          </aside>
        </div>

        {housePosition?.state === "limited" || housePosition?.state === "source_required" ? (
          <section className={styles.warning}>
            <strong>Financial coverage is not complete.</strong>
            Atlas is preserving source, as-of, coverage, and freshness state instead of presenting partial money data as a complete House Position.
          </section>
        ) : null}
      </div>
    </main>
  );
}
