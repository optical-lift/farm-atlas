export type AtlasDayReservationKind = "routine" | "meal" | "external_commitment";

export type AtlasDayReservation = {
  reservationId: string;
  serviceDate: string;
  kind: AtlasDayReservationKind;
  title: string;
  startAt: string;
  endAt: string;
};

export function atlasDayReservationClockReason(reservation: AtlasDayReservation) {
  if (reservation.kind === "routine") return "A fixed routine reserves this part of the day.";
  if (reservation.kind === "meal") return "A meal reserves this part of the day.";
  return "A real external commitment reserves this part of the day.";
}
