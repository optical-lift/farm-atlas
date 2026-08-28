import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import type { AtlasBedComponentState, AtlasBedMap, AtlasBedMapFeature, AtlasCropOccupancyCohort, AtlasWeedBedTrailEvent } from "@/lib/atlas/weed-card-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function metadataText(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return text((metadata as Record<string, unknown>)[key]);
}

function explicitMainCropLabel(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const row = metadata as Record<string, unknown>;
  // Only explicit canonical object metadata is allowed to answer a true primary-crop bed.
  // Mixed perennial/hospitality beds use a community summary instead.
  for (const key of ["main_crop_label", "active_crop_label"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function componentsFromState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as AtlasBedComponentState[];
  const components = (value as { components?: unknown }).components;
  return Array.isArray(components) ? components as AtlasBedComponentState[] : [];
}

function mapFeatures(components: AtlasBedComponentState[]) {
  return components.map((component): AtlasBedMapFeature => ({
    featureId: component.componentId,
    featureKey: component.componentKey,
    featureLabel: component.componentLabel,
    featureKind: component.componentKind,
    mapSide: component.mapSide ?? null,
    occupancyGroups: component.occupancyGroups,
  }));
}

function occupancyCohorts(card: Record<string, unknown>) {
  const groups = Array.isArray(card.occupancyGroups) ? card.occupancyGroups : [];
  return groups.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    const cohorts = (group as { cohorts?: unknown }).cohorts;
    return Array.isArray(cohorts) ? cohorts as AtlasCropOccupancyCohort[] : [];
  });
}

function perennialCohorts(card: Record<string, unknown>) {
  return occupancyCohorts(card).filter((cohort) => (cohort.lifeCycle || "").toLowerCase().includes("perennial"));
}

function communityCategory(card: Record<string, unknown>) {
  const stored = text(card.bedUseCategory);
  if (stored && stored.toLowerCase() !== "unclassified") return stored;
  return perennialCohorts(card).length >= 2 ? "Perennial mix" : stored || "unclassified";
}

function communitySummary(card: Record<string, unknown>, bedUseCategory: string) {
  const category = bedUseCategory.toLowerCase();
  const perennials = perennialCohorts(card);
  const communityBed = category.includes("hospitality")
    || category.includes("perennial")
    || category.includes("ornamental")
    || category.includes("mixed");
  if (!communityBed || !perennials.length) return null;

  const labels = Array.from(new Set(perennials.map((cohort) => text(cohort.displayLabel)).filter(Boolean)));
  const visible = labels.slice(0, 4);
  const remainder = labels.length - visible.length;
  return `${labels.length} perennial ${labels.length === 1 ? "planting" : "plantings"} · ${visible.join(" · ")}${remainder > 0 ? ` + ${remainder} more` : ""}`;
}

function dependencyIds(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return stringList((metadata as Record<string, unknown>).dependent_task_ids);
}

function dependencyLabels(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return stringList((metadata as Record<string, unknown>).dependent_task_labels);
}

function fallbackDependencyTrail(taskId: string, dueDate: string | null, labels: string[]): AtlasWeedBedTrailEvent[] {
  return labels.map((title, index) => ({
    taskId: `${taskId}:next:${index}`,
    eventKind: "Next",
    cropCycleId: null,
    cropLabel: null,
    title,
    lifeCycle: null,
    eventDate: dueDate || "",
  }));
}

function trailEvents(value: unknown) {
  return Array.isArray(value) ? value as AtlasWeedBedTrailEvent[] : [];
}

