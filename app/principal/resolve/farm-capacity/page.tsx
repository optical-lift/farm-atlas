import Link from "next/link";
import { redirect } from "next/navigation";

import {
  readAtlasPrincipalSelfContext,
  type AtlasPrincipalClockFloor,
} from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

import WorkerDayShapeResolutionClient, {
  type FarmCapacityExceptionTarget,
} from "./WorkerDayShapeResolutionClient";

export const dynamic = "force-dynamic";

const shellStyle = {
  minHeight: "100vh",
  background: "#f5f1e8",
  color: "#262626",
  padding: "24px 16px 48px",
} as const;
const pageStyle = { width: "min(980px, 100%)", margin: "0 auto", display: "grid", gap: 16 } as const;
const cardStyle = {
  border: "1px solid rgba(38,38,38,.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.76)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;

type ArbitrationCandidate = AtlasPrincipalClockFloor & {
  source_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function capacityTargets(
  candidates: AtlasPrincipalClockFloor[],
  portfolioUnits: Array<{ linkedFarmId: string | null; name: string }>,
): FarmCapacityExceptionTarget[] {
  return candidates.flatMap((candidate) => {
    const item = candidate as ArbitrationCandidate;
    const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    if (item.source_type !== "operational_escalation") return [];
    if (text(metadata.sourceSystem) !== "farm_clock" || text(metadata.sourceType) !== "worker_weekly_capacity") return [];

    const farmId = text(metadata.farmId);
    const membershipId = text(metadata.membershipId);
    const weekStart = text(metadata.weekStart);
    const weekEnd = text(metadata.weekEnd);
    if (!farmId || !membershipId || !weekStart || !weekEnd) return [];

    const farmName = portfolioUnits.find((unit) => unit.linkedFarmId === farmId)?.name || "Farm operating unit";
    return [{
      sourceId: item.source_id || `${farmId}:${membershipId}:${weekStart}`,
      farmId,
      membershipId,
      farmName,
      workerLabel: text(metadata.workerKey) || "Farm Hand",
      weekStart,
      weekEnd,
      state: text(metadata.farmClockState) || "capacity_truth_required",
      threshold: text(metadata.thresholdCrossed) || "Farm Hand capacity truth is required before Atlas can judge this weekly load.",
      consequence: item.consequence || "Atlas cannot truthfully distinguish a feasible week from a real capacity breach until the Farm Hand Day Shape is known.",
      ownerDecision: text(metadata.ownerDecisionRequired) || "Author or repair the Farm Hand Day Shape from real human availability.",
    }];
  });
}

export default async function PrincipalFarmCapacityResolutionPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");

  const context = await readAtlasPrincipalSelfContext();
  if (context.state !== "ready" || !context.principal) redirect("/principal");

  const targets = capacityTargets(
    context.principalClock?.candidates ?? [],
    context.portfolioUnits ?? [],
  );

  return (
    <main style={shellStyle}>
      <div style={pageStyle}>
        <header style={{ ...cardStyle, background: "#24251f", color: "#f8f4e8" }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .7 }}>Atlas · Principal Exception Resolution</span>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(30px,6vw,48px)", lineHeight: 1 }}>Resolve Farm Hand capacity truth</h1>
          <p style={{ margin: "10px 0 0", maxWidth: 780, lineHeight: 1.55, opacity: .82 }}>
            This workspace exists only when Farm Clock has earned a Principal exception. It does not turn unfinished farm work into Owner work. It records the human availability boundary Farm Clock needs before it can distinguish a feasible week from a real capacity breach.
          </p>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16 }}>
            <Link href="/principal" style={{ color: "inherit", fontWeight: 800 }}>← Principal</Link>
            <Link href="/overview/week" style={{ color: "inherit", fontWeight: 800 }}>Farm operations</Link>
          </nav>
        </header>

        <section style={cardStyle}>
          <strong>Capacity is evidence, not a target</strong>
          <p style={{ margin: "7px 0 0", lineHeight: 1.55, opacity: .74 }}>
            Do not choose hours that make the work fit. Record the Farm Hand&apos;s real recurring working days and real local working window. Atlas will then re-run the governed weekly capacity contract and either contain the week, preserve a recovery state, or escalate a measured breach.
          </p>
        </section>

        {targets.length ? targets.map((target) => (
          <WorkerDayShapeResolutionClient key={target.sourceId} target={target} />
        )) : (
          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 24 }}>No Farm Clock capacity exception needs ownership</h2>
            <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
              There is no open weekly Farm Hand capacity exception in Principal Clock. Ordinary delegated work remains contained in Farm Clock.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
