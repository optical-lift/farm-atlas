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

export function normalizeAtlasDayReservations(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((row) => normalizeReservation(row as Record<string, unknown>))
    .filter((reservation): reservation is AtlasDayReservation => Boolean(reservation));
}

export async function readAtlasDayReservations(input: {
  farmId: string;
  membershipId: string;
  serviceDate: string;
}) {
  if (!validDateIso(input.serviceDate)) throw new Error("A valid YYYY-MM-DD reservation day is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("day_reservations_api_v2", {
    p_farm_id: input.farmId,
    p_membership_id: input.membershipId,
    p_day: input.serviceDate,
  });
  if (error) throw new Error(error.message);

  return normalizeAtlasDayReservations(data);
}