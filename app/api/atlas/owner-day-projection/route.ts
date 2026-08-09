import { NextResponse } from "next/server";

import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CandidateKind = "project_pull" | "floating_task" | "queue" | "rhythm";
type CandidateWindow = "morning" | "afternoon" | "evening";
type CandidateAnchor = "top" | "morning" | "midday" | "visibility" | "evening" | "bottom";

type ScheduleCandidate = {
  id: string;
  sourceKind: CandidateKind;
  sourceId: string;
  title: string;
  note: string | null;
  environment: string | null;
  location: string | null;
  expectedActiveMinutes: number;
  approved: boolean;
  conditional: boolean;
  fitsWithinCurrentRemaining: boolean;
  recommended: boolean;
  reason: string | null;
  dayWindow: CandidateWindow;
  workOrderNumber: number;
};

type ProjectOption = {
  projectItemId?: string;
  title?: string;
  note?: string | null;
  expectedActiveMinutes?: number | string | null;
  environment?: string | null;
  fitsToday?: boolean;
};

type FloatingCandidate = {
  task_id?: string;
  title?: string;
  expected_active_minutes?: number | string | null;
  environment?: string | null;
  effective_obligation_class?: string | null;
};

type QueueRow = {
  id: string;
  position: number;
  state: string;
  task_id: string | null;
  planned_occurrence_id: string | null;
  metadata: Record<string, unknown> | null;
};

type OccurrenceRow = {
  id: string;
  title: string | null;
  state: string;
  planned_due_date: string | null;
  task_payload: Record<string, unknown> | null;
  effort_units: number | string | null;
};

type PlacementTaskRow = {
  id: string;
  metadata: Record<string, unknown> | null;
  task_type: string | null;
  action_key: string | null;
};

type ProjectItemPlacementRow = {
  id: string;
  source_task_id: string | null;
  location_text: string | null;
  metadata: Record<string, unknown> | null;
};

const anchorOrder: Record<CandidateAnchor, number> = {
  top: 10000,
  morning: 22000,
  midday: 42000,
  visibility: 60000,
  evening: 76000,
  bottom: 99000,
};

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isSunday(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay() === 0;
}

function nextWorkday(afterDate: string) {
  let next = addDaysIso(afterDate, 1);
  while (isSunday(next)) next = addDaysIso(next, 1);
  return next;
}

function normalizeWorkday(dateIso: string) {
  return isSunday(dateIso) ? addDaysIso(dateIso, 1) : dateIso;
}

function laterDate(a: string, b: string) {
  return a >= b ? a : b;
}

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function token(value: unknown) {
  return textValue(value).toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function metadataText(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = textValue(metadata[key]);
    if (value) return value;
  }
  return "";
}

