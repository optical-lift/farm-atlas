import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";
import type { AtlasDayReservation, AtlasDayReservationKind } from "@/lib/atlas/day-reservations";

const reservationKinds = new Set<AtlasDayReservationKind>(["routine", "meal", "external_commitment"]);

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function normalizeReservation(row: Record<string, unknown>): AtlasDayReservation | null {
  const kind = row.kind;
  if (
    typeof row.id !== "string"
    || typeof row.service_date !== "string"
    || typeof row.title !== "string"
    || typeof row.starts_at !== "string"
    || typeof row.ends_at !== "string"
    || !reservationKinds.has(kind as AtlasDayReservationKind)
  ) return null;

  return {
    reservationId: row.id,
    serviceDate: row.service_date,
    kind: kind as AtlasDayReservationKind,
    title: row.title,
    startAt: row.starts_at,
    endAt: row.ends_at,
  };
}

export async function readAtlasDayReservations(input: {
  farmId: string;
  membershipId: string;
  serviceDate: string;
}) {
  if (!validDateIso(input.serviceDate)) throw new Error("A valid YYYY-MM-DD reservation day is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("day_reservations")
    .select("id,service_date,kind,title,starts_at,ends_at")
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
