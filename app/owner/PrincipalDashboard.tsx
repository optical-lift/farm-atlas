import Link from "next/link";

import type {
  PrincipalClockClaim,
  PrincipalSelfContext,
} from "@/lib/atlas-data/principal-context";

function prettyDate(value: string | null | undefined) {
  if (!value) return "Today";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "Unknown";
}

function count(value: unknown[] | undefined) {
  return Array.isArray(value) ? value.length : 0;
}

function FloorClaim({ claim }: { claim: PrincipalClockClaim }) {
  return (
    <article
      className="atlas-overview-zone-card atlas-owner-section"
      style={{ padding: 18, borderWidth: 2 }}
      data-principal-floor="true"
    >
      <small style={{ textTransform: "uppercase", letterSpacing: ".08em", opacity: .58 }}>
        Current floor · class {claim.floorClass ?? "—"}
      </small>
      <strong style={{ display: "block", marginTop: 5, fontSize: 22 }}>
        {claim.title || "Principal claim"}
      </strong>
      {claim.reasonForFloor ? <p style={{ margin: "7px 0 0", opacity: .76 }}>{claim.reasonForFloor}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {claim.domain ? <span>{label(claim.domain)}</span> : null}
        {claim.horizon ? <span>{claim.horizon}</span> : null}
        {claim.timingState ? <span>{label(claim.timingState)}</span> : null}
        {claim.expectedMinutes ? <span>{claim.expectedMinutes} min</span> : null}
      </div>
      {claim.consequence ? <p style={{ margin: "12px 0 0", fontWeight: 700 }}>Delay: {claim.consequence}</p> : null}
    </article>
  );
}

export default function PrincipalDashboard({ context }: { context: PrincipalSelfContext }) {
  if (context.state !== "ready" || !context.principal) {
    return (
      <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell">
        <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
          <header className="atlas-phone-top atlas-dashboard-top">
            <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
              <span className="atlas-phone-kicker">Atlas</span>
              <span className="atlas-phone-title">Principal</span>
            </Link>
          </header>
          <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
            <section className="atlas-overview-hero atlas-owner-hero">
              <div><strong>Principal context required</strong><span>Atlas has no active Principal contract for this account.</span></div>
            </section>
          </div>
        </section>
      </main>
    );
  }

  const clock = context.principalClock ?? null;
  const capacity = context.capacityToday ?? clock?.capacity ?? null;
  const office = context.principalOffice ?? null;
  const housePosition = office?.housePosition ?? null;
  const portfolio = context.portfolioUnits ?? [];
  const candidates = clock?.candidates ?? [];
  const floor = clock?.floor ?? null;
  const householdName = context.household?.name ?? "Household";
  const serviceDate = clock?.serviceDate ?? capacity?.serviceDate ?? null;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell" data-atlas-principal="true">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Principal</span>
          </Link>
          <span className="atlas-weather-line">{context.principal.name}</span>
          <Link href="/owner/members" className="atlas-note-plus atlas-overview-top-dot" aria-label="People and access">People</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <section className="atlas-overview-hero atlas-owner-hero">
            <div>
              <strong>Who has earned the floor?</strong>
              <span>{prettyDate(serviceDate)}</span>
            </div>
            <p>
              {floor
                ? `${floor.title ?? "A Principal claim"} currently has the floor.`
                : "No Principal claim currently has the floor."}
            </p>
          </section>

          {floor ? (
            <FloorClaim claim={floor} />
          ) : (
            <section className="atlas-overview-zone-card atlas-owner-section" style={{ padding: 18 }} data-principal-floor-empty="true">
              <small style={{ textTransform: "uppercase", letterSpacing: ".08em", opacity: .58 }}>Principal Clock</small>
              <strong style={{ display: "block", marginTop: 5, fontSize: 20 }}>Quiet floor</strong>
              <p style={{ margin: "7px 0 0", opacity: .72 }}>
                Atlas has {candidates.length} current Principal {candidates.length === 1 ? "claim" : "claims"}. Delegated farm work stays in the operating layer unless it crosses an escalation contract.
              </p>
            </section>
          )}

          <section className="atlas-overview-stat-grid" aria-label="Principal state">
            <article>
              <strong>{capacity?.capacityKnown ? "Known" : "Anchor"}</strong>
              <span>capacity</span>
            </article>
            <article>
              <strong>{portfolio.length}</strong>
              <span>portfolio units</span>
            </article>
            <article>
              <strong>{count(office?.attention)}</strong>
              <span>attention claims</span>
            </article>
            <article>
              <strong>{count(office?.operatingFunctions)}</strong>
              <span>functions</span>
            </article>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-capacity-state={capacity?.state ?? "unknown"}>
            <summary>
              <div><strong>Principal Capacity</strong><span>{capacity?.capacityKnown ? "Anchored" : "Needs an anchor"}</span></div>
              <b>{label(capacity?.state)}</b>
            </summary>
            <div style={{ padding: "12px 18px 16px" }}>
              <p style={{ margin: 0, opacity: .74 }}>
                {capacity?.reason ?? (capacity?.capacityKnown
                  ? "Atlas has a capacity contract for this day."
                  : "Atlas will not treat an empty calendar as infinite capacity.")}
              </p>
              <Link href="/owner/capacity" style={{ display: "inline-block", marginTop: 10, fontWeight: 800 }}>
                {capacity?.capacityKnown ? "Review capacity policies →" : "Establish Principal Capacity →"}
              </Link>
            </div>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-portfolio="true">
            <summary>
              <div><strong>Feast Guild / Portfolio</strong><span>H1 · H2 · H3</span></div>
              <b>{portfolio.length} units</b>
            </summary>
            <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
              {portfolio.length ? portfolio.map((unit) => (
                <article key={unit.id} style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <strong>{unit.name}</strong>
                    <b>{unit.horizon}</b>
                  </div>
                  <p style={{ margin: "5px 0 0", opacity: .68, fontSize: 13 }}>
                    {label(unit.portfolioRole)} · {label(unit.lifecycleState)} · {label(unit.unitKind)}
                  </p>
                </article>
              )) : <p className="atlas-task-page-muted">No portfolio units are recorded.</p>}
            </div>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-household="true">
            <summary>
              <div><strong>Household & Family</strong><span>{householdName}</span></div>
              <b>Protected domain</b>
            </summary>
            <div style={{ padding: "12px 18px 16px" }}>
              <p style={{ margin: 0, opacity: .74 }}>
                Household reality belongs at the Principal layer. It constrains capacity without becoming farm-output work.
              </p>
            </div>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-office="true">
            <summary>
              <div><strong>Principal Office</strong><span>Strategy · attention · functions · treasury</span></div>
              <b>{label(office?.state)}</b>
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, padding: "0 14px 14px" }}>
              <article style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12 }}><strong style={{ display: "block", fontSize: 20 }}>{count(office?.portfolioTheses)}</strong><span style={{ opacity: .64 }}>portfolio theses</span></article>
              <article style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12 }}><strong style={{ display: "block", fontSize: 20 }}>{count(office?.greatGame)}</strong><span style={{ opacity: .64 }}>scoreboards</span></article>
              <article style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12, gridColumn: "1 / -1" }}>
                <strong style={{ display: "block" }}>House Position · {label(housePosition?.state)}</strong>
                <span style={{ display: "block", marginTop: 4, opacity: .64 }}>
                  {housePosition?.state === "source_required"
                    ? "Financial source required. Coverage and freshness remain unknown until evidence is connected."
                    : `Freshness: ${label(housePosition?.freshness)}${housePosition?.asOf ? ` · as of ${housePosition.asOf}` : ""}`}
                </span>
              </article>
            </div>
          </section>

          <section className="atlas-overview-zone-list atlas-owner-list" aria-label="Operating systems">
            <Link className="atlas-overview-task-card atlas-owner-task-card" href="/overview/week"><div><strong>Farm Execution</strong><span>Worker and operating truth</span></div><em>Open</em><p>Inspect the farm execution week without making its task list the Principal root.</p></Link>
            <Link className="atlas-overview-task-card atlas-owner-task-card" href="/projects"><div><strong>Projects</strong><span>Operating-unit execution</span></div><em>Open</em><p>Work inside projects while portfolio context remains above them.</p></Link>
            <Link className="atlas-overview-task-card atlas-owner-task-card" href="/owner/lineage"><div><strong>Trail Lineage Audit</strong><span>evidence stewardship</span></div><em>Open</em><p>Review evidence links without promoting ordinary delegated work into Principal priority.</p></Link>
          </section>
        </div>
      </section>
    </main>
  );
}
