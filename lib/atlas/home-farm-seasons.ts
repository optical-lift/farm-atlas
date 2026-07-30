import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasHomeFarmSeasonProfile = {
  farmId: string;
  locationLabel: string | null;
  frostStatus: "known" | "unknown";
  frostBoundaryMonth: number | null;
  frostBoundaryDay: number | null;
  frostNote: string | null;
};

type FarmSeasonRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

function text(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function readAtlasHomeFarmSeasonProfiles(
  farmIds: string[],
): Promise<Record<string, AtlasHomeFarmSeasonProfile>> {
  const uniqueIds = [...new Set(farmIds.filter(Boolean))];
  if (!uniqueIds.length) return {};

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("farms")
    .select("id, metadata")
    .in("id", uniqueIds);

  if (error || !Array.isArray(data)) return {};

  return (data as FarmSeasonRow[]).reduce<Record<string, AtlasHomeFarmSeasonProfile>>((profiles, row) => {
    const metadata = row.metadata ?? {};
    const status = text(metadata, "frost_status") === "known" ? "known" : "unknown";
    profiles[row.id] = {
      farmId: row.id,
      locationLabel: text(metadata, "location_label"),
      frostStatus: status,
      frostBoundaryMonth: status === "known" ? integer(metadata, "frost_boundary_month") : null,
      frostBoundaryDay: status === "known" ? integer(metadata, "frost_boundary_day") : null,
      frostNote: text(metadata, "frost_note"),
    };
    return profiles;
  }, {});
}
