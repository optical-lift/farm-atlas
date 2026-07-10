import { atlasSupabase } from "@/lib/atlas/supabase-server";

export type AtlasTriggerTaskRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  blocker_text: string | null;
  note: string | null;
  generated_from?: string | null;
  generated_from_id?: string | null;
  metadata: Record<string, unknown> | null;
};

type ObjectRow = {
  id: string;
  stable_key: string;
  label: string;
  zone_id: string | null;
  length_ft: number | string | null;
  width_ft: number | string | null;
};

type CropProfileRow = {
  id: string;
  stable_key: string;
  crop_label: string;
  variety: string | null;
  crop_family: string | null;
  default_planting_method: string | null;
  days_to_germination_min: number | null;
  days_to_germination_max: number | null;
  days_to_harvest_watch_min: number | null;
  days_to_harvest_watch_max: number | null;
  rows_per_3ft_bed: number | string | null;
  in_row_spacing_in: number | string | null;
  expected_stems_per_plant: number | string | null;
  metadata: Record<string, unknown> | null;
};

type FollowupPlanItem = {
  offset_days?: unknown;
  title?: unknown;
  task_type?: unknown;
  display_action?: unknown;
  display_subject?: unknown;
  display_detail?: unknown;
  note?: unknown;
};

type CropCycleResult = {
  cropCycleId: string;
  cropCycleKey: string;
  plantingClaimId: string | null;
  objectId: string;
  objectLabel: string;
  cropProfileStableKey: string;
  cropLabel: string;
  variety: string | null;
};

export type AtlasTriggeredSequenceResult = {
  cropCycleIds: string[];
  plantingClaimIds: string[];
  objectActivityEventIds: string[];
  followupTaskIds: string[];
};

