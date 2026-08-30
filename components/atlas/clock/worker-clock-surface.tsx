"use client";

import styles from "./worker-clock-surface.module.css";

export type WorkerClockMoveRole = "last" | "now" | "next" | "then";
export type WorkerClockRailTask = { id: string; label: string; minute: number };
export type WorkerClockReservation = {
  id: string;
  label: string;
  kind: "point" | "span";
  startMinute: number;
  endMinute: number;
  timeLabel: string;
};
export type WorkerClockMove = {
  id: string;
  role: WorkerClockMoveRole;
  family: string;
  title: string;
  detail: string;
  timeLabel: string;
};
export type WorkerClockHardEdge = { id: string; label: string; timeLabel: string };

export type WorkerClockSurfaceProps = {
  weekdayLabel: string;
  dateLabel: string;
  dayStartMinute: number;
  dayEndMinute: number;
  nowMinute: number | null;
  nowLabel: string | null;
  reservations: WorkerClockReservation[];
  railTasks: WorkerClockRailTask[];
  moves: WorkerClockMove[];
  hardEdge?: WorkerClockHardEdge | null;
  headerHint?: string;
  ariaLabel?: string;
};

function clampPosition(minute: number, dayStartMinute: number, dayEndMinute: number) {
  const denominator = Math.max(1, dayEndMinute - dayStartMinute);
  return Math.max(0, Math.min(1, (minute - dayStartMinute) / denominator)) * 100;
}

function railWidth(startMinute: number, endMinute: number, dayStartMinute: number, dayEndMinute: number) {
  return Math.max(0, clampPosition(endMinute, dayStartMinute, dayEndMinute) - clampPosition(startMinute, dayStartMinute, dayEndMinute));
}

function minuteLabel(minute: number) {
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minutePart = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return minutePart ? `${hour}:${String(minutePart).padStart(2, "0")} ${period}` : `${hour} ${period}`;
}

function FullDayRail({
  dayStartMinute,
  dayEndMinute,
  nowMinute,
  nowLabel,
  reservations,
  railTasks,
}: Pick<WorkerClockSurfaceProps, "dayStartMinute" | "dayEndMinute" | "nowMinute" | "nowLabel" | "reservations" | "railTasks">) {
  return (
    <section className={styles.dayRailPanel} aria-label={`Full-day time rail${nowLabel ? `, now ${nowLabel}` : ""}`}>
      <header className={styles.dayRailHeader}>
        <span>{minuteLabel(dayStartMinute)}</span>
        <strong>FULL DAY</strong>
        <span>{minuteLabel(dayEndMinute)}</span>
      </header>
      <div className={styles.dayRail}>
        <i className={styles.dayRailBase} aria-hidden="true" />
        {reservations.map((reservation) => reservation.kind === "span" ? (
          <i
            className={styles.occupiedSpan}
            style={{
              left: `${clampPosition(reservation.startMinute, dayStartMinute, dayEndMinute)}%`,
              width: `${railWidth(reservation.startMinute, reservation.endMinute, dayStartMinute, dayEndMinute)}%`,
            }}
            title={`${reservation.label} · ${reservation.timeLabel}`}
            aria-hidden="true"
            key={reservation.id}
          />
        ) : (
          <i
            className={styles.reservationPoint}
            style={{ left: `${clampPosition(reservation.startMinute, dayStartMinute, dayEndMinute)}%` }}
            title={`${reservation.label} · ${reservation.timeLabel}`}
            aria-hidden="true"
            key={reservation.id}
          />
        ))}
        {railTasks.map((task) => (
          <i
            className={styles.railTaskDot}
            style={{ left: `${clampPosition(task.minute, dayStartMinute, dayEndMinute)}%` }}
            title={task.label}
            aria-hidden="true"
            key={task.id}
          />
        ))}
        {nowMinute !== null ? <>
          <b className={styles.railNowDot} style={{ left: `${clampPosition(nowMinute, dayStartMinute, dayEndMinute)}%` }} aria-hidden="true" />
          {nowLabel ? <small className={styles.railNowLabel} style={{ left: `${clampPosition(nowMinute, dayStartMinute, dayEndMinute)}%` }}>{nowLabel}</small> : null}
        </> : null}
      </div>
    </section>
  );
}

function MoveCard({ move }: { move: WorkerClockMove }) {
  return (
    <article className={styles.executionMove} data-role={move.role} data-task-id={move.id}>
      <div className={styles.moveRole}><span>{move.role.toUpperCase()}</span></div>
      <div className={styles.moveIdentity}>
        <span>{move.family}</span>
        <strong>{move.title}</strong>
        <small>{move.detail}</small>
      </div>
      <time>{move.timeLabel}</time>
    </article>
  );
}

export default function WorkerClockSurface({
  weekdayLabel,
  dateLabel,
  dayStartMinute,
  dayEndMinute,
  nowMinute,
  nowLabel,
  reservations,
  railTasks,
  moves,
  hardEdge,
  headerHint = "Day owns everything else",
  ariaLabel = "Worker Clock execution neighborhood",
}: WorkerClockSurfaceProps) {
  return (
    <section className={styles.surface} data-atlas-worker-clock-surface="study-15-v1" aria-label={ariaLabel}>
      <header className={styles.dateHeader}>
        <div><span>{weekdayLabel}</span><strong>{dateLabel}</strong></div>
        <small>CLOCK</small>
      </header>
      <FullDayRail
        dayStartMinute={dayStartMinute}
        dayEndMinute={dayEndMinute}
        nowMinute={nowMinute}
        nowLabel={nowLabel}
        reservations={reservations}
        railTasks={railTasks}
      />
      <section className={styles.executionNeighborhood}>
        <header className={styles.executionHeader}>
          <div><span>EXECUTION NEIGHBORHOOD</span><strong>{nowLabel ? `NOW · ${nowLabel}` : "TODAY"}</strong></div>
          <small>{headerHint}</small>
        </header>
        {moves.length ? <div className={styles.executionStack}>{moves.map((move) => <MoveCard move={move} key={`${move.role}-${move.id}`} />)}</div> : (
          <div className={styles.emptyNeighborhood}><div><strong>No immediate move</strong><span>Day still owns the full work list.</span></div></div>
        )}
        {hardEdge ? (
          <section className={styles.hardEdge} aria-label={`Next hard edge, ${hardEdge.label}, ${hardEdge.timeLabel}`}>
            <div><span>NEXT HARD EDGE</span><strong>{hardEdge.label}</strong></div>
            <time>{hardEdge.timeLabel}</time>
          </section>
        ) : null}
      </section>
    </section>
  );
}
