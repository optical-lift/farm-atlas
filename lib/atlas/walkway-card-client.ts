export type AtlasWalkwayCardDerived = {
  state: string;
  clockState: string;
  nextAction: string;
  nextActionKey: string | null;
  taskEligible: boolean;
  strategy: "spray" | "mow" | "mulch" | "weed";
  lastStrategyAt: string | null;
  diebackReviewAt: string | null;
  observedCondition: string;
  observedAt: string | null;
  observationAfterClock: boolean;
  timeClaimsPhysicalCondition: false;
  laborTimeTracked: false;
  releaseState?: string | null;
  releaseCapacityBlocked?: boolean;
};

export type AtlasWalkwayCard = {
  cardId: string;
  cardKey: string;
  farmId: string;
  zoneId: string | null;
  zoneKey: string | null;
  zoneLabel: string | null;
  objectId: string;
  objectKey: string;
  objectLabel: string;
  objectType: string;
  strategy: "spray" | "mow" | "mulch" | "weed";
  targetCondition: string;
  lastStrategyAt: string | null;
  diebackIntervalSeconds: number;
  diebackReviewAt: string | null;
  observedCondition: string;
  observedAt: string | null;
  currentOccurrenceId: string | null;
  currentOccurrenceTitle: string | null;
  currentOccurrenceState: string | null;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStatus: string | null;
  metadata: Record<string, unknown>;
  derived: AtlasWalkwayCardDerived;
};

export type AtlasWalkwayCardsResponse = {
  ok: boolean;
  contractVersion?: "walkway_cards_v1";
  farmId?: string;
  asOf?: string;
  cards?: AtlasWalkwayCard[];
  error?: string;
  details?: string;
};

export async function fetchAtlasWalkwayCard(objectKey: string) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/walkway-card`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await response.json()) as AtlasWalkwayCardsResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Atlas could not load this Walkway Card.");
  }
  return data.cards?.[0] ?? null;
}