const emptyResult: AtlasTriggeredSequenceResult = {
  cropCycleIds: [],
  plantingClaimIds: [],
  objectActivityEventIds: [],
  followupTaskIds: [],
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boolish(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function positiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function objectArray(value: unknown): FollowupPlanItem[] {
  return Array.isArray(value) ? value.filter((item): item is FollowupPlanItem => Boolean(item && typeof item === "object")) : [];
}

function addDaysIso(anchorIso: string, days: number) {
  const date = new Date(`${anchorIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function ymd(dateIso: string) {
  return dateIso.replaceAll("-", "");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function dateOrNull(anchorIso: string, offset: number | null | undefined) {
  return offset ? addDaysIso(anchorIso, offset) : null;
}

function plantingMethod(profile: CropProfileRow) {
  return clean(profile.default_planting_method) || "direct_sow";
}

function isSowingOrPlantingTask(task: AtlasTriggerTaskRow) {
  const text = `${task.task_type ?? ""} ${task.title}`.toLowerCase();
  return text.includes("seed") || text.includes("sow") || text.includes("plant");
}

function cropProfileKeysForTask(task: AtlasTriggerTaskRow) {
  const metadata = task.metadata ?? {};
  return Array.from(new Set([
    clean(metadata.crop_profile_stable_key),
    ...stringArray(metadata.mixed_crop_profile_stable_keys),
  ].filter(Boolean)));
}

function cropProfileIdsForTask(task: AtlasTriggerTaskRow) {
  const metadata = task.metadata ?? {};
  return Array.from(new Set([
    clean(metadata.crop_profile_id),
    ...stringArray(metadata.mixed_crop_profile_ids),
  ].filter(Boolean)));
}

function followupPlanFromTask(task: AtlasTriggerTaskRow) {
  const metadata = task.metadata ?? {};
  if (!boolish(metadata.generate_followups_on_done)) return [];
  return objectArray(metadata.followup_plan)
    .map((item) => ({ ...item, offset_days: positiveInteger(item.offset_days) }))
    .filter((item): item is FollowupPlanItem & { offset_days: number } => Boolean(item.offset_days));
}

function cropFollowupPlan(profile: CropProfileRow) {
  const template = profile.metadata?.crop_cycle_template;
  if (!template || typeof template !== "object") return [];
  const followups = (template as { followups?: unknown }).followups;
  return objectArray(followups)
    .map((item) => ({ ...item, offset_days: positiveInteger(item.offset_days) }))
    .filter((item): item is FollowupPlanItem & { offset_days: number } => Boolean(item.offset_days));
}

async function fetchTaskObjects(objectIds: string[]) {
  if (objectIds.length === 0) return [];
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("growing_objects")
    .select("id, stable_key, label, zone_id, length_ft, width_ft")
    .in("id", objectIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as ObjectRow[];
}

async function fetchCropProfiles(keys: string[], ids: string[]) {
  const profiles: CropProfileRow[] = [];

  if (keys.length) {
    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("id, stable_key, crop_label, variety, crop_family, default_planting_method, days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max, rows_per_3ft_bed, in_row_spacing_in, expected_stems_per_plant, metadata")
      .in("stable_key", keys);
    if (error) throw new Error(error.message);
    profiles.push(...((data ?? []) as CropProfileRow[]));
  }

  if (ids.length) {
    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("id, stable_key, crop_label, variety, crop_family, default_planting_method, days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max, rows_per_3ft_bed, in_row_spacing_in, expected_stems_per_plant, metadata")
      .in("id", ids);
    if (error) throw new Error(error.message);
    profiles.push(...((data ?? []) as CropProfileRow[]));
  }

  const byId = new Map<string, CropProfileRow>();
  profiles.forEach((profile) => byId.set(profile.id, profile));
  return Array.from(byId.values());
}

async function taskExistsForFollowup(sourceTaskId: string, dueDate: string, followupTaskKey: string) {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, metadata")
    .eq("generated_from", "triggered_sequence")
    .eq("generated_from_id", sourceTaskId)
    .eq("due_date", dueDate)
    .neq("status", "archived");
  if (error) throw new Error(error.message);
  const existing = (data ?? []).find((row) => (row.metadata as Record<string, unknown> | null)?.followup_task_key === followupTaskKey);
  return existing?.id as string | undefined;
}

async function insertFollowupTask({
  task,
  dueDate,
  followupTaskKey,
  title,
  taskType,
  note,
  metadata,
  objectId,
}: {
  task: AtlasTriggerTaskRow;
  dueDate: string;
  followupTaskKey: string;
  title: string;
  taskType: string;
  note: string | null;
  metadata: Record<string, unknown>;
  objectId?: string | null;
}) {
  const existingId = await taskExistsForFollowup(task.id, dueDate, followupTaskKey);
  if (existingId) return existingId;

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .insert({
      farm_id: task.farm_id,
      zone_id: task.zone_id,
      title,
      task_type: taskType,
      status: "open",
      priority: task.priority ?? "normal",
      due_date: dueDate,
      note,
      generated_from: "triggered_sequence",
      generated_from_id: task.id,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message || "Triggered follow-up task creation failed.");

  if (objectId) {
    const { error: objectError } = await atlasSupabase
      .schema("atlas")
      .from("task_objects")
      .insert({ task_id: data.id as string, object_id: objectId, role: "primary_location" });
    if (objectError) throw new Error(objectError.message);
  }

  return data.id as string;
}

async function createCropCycleForObject({
  task,
  object,
  profile,
  anchorDate,
  note,
}: {
  task: AtlasTriggerTaskRow;
  object: ObjectRow;
  profile: CropProfileRow;
  anchorDate: string;
  note: string | null;
}): Promise<CropCycleResult> {
  const cropCycleKey = slug(`${object.stable_key}_${profile.stable_key}_${ymd(anchorDate)}`);

  const { data: existing, error: existingError } = await atlasSupabase
    .schema("atlas")
    .from("crop_cycles")
    .select("id, planting_claim_id")
    .eq("farm_id", task.farm_id)
    .eq("crop_cycle_key", cropCycleKey)
    .limit(1);
  if (existingError) throw new Error(existingError.message);

  if (existing?.[0]?.id) {
    return {
      cropCycleId: existing[0].id as string,
      cropCycleKey,
      plantingClaimId: existing[0].planting_claim_id as string | null,
      objectId: object.id,
      objectLabel: object.label,
      cropProfileStableKey: profile.stable_key,
      cropLabel: profile.crop_label,
      variety: profile.variety,
    };
  }

  const germMin = profile.days_to_germination_min;
  const germMax = profile.days_to_germination_max;
  const harvestMin = profile.days_to_harvest_watch_min;
  const harvestMax = profile.days_to_harvest_watch_max;
  const expectedGerminationStart = dateOrNull(anchorDate, germMin);
  const expectedGerminationEnd = dateOrNull(anchorDate, germMax);
  const expectedHarvestWatchStart = dateOrNull(anchorDate, harvestMin);
  const expectedHarvestWatchEnd = dateOrNull(anchorDate, harvestMax);
  const expectedClearDate = dateOrNull(anchorDate, harvestMax ? harvestMax + 10 : null);

  const { data: claim, error: claimError } = await atlasSupabase
    .schema("atlas")
    .from("planting_claims")
    .insert({
      farm_id: task.farm_id,
      crop_profile_id: profile.id,
      crop_label: profile.crop_label,
      variety: profile.variety,
      planted_date: anchorDate,
      planting_method: plantingMethod(profile),
      bed_length_ft: object.length_ft,
      bed_width_ft: object.width_ft,
      status: "planted",
      confidence: "high",
      expected_germination_start: expectedGerminationStart,
      expected_germination_end: expectedGerminationEnd,
      expected_harvest_watch_start: expectedHarvestWatchStart,
      expected_harvest_watch_end: expectedHarvestWatchEnd,
      expected_clear_date: expectedClearDate,
      note: note || `Created from completed task: ${task.title}`,
      metadata: {
        created_from: "triggered_task_sequence",
        source_task_id: task.id,
        crop_cycle_key: cropCycleKey,
        crop_profile_stable_key: profile.stable_key,
        object_id: object.id,
        object_key: object.stable_key,
        object_label: object.label,
        zone_registry_role: "current_crop_cycle",
      },
    })
    .select("id")
    .single();
  if (claimError || !claim?.id) throw new Error(claimError?.message || "Planting claim creation failed.");

  const plantingClaimId = claim.id as string;
  const { error: claimObjectError } = await atlasSupabase
    .schema("atlas")
    .from("planting_claim_objects")
    .insert({
      planting_claim_id: plantingClaimId,
      object_id: object.id,
      coverage_kind: "whole_object",
      coverage_amount: 1,
      coverage_unit: "bed",
    });
  if (claimObjectError) throw new Error(claimObjectError.message);

  const { data: cycle, error: cycleError } = await atlasSupabase
    .schema("atlas")
    .from("crop_cycles")
    .insert({
      farm_id: task.farm_id,
      object_id: object.id,
      planting_claim_id: plantingClaimId,
      crop_profile_id: profile.id,
      crop_cycle_key: cropCycleKey,
      crop_label: profile.crop_label,
      variety: profile.variety,
      cycle_state: "sown",
      lifecycle_status: "active",
      sown_date: anchorDate,
      planted_date: anchorDate,
      expected_germination_start: expectedGerminationStart,
      expected_germination_end: expectedGerminationEnd,
      expected_harvest_watch_start: expectedHarvestWatchStart,
      expected_harvest_watch_end: expectedHarvestWatchEnd,
      expected_clear_date: expectedClearDate,
      coverage_kind: "whole_object",
      coverage_amount: 1,
      coverage_unit: "bed",
      source_task_id: task.id,
      note: note || `Sown from completed task: ${task.title}`,
      metadata: {
        created_from: "triggered_task_sequence",
        trigger_anchor_date: anchorDate,
        source_task_id: task.id,
        crop_profile_stable_key: profile.stable_key,
        object_key: object.stable_key,
        object_label: object.label,
        zone_registry_role: "current_crop_cycle",
      },
    })
    .select("id")
    .single();
  if (cycleError || !cycle?.id) throw new Error(cycleError?.message || "Crop cycle creation failed.");

  const cropCycleId = cycle.id as string;
  const { data: activityEvent, error: activityError } = await atlasSupabase
    .schema("atlas")
    .from("object_activity_events")
    .insert({
      farm_id: task.farm_id,
      object_id: object.id,
      event_type: "sown",
      event_date: anchorDate,
      note: note || `${object.label} sown with ${profile.variety ? `${profile.variety} ` : ""}${profile.crop_label}.`,
      created_by: "atlas",
      source: "triggered_task_sequence",
      metadata: {
        task_id: task.id,
        planting_claim_id: plantingClaimId,
        crop_cycle_id: cropCycleId,
        crop_cycle_key: cropCycleKey,
        crop_profile_stable_key: profile.stable_key,
        crop_label: profile.crop_label,
        variety: profile.variety,
        zone_registry_role: "crop_cycle_event",
      },
    })
    .select("id")
    .single();
  if (activityError || !activityEvent?.id) throw new Error(activityError?.message || "Object activity event creation failed.");

  await atlasSupabase
    .schema("atlas")
    .from("crop_cycles")
    .update({ source_event_id: activityEvent.id as string, updated_at: new Date().toISOString() })
    .eq("id", cropCycleId);

  const objectMemory = {
    active_crop_cycle_id: cropCycleId,
    active_crop_cycle_key: cropCycleKey,
    active_crop_profile_stable_key: profile.stable_key,
    active_crop_label: profile.crop_label,
    active_crop_variety: profile.variety,
    active_crop_sown_date: anchorDate,
    expected_germination_start: expectedGerminationStart,
    expected_germination_end: expectedGerminationEnd,
    expected_harvest_watch_start: expectedHarvestWatchStart,
    expected_harvest_watch_end: expectedHarvestWatchEnd,
    expected_clear_date: expectedClearDate,
    zone_registry_role: "object_current_crop_cycle",
  };

  const { data: existingState } = await atlasSupabase
    .schema("atlas")
    .from("object_state")
    .select("metadata")
    .eq("object_id", object.id)
    .limit(1);
  const existingMetadata = (existingState?.[0]?.metadata ?? {}) as Record<string, unknown>;

  await atlasSupabase
    .schema("atlas")
    .from("object_state")
    .upsert({
      object_id: object.id,
      farm_id: task.farm_id,
      life_status: "planted",
      last_touched_at: anchorDate,
      last_checked_at: anchorDate,
      metadata: { ...existingMetadata, ...objectMemory },
      updated_at: new Date().toISOString(),
    }, { onConflict: "object_id" });

  await atlasSupabase
    .schema("atlas")
    .from("growing_objects")
    .update({
      metadata: {
        ...(object as unknown as { metadata?: Record<string, unknown> }).metadata,
        ...objectMemory,
        zone_registry_role: "bed_with_active_crop_cycle",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", object.id);

  return {
    cropCycleId,
    cropCycleKey,
    plantingClaimId,
    objectId: object.id,
    objectLabel: object.label,
    cropProfileStableKey: profile.stable_key,
    cropLabel: profile.crop_label,
    variety: profile.variety,
  };
}

async function generateTaskFollowups(task: AtlasTriggerTaskRow, anchorDate: string, note: string | null) {
  const plan = followupPlanFromTask(task);
  const metadata = task.metadata ?? {};
  const sequenceKey = clean(metadata.triggered_sequence_key) || clean(metadata.task_key) || slug(task.title);
  const createdIds: string[] = [];

  for (const item of plan) {
    const dueDate = addDaysIso(anchorDate, item.offset_days);
    const subject = clean(item.display_subject) || clean(item.title) || "Follow-up";
    const title = clean(item.title) || subject;
    const followupTaskKey = slug(`${sequenceKey}_${clean(item.task_type) || "followup"}_${item.offset_days}_${dueDate}`);
    const id = await insertFollowupTask({
      task,
      dueDate,
      followupTaskKey,
      title,
      taskType: clean(item.task_type) || "follow_up",
      note: clean(item.note) || note,
      metadata: {
        created_from: "triggered_task_sequence",
        followup_task_key: followupTaskKey,
        trigger_sequence_key: sequenceKey,
        trigger_source_task_id: task.id,
        trigger_anchor_date: anchorDate,
        trigger_offset_days: item.offset_days,
        display_action: clean(item.display_action) || "Follow up",
        display_subject: subject,
        display_detail: clean(item.display_detail) || clean(metadata.collection_label) || clean(metadata.display_detail) || task.title,
        collection_label: clean(metadata.collection_label) || clean(metadata.triggered_sequence_label) || subject,
        collection_zone: clean(metadata.collection_zone) || "Grow Room",
        generated_only_after_anchor_done: true,
      },
    });
    createdIds.push(id);
  }

  return createdIds;
}

async function generateCropCycleFollowups(task: AtlasTriggerTaskRow, anchorDate: string, cycles: CropCycleResult[], profiles: CropProfileRow[]) {
  const createdIds: string[] = [];
  const profileByKey = new Map(profiles.map((profile) => [profile.stable_key, profile]));

  for (const cycle of cycles) {
    const profile = profileByKey.get(cycle.cropProfileStableKey);
    if (!profile) continue;
    const plan = cropFollowupPlan(profile);

    for (const item of plan) {
      const dueDate = addDaysIso(anchorDate, item.offset_days);
      const baseSubject = clean(item.display_subject) || clean(item.title) || "Crop cycle follow-up";
      const title = `${clean(item.title) || baseSubject} — ${cycle.objectLabel}`;
      const followupTaskKey = slug(`${cycle.cropCycleKey}_${clean(item.task_type) || "followup"}_${item.offset_days}_${dueDate}`);
      const id = await insertFollowupTask({
        task,
        dueDate,
        followupTaskKey,
        title,
        taskType: clean(item.task_type) || "crop_cycle_follow_up",
        note: clean(item.note) || null,
        objectId: cycle.objectId,
        metadata: {
          created_from: "crop_cycle_triggered_sequence",
          followup_task_key: followupTaskKey,
          trigger_source_task_id: task.id,
          trigger_anchor_date: anchorDate,
          trigger_offset_days: item.offset_days,
          crop_cycle_id: cycle.cropCycleId,
          crop_cycle_key: cycle.cropCycleKey,
          planting_claim_id: cycle.plantingClaimId,
          crop_profile_stable_key: cycle.cropProfileStableKey,
          crop_label: cycle.cropLabel,
          crop_variety: cycle.variety,
          object_id: cycle.objectId,
          display_action: clean(item.display_action) || "Follow up",
          display_subject: `${baseSubject} — ${cycle.objectLabel}`,
          display_detail: `${cycle.variety ? `${cycle.variety} ` : ""}${cycle.cropLabel}`,
          collection_label: `${cycle.objectLabel} crop cycle`,
          collection_zone: cycle.objectLabel,
          work_route: "crop_cycle",
          generated_only_after_anchor_done: true,
        },
      });
      createdIds.push(id);
    }
  }

  return createdIds;
}

export async function runTriggeredSequencesForDoneTask(task: AtlasTriggerTaskRow, objectIds: string[], now: string, note: string | null): Promise<AtlasTriggeredSequenceResult> {
  const metadata = task.metadata ?? {};
  const anchorDate = now.slice(0, 10);
  const taskFollowupsEnabled = boolish(metadata.generate_followups_on_done);
  const cropKeys = cropProfileKeysForTask(task);
  const cropIds = cropProfileIdsForTask(task);
  const cropSequenceEnabled = isSowingOrPlantingTask(task) && (boolish(metadata.crop_cycle_template_enabled) || cropKeys.length > 0 || cropIds.length > 0);

  if (!taskFollowupsEnabled && !cropSequenceEnabled) return emptyResult;

  const result: AtlasTriggeredSequenceResult = {
    cropCycleIds: [],
    plantingClaimIds: [],
    objectActivityEventIds: [],
    followupTaskIds: [],
  };

  if (taskFollowupsEnabled) {
    result.followupTaskIds.push(...await generateTaskFollowups(task, anchorDate, note));
  }

  if (cropSequenceEnabled && objectIds.length > 0) {
    const [objects, profiles] = await Promise.all([
      fetchTaskObjects(objectIds),
      fetchCropProfiles(cropKeys, cropIds),
    ]);

    const cropCycles: CropCycleResult[] = [];
    for (const object of objects) {
      for (const profile of profiles) {
        const cycle = await createCropCycleForObject({ task, object, profile, anchorDate, note });
        cropCycles.push(cycle);
        result.cropCycleIds.push(cycle.cropCycleId);
        if (cycle.plantingClaimId) result.plantingClaimIds.push(cycle.plantingClaimId);
      }
    }

    result.followupTaskIds.push(...await generateCropCycleFollowups(task, anchorDate, cropCycles, profiles));
  }

  return {
    cropCycleIds: Array.from(new Set(result.cropCycleIds)),
    plantingClaimIds: Array.from(new Set(result.plantingClaimIds)),
    objectActivityEventIds: Array.from(new Set(result.objectActivityEventIds)),
    followupTaskIds: Array.from(new Set(result.followupTaskIds)),
  };
}