function metadataNumber(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if ((typeof value === "number" || typeof value === "string") && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function candidateAnchor(metadata: Record<string, unknown>, actionKey?: unknown, taskType?: unknown): CandidateAnchor {
  const raw = token(metadata.work_order_anchor)
    || token(metadata.day_flow_mode)
    || token(metadata.day_work_order_mode)
    || token(metadata.work_order_mode);
  const label = `${token(metadata.day_work_order_label)} ${token(metadata.work_order_label)} ${token(metadata.work_order_bucket)}`;

  if (raw === "bottom" || raw === "last" || raw === "last_thing" || label.includes("last_thing")) return "bottom";
  if (raw === "evening" || raw === "lower" || label.includes("evening")) return "evening";
  if (raw === "visibility" || raw === "visibility_prep" || raw === "anchored" || label.includes("visibility")) return "visibility";
  if (raw === "midday" || raw === "midday_flex" || label.includes("midday")) return "midday";
  if (raw === "morning" || raw === "upper" || label.includes("morning")) return "morning";
  if (raw === "top" || raw === "first" || label.includes("top_of_list")) return "top";

  const action = token(actionKey);
  const task = token(taskType);
  const rhythm = token(metadata.work_rhythm);
  const category = token(metadata.work_category_key);
  const collection = token(metadata.work_collection_key);
  const route = token(metadata.work_route);

  if (route === "mow" || action === "mow" || collection === "mowing") return "bottom";
  if (route === "plant" || action === "plant" || action === "transplant") return "evening";
  if (["signage_safety", "hospitality", "guest_readiness", "venue_reset"].includes(category)) return "visibility";
  if (route === "seed" || action === "sow" || action === "seed" || rhythm === "seed_sowing") return "midday";
  if (route === "weed" || action === "weed" || collection === "weeding") return "morning";
  if (route === "harvest" || action === "harvest" || task === "postharvest") return "morning";
  if (route === "water" || action === "water" || task === "grow_room_care" || task === "germination_check") return "top";
  return "midday";
}

function candidatePlacement(metadata: Record<string, unknown>, actionKey?: unknown, taskType?: unknown, locationFallback?: string | null) {
  const anchor = candidateAnchor(metadata, actionKey, taskType);
  const explicit = metadataNumber(metadata, "day_work_order", "work_order", "day_order_override", "run_sheet_order");
  const dayOrder = metadataNumber(metadata, "day_order") ?? 0;
  const workOrderNumber = explicit ?? anchorOrder[anchor] + Math.min(Math.max(dayOrder, 0), 999);
  const dayWindow: CandidateWindow = anchor === "top" || anchor === "morning"
    ? "morning"
    : anchor === "midday" || anchor === "visibility"
      ? "afternoon"
      : "evening";
  const location = metadataText(metadata, "display_location", "collection_zone", "collection_label") || locationFallback || null;
  return { dayWindow, workOrderNumber, location };
}

function estimatedQueueMinutes(occurrence: OccurrenceRow) {
  const payload = recordValue(occurrence.task_payload);
  const metadata = recordValue(payload.metadata);
  const explicit = numberValue(metadata.estimated_minutes);
  if (explicit > 0) return Math.round(explicit);
  const effort = numberValue(occurrence.effort_units || payload.effort_units || metadata.effort_units);
  if (effort > 0) return Math.max(20, Math.round(effort * 15));
  return 30;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "owner-worker-day-schedule-builder-v2",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  if (!validDateIso(requestedDate)) {
    return privateJson({ ok: false, error: "date must be a valid YYYY-MM-DD date." }, 400);
  }

  const dateIso = requestedDate as string;
  const today = centralDateIso();
  if (dateIso < today) return privateJson({ ok: true, active: false, date: dateIso, candidates: [] });

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const effectiveMembershipId = effectiveOperatorMembershipId(operatorContext);
    const effective = operatorContext?.effective ?? null;

    if (
      !operatorContext?.isOperating
      || !effectiveMembershipId
      || !effective?.farmId
      || effective.farmRole !== "farm_hand"
    ) {
      return privateJson({ ok: true, active: false, date: dateIso, candidates: [] });
    }

    const supabase = await createAtlasServerClient();
    const projectRead = await supabase
      .from("projects")
      .select("id,title")
      .eq("farm_id", effective.farmId)
      .eq("stable_key", "elm_finish_renovation_pool")
      .eq("status", "active")
      .maybeSingle();
    if (projectRead.error) throw new Error(projectRead.error.message);

    let projectOptions: ProjectOption[] = [];
    let paidTargetMinutes = 420;
    let scheduledPaidMinutes = 0;

    if (projectRead.data?.id) {
      const optionRead = await supabase.rpc("project_pull_options_for_member_v2", {
        p_project_id: projectRead.data.id,
        p_membership_id: effectiveMembershipId,
        p_day: dateIso,
        p_limit: 24,
      });
      if (optionRead.error) throw new Error(optionRead.error.message);
      const payload = recordValue(optionRead.data);
      const capacity = recordValue(payload.capacity);
      projectOptions = Array.isArray(payload.options) ? payload.options as ProjectOption[] : [];
      paidTargetMinutes = numberValue(capacity.regularTargetMinutes) || 420;
      scheduledPaidMinutes = numberValue(capacity.alreadyPresentedRegularMinutes);
    }

    const floatingRead = await supabase.rpc("owner_worker_day_floating_candidates_v1", {
      p_farm_id: effective.farmId,
      p_membership_id: effectiveMembershipId,
      p_day: dateIso,
    });
    if (floatingRead.error) throw new Error(floatingRead.error.message);
    const floatingRows = Array.isArray(floatingRead.data) ? floatingRead.data as FloatingCandidate[] : [];

    const projectOptionIds = projectOptions
      .map((option) => textValue(option.projectItemId))
      .filter(Boolean);
    const projectItemRead = projectOptionIds.length
      ? await supabase
          .from("project_pull_items")
          .select("id,source_task_id,location_text,metadata")
          .in("id", projectOptionIds)
      : { data: [], error: null };
    const projectItemRows = projectItemRead.error ? [] : (projectItemRead.data ?? []) as ProjectItemPlacementRow[];
    const projectItemById = new Map(projectItemRows.map((row) => [row.id, row] as const));

    const placementTaskIds = Array.from(new Set([
      ...projectItemRows.map((row) => row.source_task_id).filter((value): value is string => Boolean(value)),
      ...floatingRows.map((row) => textValue(row.task_id)).filter(Boolean),
    ]));
    const placementTaskRead = placementTaskIds.length
      ? await supabase
          .from("tasks")
          .select("id,metadata,task_type,action_key")
          .in("id", placementTaskIds)
      : { data: [], error: null };
    const placementTasks = new Map(
      (placementTaskRead.error ? [] : (placementTaskRead.data ?? []) as PlacementTaskRow[])
        .map((row) => [row.id, row] as const),
    );

    const queueRead = await supabase
      .from("task_release_queue_items")
      .select("id,position,state,task_id,planned_occurrence_id,metadata")
      .eq("farm_id", effective.farmId)
      .eq("queue_key", "anna_weeding_rotation")
      .in("state", ["active", "queued"])
      .order("position", { ascending: true });
    if (queueRead.error) throw new Error(queueRead.error.message);
    const queueRows = (queueRead.data ?? []) as QueueRow[];

    const occurrenceIds = queueRows
      .map((row) => row.planned_occurrence_id)
      .filter((value): value is string => Boolean(value));
    const occurrenceRead = occurrenceIds.length
      ? await supabase
          .from("planned_work_occurrences")
          .select("id,title,state,planned_due_date,task_payload,effort_units")
          .in("id", occurrenceIds)
      : { data: [], error: null };
    if (occurrenceRead.error) throw new Error(occurrenceRead.error.message);
    const occurrences = new Map(
      ((occurrenceRead.data ?? []) as OccurrenceRow[]).map((row) => [row.id, row] as const),
    );

    const validQueue = queueRows
      .map((row) => ({ row, occurrence: row.planned_occurrence_id ? occurrences.get(row.planned_occurrence_id) : undefined }))
      .filter((entry): entry is { row: QueueRow; occurrence: OccurrenceRow } => Boolean(
        entry.occurrence && !["cancelled", "completed"].includes(entry.occurrence.state),
      ));

    let cursor = today;
    let predecessorTitle: string | null = null;
    const weedCandidates: ScheduleCandidate[] = [];
    let approvedConditionalMinutes = 0;

    for (const entry of validQueue) {
      const { row, occurrence } = entry;
      const metadata = recordValue(row.metadata);
      const approvedDateRaw = textValue(metadata.owner_schedule_approved_date);
      const approvedDate = validDateIso(approvedDateRaw) ? approvedDateRaw : null;
      const title = occurrence.title || "Weed Card";

      if (row.state === "active") {
        if (occurrence.planned_due_date && occurrence.planned_due_date > cursor) {
          cursor = normalizeWorkday(occurrence.planned_due_date);
        }
        predecessorTitle = title;
        continue;
      }

      let projectedDate = nextWorkday(cursor);
      if (approvedDate) projectedDate = normalizeWorkday(laterDate(projectedDate, approvedDate));
      const minutes = estimatedQueueMinutes(occurrence);
      const approved = Boolean(approvedDate);
      const belongsToRequestedDay = projectedDate === dateIso || approvedDate === dateIso;

      if (approvedDate === dateIso) approvedConditionalMinutes += minutes;

      if (belongsToRequestedDay) {
        const payload = recordValue(occurrence.task_payload);
        const payloadMetadata = recordValue(payload.metadata);
        const placement = candidatePlacement(payloadMetadata, payload.action_key, payload.task_type);
        weedCandidates.push({
          id: `queue:${row.id}`,
          sourceKind: "queue",
          sourceId: row.id,
          title,
          note: textValue(payload.note) || null,
          environment: "outdoor",
          location: placement.location,
          expectedActiveMinutes: minutes,
          approved,
          conditional: true,
          fitsWithinCurrentRemaining: false,
          recommended: true,
          reason: predecessorTitle
            ? `Releases only after ${predecessorTitle} is finished${projectedDate !== dateIso ? `; current projection is ${projectedDate}` : ""}.`
            : "Releases only when the Weed Card ahead of it is finished.",
          dayWindow: placement.dayWindow,
          workOrderNumber: placement.workOrderNumber,
        });
      }

      cursor = projectedDate;
      predecessorTitle = title;
    }

    const committedPaidMinutes = scheduledPaidMinutes + approvedConditionalMinutes;
    const remainingPaidMinutes = Math.max(0, paidTargetMinutes - committedPaidMinutes);

    const projectCandidates: ScheduleCandidate[] = projectOptions.map((option) => {
      const sourceId = textValue(option.projectItemId);
      const item = sourceId ? projectItemById.get(sourceId) : undefined;
      const sourceTask = item?.source_task_id ? placementTasks.get(item.source_task_id) : undefined;
      const metadata = recordValue(sourceTask?.metadata ?? item?.metadata);
      const placement = candidatePlacement(metadata, sourceTask?.action_key, sourceTask?.task_type, item?.location_text ?? null);
      const minutes = Math.max(0, numberValue(option.expectedActiveMinutes));
      return {
        id: `project:${sourceId}`,
        sourceKind: "project_pull" as const,
        sourceId,
        title: option.title || "Finish Elm work",
        note: option.note || null,
        environment: option.environment || null,
        location: placement.location,
        expectedActiveMinutes: minutes,
        approved: false,
        conditional: false,
        fitsWithinCurrentRemaining: Boolean(option.fitsToday) && minutes <= remainingPaidMinutes,
        recommended: Boolean(option.fitsToday),
        reason: "Available Finish Elm work that is ready for Anna.",
        dayWindow: placement.dayWindow,
        workOrderNumber: placement.workOrderNumber,
      };
    }).filter((candidate) => Boolean(candidate.sourceId));

    const floatingCandidates: ScheduleCandidate[] = floatingRows.map((row) => {
      const sourceId = textValue(row.task_id);
      const task = sourceId ? placementTasks.get(sourceId) : undefined;
      const placement = candidatePlacement(recordValue(task?.metadata), task?.action_key, task?.task_type);
      const minutes = Math.max(0, numberValue(row.expected_active_minutes));
      const obligation = textValue(row.effective_obligation_class).replaceAll("_", " ");
      return {
        id: `floating:${sourceId}`,
        sourceKind: "floating_task" as const,
        sourceId,
        title: row.title || "Atlas paid work",
        note: null,
        environment: row.environment || null,
        location: placement.location,
        expectedActiveMinutes: minutes,
        approved: false,
        conditional: false,
        fitsWithinCurrentRemaining: minutes <= remainingPaidMinutes,
        recommended: true,
        reason: obligation ? `Eligible ${obligation} from Atlas's paid-work reservoir.` : "Eligible paid work from Atlas's reservoir.",
        dayWindow: placement.dayWindow,
        workOrderNumber: placement.workOrderNumber,
      };
    }).filter((candidate) => Boolean(candidate.sourceId));

    const candidates = [
      ...weedCandidates.map((candidate) => ({
        ...candidate,
        fitsWithinCurrentRemaining: candidate.approved || candidate.expectedActiveMinutes <= remainingPaidMinutes,
      })),
      ...floatingCandidates,
      ...projectCandidates,
    ].sort((left, right) => {
      const windowOrder: Record<CandidateWindow, number> = { morning: 0, afternoon: 1, evening: 2 };
      const windowDifference = windowOrder[left.dayWindow] - windowOrder[right.dayWindow];
      if (windowDifference) return windowDifference;
      if (left.workOrderNumber !== right.workOrderNumber) return left.workOrderNumber - right.workOrderNumber;
      return left.title.localeCompare(right.title);
    });

    return privateJson({
      ok: true,
      active: true,
      date: dateIso,
      operatorLabel: effective.displayName,
      paidTargetMinutes,
      scheduledPaidMinutes,
      approvedConditionalMinutes,
      committedPaidMinutes,
      remainingPaidMinutes,
      candidates,
    });
  } catch (error) {
    console.error("Atlas owner worker-day schedule ideas failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load the schedule ideas for this day." }, 500);
  }
}
