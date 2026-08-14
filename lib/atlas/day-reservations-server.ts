import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";
import type {
  AtlasDayReservation,
  AtlasDayReservationKind,
  AtlasDayReservationSource,
} from "@/lib/atlas/day-reservations";

const reservationKinds = new Set<AtlasDayReservationKind>(["routine", "meal", "external_commitment"]);
const reservationSources = new Set<AtlasDayReservationSource>(["owner_manual", "fixed_routine", "calendar_import", "atlas_rule"]);

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function normalizeReservation(row: Record<string, unknown>): AtlasDayReservation | null {
  const kind = row.kind;
  const source = row.source === "owner_instruction" ? "owner_manual" : row.source;
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  if (
    typeof row.id !== "string"
    || typeof row.service_date !== "string"
    || typeof row.title !== "string"
    || typeof row.starts_at !== "string"
    || typeof row.ends_at !== "string"
    || !reservationKinds.has(kind as AtlasDayReservationKind)
    || !reservationSources.has(source as AtlasDayReservationSource)
  ) return null;

  return {
    reservationId: row.id,
    serviceDate: row.service_date,
    kind: kind as AtlasDayReservationKind,
    title: row.title,
    startAt: row.starts_at,
    endAt: row.ends_at,
    source: source as AtlasDayReservationSource,
    sourceReference: typeof row.source_reference === "string" ? row.source_reference : null,
    note: typeof metadata.operationalNote === "string" ? metadata.operationalNote : null,
  };
}

export async function readAtlasDayReservations(input: {
  farmId: string;
  membershipId: string;
  serviceDate: string;
}) {
  if (!validDateIso(input.serviceDate)) throw new Error("A valid YYYY-MM-DD reservation day is required.");

  const supabase = await createAtlasServerClient();
  const sync = await supabase.rpc("sync_fixed_routine_reservations_for_day_v1", {
    p_farm_id: input.farmId,
    p_membership_id: input.membershipId,
    p_day: input.serviceDate,
  });
  if (sync.error && sync.error.code !== "PGRST202") throw new Error(sync.error.message);

  const { data, error } = await supabase
    .from("day_reservations")
    .select("id,service_date,kind,title,starts_at,ends_at,source,source_reference,metadata")
    .eq("farm_id", input.farmId)
    .eq("membership_id", input.membershipId)
    .eq("service_date", input.serviceDate)
    .eq("active", true)
    .order("starts_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => normalizeReservation(row as Record<string, unknown>))
    .filter((reservation): reservation is AtlasDayReservation => Boolean(reservation));
}
