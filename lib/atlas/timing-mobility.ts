export type AtlasTimingConstraintClass = "fixed" | "anchored" | "windowed" | "flexible";
export type AtlasTimingClass = AtlasTimingConstraintClass | "potential";
export type AtlasAnchorRelation = "before" | "after";

export type AtlasTimingMobility = {
  timingClass: AtlasTimingClass;
  constraintClass: AtlasTimingConstraintClass;
  fixedLocalTime: string | null;
  windowStartAt: string | null;
  windowEndAt: string | null;
  anchorTaskId: string | null;
  anchorRelation: AtlasAnchorRelation | null;
  minimumGapMinutes: number | null;
  travelLocation: string | null;
  placementReason: string;
};

type MobilityInput = {
  metadata?: Record<string, unknown> | null;
  location?: string | null;
  potential?: boolean;
};

const constraintClasses = new Set<AtlasTimingConstraintClass>(["fixed", "anchored", "windowed", "flexible"]);

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function uuid(value: unknown) {
  const candidate = text(value);
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function exactTimestamp(value: unknown) {
  const candidate = text(value);
  if (!candidate || !candidate.includes("T")) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}

function localTime(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  const compact = candidate.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (compact) return `${String(Number(compact[1])).padStart(2, "0")}:${compact[2]}`;
  const twelveHour = candidate.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*([ap])\.?m\.?$/i);
  if (!twelveHour) return null;
  const rawHour = Number(twelveHour[1]) % 12;
  const hour = rawHour + (twelveHour[3].toLowerCase() === "p" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${twelveHour[2]}`;
}

function explicitConstraint(metadata: Record<string, unknown>) {
  const value = text(metadata.timing_class ?? metadata.clock_timing_class);
  return value && constraintClasses.has(value as AtlasTimingConstraintClass)
    ? value as AtlasTimingConstraintClass
    : null;
}

export function deriveAtlasTimingMobility(input: MobilityInput): AtlasTimingMobility {
  const metadata = input.metadata ?? {};
  const fixedLocalTime = localTime(
    metadata.scheduled_time_24h
      ?? metadata.scheduled_time
      ?? metadata.anna_pickup_time
      ?? metadata.fixed_local_time,
  );
  const windowStartAt = exactTimestamp(
    metadata.pickup_window_start
      ?? metadata.clock_window_start
      ?? metadata.execution_window_start,
  );
  const windowEndAt = exactTimestamp(
    metadata.pickup_window_end
      ?? metadata.clock_window_end
      ?? metadata.execution_window_end,
  );

  const followAfter = uuid(
    metadata.follow_up_after_task_id
      ?? metadata.card_details_dependency_task_id
      ?? metadata.dependency_source_task_id,
  );
  const explicitAnchorTaskId = uuid(metadata.anchor_task_id ?? metadata.clock_anchor_task_id);
  const explicitAnchorRelation = text(metadata.anchor_relation ?? metadata.clock_anchor_relation);
  const mustFinishBeforeDeparture = truthy(metadata.must_complete_before_departure);
  const anchorTaskId = explicitAnchorTaskId ?? followAfter ?? uuid(metadata.departure_task_id);
  const anchorRelation: AtlasAnchorRelation | null = explicitAnchorRelation === "before" || explicitAnchorRelation === "after"
    ? explicitAnchorRelation
    : followAfter
      ? "after"
      : mustFinishBeforeDeparture
        ? "before"
        : null;

  const minimumGapMinutes = number(metadata.minimum_gap_minutes ?? metadata.dependency_delay_minutes);
  const travelLocation = text(
    metadata.travel_location
      ?? metadata.display_location
      ?? metadata.execution_place
      ?? metadata.work_location
      ?? metadata.location_label
      ?? input.location,
  );

  const explicit = explicitConstraint(metadata);
  const constraintClass: AtlasTimingConstraintClass = explicit
    ?? (fixedLocalTime ? "fixed"
      : windowStartAt || windowEndAt ? "windowed"
        : anchorRelation || anchorTaskId ? "anchored"
          : "flexible");

  const placementReason = constraintClass === "fixed"
    ? "Carries an explicit clock-time constraint."
    : constraintClass === "windowed"
      ? "Must stay inside a recorded execution window."
      : constraintClass === "anchored"
        ? anchorRelation === "before"
          ? "Must remain before its recorded anchor."
          : anchorRelation === "after"
            ? "Must remain after its recorded anchor."
            : "Must remain attached to its recorded anchor."
        : "No clock constraint is recorded; Atlas may place it where the day fits.";

  return {
    timingClass: input.potential ? "potential" : constraintClass,
    constraintClass,
    fixedLocalTime,
    windowStartAt,
    windowEndAt,
    anchorTaskId,
    anchorRelation,
    minimumGapMinutes,
    travelLocation,
    placementReason,
  };
}

export function atlasTimingClassLabel(mobility: AtlasTimingMobility) {
  if (mobility.timingClass === "potential") return "Potential";
  if (mobility.constraintClass === "fixed") return mobility.fixedLocalTime ? `Fixed · ${mobility.fixedLocalTime}` : "Fixed";
  if (mobility.constraintClass === "windowed") return "Windowed";
  if (mobility.constraintClass === "anchored") return mobility.anchorRelation === "before" ? "Anchored · before" : mobility.anchorRelation === "after" ? "Anchored · after" : "Anchored";
  return "Flexible";
}