function latestTrailEvent(value: unknown) {
  const events = trailEvents(value);
  if (!events.length) return null;

  let latest = events[0];
  let latestIndex = 0;
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    const latestDate = text(latest.eventDate);
    const eventDate = text(event.eventDate);
    if (eventDate > latestDate || (eventDate === latestDate && index > latestIndex)) {
      latest = event;
      latestIndex = index;
    }
  }
  return latest;
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return atlasApiError(400, "weed_card_task_required", "A task is required.");

  const supabase = await createAtlasServerClient();
  const [{ data, error }, taskResult] = await Promise.all([
    supabase.rpc("weed_card_task_focus_v1", { p_task_id: taskId }),
    supabase.from("tasks").select("id,title,due_date,metadata").eq("id", taskId).maybeSingle(),
  ]);
  if (error?.code === "42501") return atlasApiError(403, "weed_card_forbidden", "This Weed Card is not available to the signed-in farm member.");
  if (error?.code === "P0002") return atlasApiError(404, "weed_card_not_found", "The Weed Card was not found.");
  if (error) return atlasApiError(500, "weed_card_read_failed", "Atlas could not load the Weed Card.");
  if (!data || typeof data !== "object" || Array.isArray(data)) return atlasApiError(404, "weed_card_not_found", "The Weed Card was not found.");

  const card = data as Record<string, unknown>;
  const objectId = typeof card.objectId === "string" ? card.objectId : "";
  let bedMap: unknown = null;
  let mainCropLabel: string | null = null;
  let components: AtlasBedComponentState[] = [];
  const bedUseCategory = communityCategory(card);
  const communityLabel = communitySummary(card, bedUseCategory);

  if (objectId) {
    const [mapResult, objectResult, componentResult] = await Promise.all([
      supabase.rpc("object_crop_bed_map_v1", { p_object_id: objectId }),
      supabase.from("growing_objects").select("metadata").eq("id", objectId).maybeSingle(),
      supabase.rpc("bed_components_state_v1", { p_bed_id: objectId }),
    ]);
    if (!componentResult.error) components = componentsFromState(componentResult.data);
    if (!mapResult.error && mapResult.data && typeof mapResult.data === "object" && !Array.isArray(mapResult.data)) {
      bedMap = { ...(mapResult.data as AtlasBedMap), features: mapFeatures(components) };
    }
    if (!objectResult.error) mainCropLabel = explicitMainCropLabel(objectResult.data?.metadata);
  }

  // Keep the rail centered on the worker's actual place in the bed workflow:
  // one completed move behind, the move in hand, and at most two moves/unlocks ahead.
  let dependencyTrail: AtlasWeedBedTrailEvent[] = [];
  let workflowTrail: AtlasWeedBedTrailEvent[] = [];
  const taskRow = !taskResult.error ? taskResult.data : null;
  if (taskRow) {
    const ids = dependencyIds(taskRow.metadata);
    const labels = dependencyLabels(taskRow.metadata);
    if (ids.length) {
      const dependentResult = await supabase
        .from("tasks")
        .select("id,title,due_date,metadata")
        .in("id", ids);
      if (!dependentResult.error && dependentResult.data?.length) {
        const byId = new Map(dependentResult.data.map((row) => [row.id, row] as const));
        dependencyTrail = ids.flatMap((id) => {
          const row = byId.get(id);
          if (!row) return [];
          const action = metadataText(row.metadata, "display_action") || "Next";
          const subject = metadataText(row.metadata, "display_subject") || null;
          return [{
            taskId: row.id,
            eventKind: `Next · ${action}`,
            cropCycleId: null,
            cropLabel: subject,
            title: row.title,
            lifeCycle: null,
            eventDate: row.due_date || taskRow.due_date || "",
          } satisfies AtlasWeedBedTrailEvent];
        });
      }
    }
    if (!dependencyTrail.length && labels.length) {
      dependencyTrail = fallbackDependencyTrail(taskId, taskRow.due_date, labels);
    }

    const lastMove = latestTrailEvent(card.bedTrail);
    const currentAction = metadataText(taskRow.metadata, "display_action") || "Weed";
    const currentSubject = metadataText(taskRow.metadata, "display_subject")
      || taskRow.title.replace(/^Weed\s*[·-]?\s*/i, "").trim()
      || null;
    const currentMove: AtlasWeedBedTrailEvent = {
      taskId: taskRow.id,
      eventKind: `Now · ${currentAction}`,
      cropCycleId: null,
      cropLabel: currentSubject,
      title: taskRow.title,
      lifeCycle: null,
      eventDate: taskRow.due_date || "",
    };

    workflowTrail = [
      ...(lastMove ? [{ ...lastMove, eventKind: `Last · ${lastMove.eventKind}` }] : []),
      currentMove,
      ...dependencyTrail.slice(0, 2),
    ];
  }

  return privateJson({
    ok: true,
    card: {
      ...card,
      bedUseCategory,
      mainCropLabel: mainCropLabel || communityLabel,
      bedTrail: workflowTrail.length ? workflowTrail : card.bedTrail,
      components,
      bedMap,
    },
  });
}
