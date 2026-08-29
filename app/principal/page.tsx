import Link from "next/link";
import { redirect } from "next/navigation";

import {
  readAtlasPrincipalSelfContext,
  type AtlasHousePosition,
  type AtlasPrincipalAttentionItem,
  type AtlasPrincipalCapabilityHolds,
  type AtlasPrincipalCapacityState,
  type AtlasPrincipalClockCandidate,
  type AtlasPrincipalGreatGameScore,
  type AtlasPrincipalHousehold,
  type AtlasPrincipalOperatingFunction,
  type AtlasPrincipalPortfolioThesis,
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

const rowStyle = {
  borderTop: "1px solid rgba(38,38,38,.08)",
  paddingTop: 10,
} as const;

function prettyState(value: string | null | undefined) {
  return (value || "unknown").replaceAll("_", " ");
}

function personLabel(value: string | null | undefined) {
  const clean = (value || "").replaceAll("_", " ").trim();
  if (!clean) return "Unassigned";
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function minutesLabel(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "Not estimated";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function moneyLabel(value: number | null | undefined, currency = "USD") {
  if (!Number.isFinite(Number(value))) return "unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value));
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

function HouseholdCard({ household }: { household: AtlasPrincipalHousehold | null | undefined }) {
  return (
    <section style={cardStyle} aria-label="Household and family">
      <span style={eyebrowStyle}>Household &amp; Family</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>{household?.name || "Household domain"}</h2>
      <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
        {household
          ? `Protected household reality is active in ${household.timezone || "the Principal timezone"}. Household rhythms constrain business capacity instead of appearing as interruptions.`
          : "No active household is attached to this Principal yet. Atlas will not infer unlimited business capacity from that absence."}
      </p>
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
      <p style={{ margin: "7px 0 0", lineHeight: 1.5, opacity: .7 }}>H1 current engines remain visible without consuming H2 emerging engines or H3 future options.</p>
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

function CapabilityHoldsCard({ holds }: { holds: AtlasPrincipalCapabilityHolds | null | undefined }) {
  const items = holds?.items ?? [];

  return (
    <section style={cardStyle} aria-label="Waiting for capability">
      <span style={eyebrowStyle}>Waiting for capability</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Held outside Worker Day</h2>
      <p style={{ margin: "7px 0 0", lineHeight: 1.5, opacity: .72 }}>
        These obligations still exist, but Atlas will not put them on someone&apos;s day until the people, capability, tools, materials, travel or location, time, or information they need becomes available.
      </p>
      {items.length ? (
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {items.map((item) => {
            const dimensions = (item.holdDimensions ?? []).map((dimension) => prettyState(dimension));
            return (
              <div key={item.taskId} style={rowStyle}>
                <strong>{item.portfolioHorizon ? `${item.portfolioHorizon} · ` : ""}{item.portfolioUnitName} · {item.title}</strong>
                <span style={{ display: "block", marginTop: 4, opacity: .68 }}>
                  Assigned to {personLabel(item.assignedWorkerKey || item.assignedRole)} · original due {dateLabel(item.originalDueDate || item.dueDate)}
                </span>
                {item.blocker ? <span style={{ display: "block", marginTop: 6, lineHeight: 1.45 }}>{item.blocker}</span> : null}
                {dimensions.length ? (
                  <span style={{ display: "block", marginTop: 6, fontSize: 12, opacity: .58 }}>
                    Waiting on {dimensions.join(" · ")}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: "10px 0 0", lineHeight: 1.55 }}>No obligations are currently waiting for capability.</p>
      )}
    </section>
  );
}

function OwnerObligationsCard({ candidates }: { candidates: AtlasPrincipalClockCandidate[] }) {
  const obligations = candidates.filter((candidate) => candidate.sourceType === "owner_obligation");

  return (
    <section style={cardStyle} aria-label="Owner obligations">
      <span style={eyebrowStyle}>Owner Obligations</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Preparation before urgency</h2>
      {obligations.length ? (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {obligations.slice(0, 6).map((item) => (
            <div key={item.sourceId} style={rowStyle}>
              <strong>{item.horizon ? `${item.horizon} · ` : ""}{item.title}</strong>
              <span style={{ display: "block", marginTop: 4, opacity: .68 }}>
                Class {item.floorClass} · {minutesLabel(item.expectedMinutes)}
                {item.mustBeginBy ? ` · begin by ${dateLabel(item.mustBeginBy)}` : ""}
                {item.mustFinishBy ? ` · finish by ${dateLabel(item.mustFinishBy)}` : ""}
              </span>
              {item.reasonForFloor || item.consequence ? (
                <span style={{ display: "block", marginTop: 5, lineHeight: 1.45 }}>{item.reasonForFloor || item.consequence}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>No active Owner Obligation is currently in the Principal candidate inventory.</p>
      )}
    </section>
  );
}

function AttentionCard({ attention }: { attention: AtlasPrincipalAttentionItem[] }) {
  return (
    <section style={cardStyle} aria-label="Attention">
      <span style={eyebrowStyle}>Attention Capital</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Quiet responsibilities</h2>
      {attention.length ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {attention.slice(0, 6).map((item, index) => (
            <div key={item.subjectId || `${item.title || "attention"}-${index}`} style={rowStyle}>
              <strong>{item.horizon ? `${item.horizon} · ` : ""}{item.title || "Attention subject"}</strong>
              <span style={{ display: "block", marginTop: 3, opacity: .68 }}>
                {prettyState(item.attentionState)}{item.attentionDebtDays ? ` · ${item.attentionDebtDays}d attention debt` : ""}
                {item.protectedOwnerMinutes ? ` · ${minutesLabel(item.protectedOwnerMinutes)} protected` : ""}
              </span>
              {item.reasonForFloor ? <span style={{ display: "block", marginTop: 5 }}>{item.reasonForFloor}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>No attention cadence is currently due. Atlas has not inferred one from task volume.</p>
      )}
    </section>
  );
}

function PortfolioThesesCard({ theses }: { theses: AtlasPrincipalPortfolioThesis[] }) {
  return (
    <section style={cardStyle} aria-label="Portfolio theses">
      <span style={eyebrowStyle}>Portfolio Office</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Theses &amp; next value milestones</h2>
      {theses.length ? (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {theses.map((thesis) => (
            <div key={thesis.id} style={rowStyle}>
              <strong>{thesis.horizon ? `${thesis.horizon} · ` : ""}{thesis.portfolioUnitName}</strong>
              <span style={{ display: "block", marginTop: 5, lineHeight: 1.5 }}>{thesis.thesisStatement || "Thesis statement not written yet."}</span>
              {thesis.nextValueMilestone ? <span style={{ display: "block", marginTop: 5, opacity: .7 }}>Next value milestone: {thesis.nextValueMilestone}</span> : null}
              {thesis.nextReviewAt ? <span style={{ display: "block", marginTop: 3, opacity: .62 }}>Review {dateLabel(thesis.nextReviewAt)}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>No active portfolio thesis is authored yet.</p>
      )}
    </section>
  );
}

function FunctionsCard({ functions }: { functions: AtlasPrincipalOperatingFunction[] }) {
  return (
    <section style={cardStyle} aria-label="Operating functions">
      <span style={eyebrowStyle}>Teams / Functions</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Durable functions</h2>
      {functions.length ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {functions.map((item) => (
            <div key={item.id} style={rowStyle}>
              <strong>{item.name}</strong>
              <span style={{ display: "block", marginTop: 3, opacity: .68 }}>
                Capacity {prettyState(item.capacityState)}{item.reviewCadenceDays ? ` · review every ${item.reviewCadenceDays}d` : ""}
              </span>
              {item.charter ? <span style={{ display: "block", marginTop: 5, lineHeight: 1.45 }}>{item.charter}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0" }}>No durable operating functions are authored yet.</p>
      )}
    </section>
  );
}

function GreatGameCard({ scores }: { scores: AtlasPrincipalGreatGameScore[] }) {
  return (
    <section style={cardStyle} aria-label="Great Game scoreboards">
      <span style={eyebrowStyle}>Great Game</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>Operating scoreboards</h2>
      {scores.length ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {scores.map((score) => (
            <div key={score.scorecardId} style={rowStyle}>
              <strong>{score.horizon ? `${score.horizon} · ` : ""}{score.name}</strong>
              <span style={{ display: "block", marginTop: 3, opacity: .68 }}>
                {[score.functionName, score.portfolioUnitName, prettyState(score.measurementState)].filter(Boolean).join(" · ")}
              </span>
              {score.nextPlay ? <span style={{ display: "block", marginTop: 5 }}>Next play: {score.nextPlay}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0" }}>No Great Game scorecards are reporting yet.</p>
      )}
    </section>
  );
}

function HousePositionCard({ position }: { position: AtlasHousePosition | null | undefined }) {
  const state = position?.state ?? "unknown";
  const coverage = position?.coverage?.state ?? "unknown";
  const freshness = position?.freshness ?? "unknown";
  const summaries = position?.currencySummaries ?? [];
  const requests = position?.capitalRequests ?? [];
  const opportunities = position?.investmentOpportunities ?? [];

  return (
    <section style={cardStyle} aria-label="House Position">
      <span style={eyebrowStyle}>Money / Treasury</span>
      <h2 style={{ margin: 0, fontSize: 22 }}>House Position</h2>
      <p style={{ margin: "7px 0 0", lineHeight: 1.5, opacity: .7 }}>Source {position?.source || "unknown"} · coverage {coverage} · freshness {freshness}{position?.asOf ? ` · as of ${dateLabel(position.asOf)}` : ""}.</p>
      {state === "source_required" ? (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
          Financial source required. Atlas is not substituting zero balances for unknown data.
        </p>
      ) : summaries.length ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {summaries.map((summary, index) => (
            <div key={`${summary.currency || "currency"}-${index}`} style={rowStyle}>
              <strong>{summary.currency || "Currency"} · liquid {moneyLabel(summary.liquidResources, summary.currency)}</strong>
              <span style={{ display: "block", marginTop: 4, opacity: .72 }}>
                30d {moneyLabel(summary.projectedLiquidity30, summary.currency)} · 60d {moneyLabel(summary.projectedLiquidity60, summary.currency)} · 90d {moneyLabel(summary.projectedLiquidity90, summary.currency)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0" }}>State: {prettyState(state)}.</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 16 }}>
        <div>
          <strong>Capital requests</strong>
          {requests.length ? requests.map((request) => (
            <div key={request.id} style={{ ...rowStyle, marginTop: 8 }}>
              <b>{request.title}</b>
              <span style={{ display: "block", marginTop: 3, opacity: .68 }}>
                {moneyLabel(request.amount, request.currency)} · {prettyState(request.status)}{request.neededBy ? ` · needed ${dateLabel(request.neededBy)}` : ""}
              </span>
            </div>
          )) : <p style={{ margin: "6px 0 0", opacity: .65 }}>No open capital requests.</p>}
        </div>
        <div>
          <strong>Investment-ready opportunities</strong>
          {opportunities.length ? opportunities.map((opportunity) => (
            <div key={opportunity.id} style={{ ...rowStyle, marginTop: 8 }}>
              <b>{opportunity.title}</b>
              <span style={{ display: "block", marginTop: 3, opacity: .68 }}>
                {moneyLabel(opportunity.capitalRequired, opportunity.currency)} · {prettyState(opportunity.readinessState)}
              </span>
              {opportunity.nextValueMilestone ? <span style={{ display: "block", marginTop: 4 }}>Next value milestone: {opportunity.nextValueMilestone}</span> : null}
            </div>
          )) : <p style={{ margin: "6px 0 0", opacity: .65 }}>No active investment opportunity is authored.</p>}
        </div>
      </div>
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
          <HouseholdCard household={context.household} />
          <CapacityCard capacity={context.capacityToday} />
        </div>

        <PortfolioCard units={context.portfolioUnits ?? []} />
        <CapabilityHoldsCard holds={context.capabilityHolds} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <OwnerObligationsCard candidates={context.clockCandidates ?? []} />
          <AttentionCard attention={office?.attention ?? []} />
        </div>

        <PortfolioThesesCard theses={office?.portfolioTheses ?? []} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <FunctionsCard functions={office?.operatingFunctions ?? []} />
          <GreatGameCard scores={office?.greatGame ?? []} />
        </div>

        <HousePositionCard position={office?.housePosition} />
      </div>
    </main>
  );
}
