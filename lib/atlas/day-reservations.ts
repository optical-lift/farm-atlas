export type AtlasDayReservationKind = "routine" | "meal" | "external_commitment";
export type AtlasDayReservationSource = "owner_manual" | "fixed_routine" | "calendar_import" | "atlas_rule";

export type AtlasDayReservation = {
  reservationId: string;
  serviceDate: string;
  kind: AtlasDayReservationKind;
  title: string;
  startAt: string;
  endAt: string;
  source: AtlasDayReservationSource;
  sourceReference: string | null;
  note: string | null;
};

export function atlasDayReservationClockReason(reservation: AtlasDayReservation) {
  if (reservation.kind === "routine") return "A fixed routine reserves this part of the day.";
  if (reservation.kind === "meal") return "A meal reserves this part of the day.";
  return "A real external commitment reserves this part of the day.";
}

export function atlasDayReservationSourceLabel(source: AtlasDayReservationSource) {
  if (source === "fixed_routine") return "Fixed routine";
  if (source === "calendar_import") return "Calendar";
  if (source === "atlas_rule") return "Atlas rule";
  return "Owner";
}
