export type AtlasFarmSnapshot = {
  totalBeds: number;
  growingBeds: number;
  activeSqft: number;
  sowingsLogged: number;
  stemsLogged: number;
};

export type AtlasFarmSnapshotResponse = AtlasFarmSnapshot & {
  ok: boolean;
  farmKey: string;
  snapshot: AtlasFarmSnapshot;
  error?: string;
  details?: string;
};

export async function fetchAtlasFarmSnapshot(): Promise<AtlasFarmSnapshotResponse> {
  const response = await fetch("/api/atlas/farm-snapshot", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const data = (await response.json()) as Omit<AtlasFarmSnapshotResponse, keyof AtlasFarmSnapshot>;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Failed to load farm snapshot.");
  return { ...data, ...data.snapshot };
}
