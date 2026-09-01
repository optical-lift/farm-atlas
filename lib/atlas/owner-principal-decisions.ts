import {
  readAtlasPrincipalDecisionPackets,
  type AtlasPrincipalDecisionCandidate,
} from "@/lib/atlas/principal-decision-packets";
import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";

export type OwnerPrincipalDecisionPreview = {
  candidateKey: string;
  title: string;
  prompt: string;
  portfolioUnitId: string | null;
  portfolioUnitName: string;
  linkedFarmId: string | null;
  sourceDomain: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  authorityBasis: string | null;
  admissionBasis: string | null;
  consequence: string | null;
  reasonForFloor: string | null;
  windowEnd: string | null;
  expectedPrincipalMinutes: number | null;
  commandKind: string | null;
  commandContractVersion: string | null;
  commandTargetKind: string | null;
  commandTargetId: string | null;
};

export type OwnerPrincipalDecisionProjection = {
  state: string;
  coverageState: string | null;
  coverageMode: string | null;
  completeFieldClaim: boolean;
  items: OwnerPrincipalDecisionPreview[];
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function previewFromCandidate(
  candidate: AtlasPrincipalDecisionCandidate,
  unitById: Map<string, { name: string; linkedFarmId: string | null }>,
): OwnerPrincipalDecisionPreview | null {
  const candidateKey = clean(candidate.candidateKey);
  if (!candidateKey) return null;

  const portfolioUnitId = clean(candidate.scope?.portfolioUnitId);
  const unit = portfolioUnitId ? unitById.get(portfolioUnitId) : null;
  const title = clean(candidate.presentation?.title) ?? clean(candidate.prompt) ?? "Principal decision required";

  return {
    candidateKey,
    title,
    prompt: clean(candidate.prompt) ?? title,
    portfolioUnitId,
    portfolioUnitName: unit?.name ?? "Principal",
    linkedFarmId: unit?.linkedFarmId ?? null,
    sourceDomain: clean(candidate.source?.domain),
    sourceKind: clean(candidate.source?.kind),
    sourceId: clean(candidate.source?.id),
    authorityBasis: clean(candidate.authority?.basis),
    admissionBasis: clean(candidate.admission?.basis),
    consequence: clean(candidate.admission?.consequence),
    reasonForFloor: clean(candidate.admission?.reasonForFloor),
    windowEnd: clean(candidate.timing?.windowEnd),
    expectedPrincipalMinutes: typeof candidate.timing?.expectedPrincipalMinutes === "number"
      ? candidate.timing.expectedPrincipalMinutes
      : null,
    commandKind: clean(candidate.command?.kind),
    commandContractVersion: clean(candidate.command?.contractVersion),
    commandTargetKind: clean(candidate.command?.targetKind),
    commandTargetId: clean(candidate.command?.targetId),
  };
}

export async function readOwnerPrincipalDecisionProjection(): Promise<OwnerPrincipalDecisionProjection> {
  const [feed, principal] = await Promise.all([
    readAtlasPrincipalDecisionPackets(),
    readAtlasPrincipalSelfContext(),
  ]);

  const unitById = new Map(
    (principal.portfolioUnits ?? []).map((unit) => [unit.id, { name: unit.name, linkedFarmId: unit.linkedFarmId }]),
  );

  return {
    state: feed.state,
    coverageState: clean(feed.coverageState),
    coverageMode: clean(feed.coverageMode),
    completeFieldClaim: feed.completeFieldClaim === true,
    items: feed.candidates
      .map((candidate) => previewFromCandidate(candidate, unitById))
      .filter((item): item is OwnerPrincipalDecisionPreview => Boolean(item)),
  };
}
