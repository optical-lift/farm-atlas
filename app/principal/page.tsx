import Link from "next/link";
import { redirect } from "next/navigation";

import {
  readAtlasPrincipalSelfContext,
  type AtlasHousePosition,
  type AtlasPrincipalCapacityState,
  type AtlasPrincipalPortfolioUnit,
} from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

const shellStyle = {
  minHeight: "100vh",
  background: "#f5f1e8",
  color: "#262626",
  padding: "24px 16px 48px",
} as const;

const pageStyle = {
  width: "min(980px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: "16px",
} as const;

const cardStyle = {
  border: "1px solid rgba(38, 38, 38, 0.12)",
  borderRadius: "18px",
  background: "rgba(255,255,255,.76)",
  padding: "18px",
  boxShadow: "0 10px 32px rgba(47, 43, 31, 0.045)",
} as const;

const eyebrowStyle = {
  display: "block",
  marginBottom: "6px",
  fontSize: "10px",
  fontWeight: 900,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  opacity: 0.58,
} as const;

function prettyState(value: string | null | undefined) {
  return (value || "unknown").replaceAll("_", " ");
}

function minutesLabel(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "Not estimated";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function CapacityCard({ capacity }: { capacity: AtlasPrincipalCapacityState | null | undefined }) {
  const state = capacity?.state ?? "unknown";
  const known = capacity?.capacityKnown === true;

  return (
    <section style={cardStyle} aria-label="Principal capacity">
      <span style={eyebrowStyle}>Principal Capacity</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>{known ? "Capacity resolved" : "Capacity not yet anchored"}</h2>
      {known ? (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
          {minutesLabel(capacity?.discretionaryCapacityMinutes)} discretionary · {minutesLabel(capacity?.blockedMinutes)} blocked · {minutesLabel(capacity?.maximumPlannedMinutes)} maximum planned.
        </p>
      ) : (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
          Atlas is preserving the boundary instead of treating an empty calendar as infinite time. {capacity?.reason || `Current state: ${prettyState(state)}.`}
        </p>
      )}
    </section>
  );
}

function PortfolioCard({ units }: { units: AtlasPrincipalPortfolioUnit[] }) {
  const ordered = [...units].sort((a, b) => {
    const rank = (value: string | null) => value === "H1" ? 1 : value === "H2" ? 2 : value === "H3" ? 3 : 4;
    return rank(a.horizon) - rank(b.horizon) || a.name.localeCompare(b.name);
  });

  return (
    <section style={cardStyle} aria-label="Portfolio horizons">
      <span style={eyebrowStyle}>Feast Guild / Portfolio</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Horizons</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {ordered.length ? ordered.map((unit) => (
          <div key={unit.id} style={{ display: "grid", gridTemplateColumns: "52px 1fr auto", gap: 12, alignItems: "center", padding: "11px 0", borderTop: "1px solid rgba(38,38,38,.08)" }}>
            <strong>{unit.horizon || "—"}</strong>
            <span><b>{unit.name}</b><small style={{ display: "block", opacity: .62, marginTop: 2 }}>{prettyState(unit.lifecycleState)} · {prettyState(unit.unitKind)}</small></span>
            <span style={{ fontSize: 12, opacity: .58 }}>{unit.linkedFarmId ? "Operating unit linked" : "No farm required"}</span>
          </div>
        )) : <p style={{ margin: "10px 0 0" }}>No portfolio units are currently authored.</p>}
      </div>
    </section>
  );
}

function HousePositionCard({ position }: { position: AtlasHousePosition | null | undefined }) {
  const state = position?.state ?? "unknown";
  const coverage = position?.coverage?.state ?? "unknown";
  const freshness = position?.freshness ?? "unknown";
  const summaries = position?.currencySummaries ?? [];

  return (
    <section style={cardStyle} aria-label="House Position">
      <span style={eyebrowStyle}>Money / Treasury</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>House Position</h2>
      {state === "source_required" ? (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
          Financial source required. Coverage is {coverage}; freshness is {freshness}. Atlas is not substituting zero balances for unknown data.
        </p>
      ) : summaries.length ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {summaries.map((summary, index) => (
            <div key={`${summary.currency || "currency"}-${index}`} style={{ borderTop: "1px solid rgba(38,38,38,.08)", paddingTop: 10 }}>
              <strong>{summary.currency || "Currency"}</strong>
              <span style={{ display: "block", marginTop: 4, opacity: .72 }}>
                30d {summary.projectedLiquidity30 ?? "unknown"} · 60d {summary.projectedLiquidity60 ?? "unknown"} · 90d {summary.projectedLiquidity90 ?? "unknown"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0" }}>State: {prettyState(state)} · coverage {coverage} · freshness {freshness}.</p>
      )}
    </section>
  );
}

export default async function AtlasPrincipalPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");

  const context = await readAtlasPrincipalSelfContext();
  const principal = context.principal ?? null;
  const clock = context.principalClock ?? null;
  const floor = clock?.floor ?? null;
  const office = context.principalOffice ?? null;
  const attention = office?.attention ?? [];

  return (
    <main style={shellStyle}>
      <div style={pageStyle}>
        <header style={{ ...cardStyle, background: "#24251f", color: "#f8f4e8" }}>
          <span style={{ ...eyebrowStyle, opacity: .7 }}>Atlas · Principal</span>
          <h1 style={{ margin: 0, fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1 }}>{principal?.name || "Principal"}</h1>
          <p style={{ margin: "10px 0 0", maxWidth: 680, lineHeight: 1.5, opacity: .78 }}>
            Whole-field responsibility across household, portfolio, money, attention, authority, and protected future.
          </p>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
            <Link href="/more" style={{ color: "inherit" }}>More</Link>
            <Link href="/overview/week" style={{ color: "inherit" }}>Farm operations</Link>
          </nav>
        </header>

        <section style={{ ...cardStyle, borderWidth: 2 }} aria-label="Principal Clock">
          <span style={eyebrowStyle}>Principal Clock</span>
          {floor ? (
            <>
              <h2 style={{ margin: 0, fontSize: 26 }}>{floor.title || "Current Principal claim"}</h2>
              <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>{floor.reason_for_floor || floor.consequence || "This claim has earned the floor under the current arbitration state."}</p>
              <p style={{ margin: "10px 0 0", fontSize: 12, opacity: .62 }}>
                Class {floor.floor_class ?? "—"} · {prettyState(floor.timing_state)} · {minutesLabel(floor.expected_minutes)} · allocation {prettyState(clock?.allocationState)}
              </p>
            </>
          ) : (
            <>
              <h2 style={{ margin: 0, fontSize: 26 }}>No claim has earned the floor</h2>
              <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
                Atlas is remembering Principal claims without manufacturing urgency. Clock state: {prettyState(clock?.state)}; allocation remains {prettyState(clock?.allocationState)}.
              </p>
            </>
          )}
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <CapacityCard capacity={context.capacityToday} />
          <HousePositionCard position={office?.housePosition} />
        </div>

        <PortfolioCard units={context.portfolioUnits ?? []} />

        <section style={cardStyle} aria-label="Attention">
          <span style={eyebrowStyle}>Attention</span>
          <h2 style={{ margin: 0, fontSize: 22 }}>Quiet responsibilities</h2>
          {attention.length ? (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {attention.map((item, index) => (
                <div key={item.subjectId || `${item.title || "attention"}-${index}`} style={{ borderTop: "1px solid rgba(38,38,38,.08)", paddingTop: 10 }}>
                  <strong>{item.horizon ? `${item.horizon} · ` : ""}{item.title || "Attention subject"}</strong>
                  <span style={{ display: "block", marginTop: 3, opacity: .68 }}>{prettyState(item.attentionState)}{item.attentionDebtDays ? ` · ${item.attentionDebtDays}d attention debt` : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>No attention cadence is currently due. Atlas has not inferred one from task volume.</p>
          )}
        </section>
      </div>
    </main>
  );
}
