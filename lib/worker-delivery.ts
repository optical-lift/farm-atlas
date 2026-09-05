import "server-only";

import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const ELM_FARM_ID = "6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f";
export const ANNA_FARM_MEMBERSHIP_ID = "23e98e5e-16ca-40d8-872c-c77e06baa167";
export const ELM_TIME_ZONE = "America/Chicago";

type DeliveryPayload = {
  details?: string[];
  sourceRefs?: string[];
  effect?: string;
  [key: string]: unknown;
};

type ProjectionRow = {
  id: string;
  planned_date: string;
  original_planned_date: string | null;
  title: string;
  plan_order: number;
  plan_state: "planned" | "conditional" | "flexible";
  rollover_policy: "carry" | "expire" | "re_evaluate";
  delivery_key: string | null;
  delivery_payload: DeliveryPayload | null;
};

type ProjectionSourceRow = {
  projection_id: string;
  work_item_id: string;
  source_role: "required" | "context" | "evidence";
};

type WorkItemRow = {
  id: string;
  work_state: "open" | "completed" | "cancelled" | "superseded";
};

type PilotEventRow = {
  id: string;
  event_seq: number;
  projection_id: string | null;
  event_kind:
    | "start"
    | "stop"
    | "done_reported"
    | "completion_reopened"
    | "unscheduled_work_reported";
  effective_at: string;
  reported_title: string | null;
};

export type WorkerDeliveryItem = {
  id: string;
  key: string;
  title: string;
  details: string[];
  completed: boolean;
  institutionallyCompleted: boolean;
  reportedCompleted: boolean;
  active: boolean;
  plannedDate: string;
  originalPlannedDate: string;
  carried: boolean;
};

export type WorkerReportedExtra = {
  id: string;
  key: string;
  title: string;
  effectiveAt: string;
};

export function chicagoDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ELM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not resolve Elm Farm local date.");
  }

  return `${year}-${month}-${day}`;
}

export function formatElmDay(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  const localNoonUtc = new Date(Date.UTC(year, month - 1, day, 12));

  return new Intl.DateTimeFormat("en-US", {
    timeZone: ELM_TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(localNoonUtc);
}

export async function getAnnaWorkerDelivery(now = new Date()) {
  const today = chicagoDateString(now);
  const supabase = createAtlasAdminClient();

  const { data: projectionData, error: projectionError } = await supabase
    .from("worker_week_projection")
    .select(
      "id,planned_date,original_planned_date,title,plan_order,plan_state,rollover_policy,delivery_key,delivery_payload",
    )
    .eq("farm_id", ELM_FARM_ID)
    .eq("membership_id", ANNA_FARM_MEMBERSHIP_ID)
    .lte("planned_date", today)
    .order("planned_date", { ascending: true })
    .order("plan_order", { ascending: true });

  if (projectionError) {
    throw new Error(`Could not load Anna worker projection: ${projectionError.message}`);
  }

  const projections = (projectionData ?? []) as ProjectionRow[];
  const eligible = projections.filter((row) => {
    if (row.planned_date === today) return true;
    return row.planned_date < today && row.rollover_policy === "carry";
  });

  const projectionIds = eligible.map((row) => row.id);

  let sources: ProjectionSourceRow[] = [];
  if (projectionIds.length > 0) {
    const { data: sourceData, error: sourceError } = await supabase
      .from("worker_week_projection_sources")
      .select("projection_id,work_item_id,source_role")
      .in("projection_id", projectionIds);

    if (sourceError) {
      throw new Error(`Could not load worker projection sources: ${sourceError.message}`);
    }

    sources = (sourceData ?? []) as ProjectionSourceRow[];
  }

  const workItemIds = [...new Set(sources.map((row) => row.work_item_id))];
  const workStateById = new Map<string, WorkItemRow["work_state"]>();

  if (workItemIds.length > 0) {
    const { data: workData, error: workError } = await supabase
      .from("work_items")
      .select("id,work_state")
      .in("id", workItemIds);

    if (workError) {
      throw new Error(`Could not load worker source work: ${workError.message}`);
    }

    for (const workItem of (workData ?? []) as WorkItemRow[]) {
      workStateById.set(workItem.id, workItem.work_state);
    }
  }

  const { data: pilotEventData, error: pilotEventError } = await supabase
    .from("worker_delivery_pilot_events")
    .select("id,event_seq,projection_id,event_kind,effective_at,reported_title")
    .eq("membership_id", ANNA_FARM_MEMBERSHIP_ID)
    .order("event_seq", { ascending: true });

  if (pilotEventError) {
    throw new Error(`Could not load Anna Worker Day pilot events: ${pilotEventError.message}`);
  }

  const pilotEvents = (pilotEventData ?? []) as PilotEventRow[];
  const completionStateByProjection = new Map<string, PilotEventRow["event_kind"]>();

  for (const event of pilotEvents) {
    if (
      event.projection_id &&
      (event.event_kind === "done_reported" ||
        event.event_kind === "completion_reopened")
    ) {
      completionStateByProjection.set(event.projection_id, event.event_kind);
    }
  }

  const { data: activeData, error: activeError } = await supabase
    .from("worker_delivery_pilot_active_attention")
    .select("projection_id")
    .eq("membership_id", ANNA_FARM_MEMBERSHIP_ID)
    .maybeSingle();

  if (activeError) {
    throw new Error(`Could not load Anna active Worker Day attention: ${activeError.message}`);
  }

  const activeProjectionId =
    activeData && typeof activeData.projection_id === "string"
      ? activeData.projection_id
      : null;

  const items = eligible.flatMap<WorkerDeliveryItem>((row) => {
    const rowSources = sources.filter((source) => source.projection_id === row.id);
    const required = rowSources.filter((source) => source.source_role === "required");

    const requiredStates = required.map((source) => workStateById.get(source.work_item_id));
    const institutionallyCompleted =
      required.length > 0 &&
      requiredStates.every((state) => state === "completed");
    const noLongerDeliverable =
      required.length > 0 &&
      requiredStates.every((state) => state === "cancelled" || state === "superseded");
    const reportedCompleted =
      completionStateByProjection.get(row.id) === "done_reported";
    const completed = institutionallyCompleted || reportedCompleted;

    if (row.planned_date < today && (completed || noLongerDeliverable)) {
      return [];
    }

    if (row.planned_date === today && noLongerDeliverable) {
      return [];
    }

    return [
      {
        id: row.id,
        key: row.delivery_key ?? row.id,
        title: row.title,
        details: Array.isArray(row.delivery_payload?.details)
          ? row.delivery_payload.details.filter(
              (detail): detail is string => typeof detail === "string",
            )
          : [],
        completed,
        institutionallyCompleted,
        reportedCompleted,
        active: !completed && activeProjectionId === row.id,
        plannedDate: row.planned_date,
        originalPlannedDate: row.original_planned_date ?? row.planned_date,
        carried: row.planned_date < today,
      },
    ];
  });

  const extras: WorkerReportedExtra[] = pilotEvents.flatMap((event) => {
    if (
      event.event_kind !== "unscheduled_work_reported" ||
      !event.reported_title ||
      chicagoDateString(new Date(event.effective_at)) !== today
    ) {
      return [];
    }

    return [
      {
        id: event.id,
        key: `pilot-extra-${event.id}`,
        title: event.reported_title,
        effectiveAt: event.effective_at,
      },
    ];
  });

  return { date: today, items, extras };
}
