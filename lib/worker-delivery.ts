import "server-only";

import { createAtlasAdminClient } from "@/lib/supabase/admin";

const ELM_FARM_ID = "6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f";
const ANNA_FARM_MEMBERSHIP_ID = "23e98e5e-16ca-40d8-872c-c77e06baa167";
const ELM_TIME_ZONE = "America/Chicago";

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

export type WorkerDeliveryItem = {
  id: string;
  key: string;
  title: string;
  details: string[];
  completed: boolean;
  plannedDate: string;
  originalPlannedDate: string;
  carried: boolean;
};

function chicagoDateString(now = new Date()) {
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

  if (eligible.length === 0) {
    return { date: today, items: [] as WorkerDeliveryItem[] };
  }

  const projectionIds = eligible.map((row) => row.id);
  const { data: sourceData, error: sourceError } = await supabase
    .from("worker_week_projection_sources")
    .select("projection_id,work_item_id,source_role")
    .in("projection_id", projectionIds);

  if (sourceError) {
    throw new Error(`Could not load worker projection sources: ${sourceError.message}`);
  }

  const sources = (sourceData ?? []) as ProjectionSourceRow[];
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

  const items = eligible.flatMap<WorkerDeliveryItem>((row) => {
    const rowSources = sources.filter((source) => source.projection_id === row.id);
    const required = rowSources.filter((source) => source.source_role === "required");

    const requiredStates = required.map((source) => workStateById.get(source.work_item_id));
    const completed = required.length > 0 && requiredStates.every((state) => state === "completed");
    const noLongerDeliverable =
      required.length > 0 &&
      requiredStates.every((state) => state === "cancelled" || state === "superseded");

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
          ? row.delivery_payload.details.filter((detail): detail is string => typeof detail === "string")
          : [],
        completed,
        plannedDate: row.planned_date,
        originalPlannedDate: row.original_planned_date ?? row.planned_date,
        carried: row.planned_date < today,
      },
    ];
  });

  return { date: today, items };
}
