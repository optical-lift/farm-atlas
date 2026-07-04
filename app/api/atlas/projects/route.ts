import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type AtlasProjectCardRow = {
  farm_key: string;

  project_id: string;
  project_key: string;
  project_title: string;
  project_status: string;
  project_goal_text: string | null;
  sort_order: number | null;
  project_metadata: Record<string, unknown> | null;

  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;

  project_goal_id: string | null;
  project_goal_key: string | null;
  goal_type: string | null;
  goal_label: string | null;
  target_window_label: string | null;
  target_start_date: string | null;
  target_due_date: string | null;
  planning_status: string | null;
  success_definition: string | null;
  goal_notes: string | null;
  goal_metadata: Record<string, unknown> | null;

  step_count: number | null;
  done_step_count: number | null;
  blocked_step_count: number | null;
  task_count: number | null;
  open_task_count: number | null;
  blocked_task_count: number | null;
  next_due_date: string | null;

  steps: Array<{
    step_id: string;
    step_order: number;
    step_title: string;
    step_status: string;
    step_note: string | null;
    task_id: string | null;
    task_title: string | null;
    task_type: string | null;
    task_status: string | null;
    task_priority: string | null;
    task_due_date: string | null;
    unlock_text: string | null;
    blocker_text: string | null;
  }>;
};

type TaskRow = {
  id: string;
  zone_id: string | null;
  title: string;
  task_type: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  generated_from: string | null;
  generated_from_id: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type ZoneRow = {
  id: string;
  stable_key: string;
  label: string;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function textHas(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function metadataText(value: unknown) {
  try {
    return JSON.stringify(value ?? {}).toLowerCase();
  } catch {
    return "";
  }
}

function taskText(task: TaskRow) {
  return `${task.title} ${task.task_type ?? ""} ${task.generated_from ?? ""} ${metadataText(task.metadata)}`.toLowerCase();
}

function projectText(project: AtlasProjectCardRow) {
  return `${project.project_title} ${project.project_key} ${project.project_goal_text ?? ""} ${project.goal_label ?? ""} ${project.goal_notes ?? ""} ${metadataText(project.project_metadata)} ${metadataText(project.goal_metadata)}`.toLowerCase();
}

function projectCandidateZones(project: AtlasProjectCardRow) {
  const zones = new Set<string>();
  if (project.zone_key) zones.add(project.zone_key);
  const metadataZones = [
    project.project_metadata?.candidate_zones,
    project.goal_metadata?.candidate_zones,
    project.project_metadata?.primary_zone,
    project.goal_metadata?.primary_zone,
  ];

  metadataZones.forEach((value) => {
    if (Array.isArray(value)) value.forEach((zone) => typeof zone === "string" && zones.add(zone));
    if (typeof value === "string") zones.add(value);
  });

  return zones;
}

function projectKeywords(project: AtlasProjectCardRow) {
  const text = projectText(project);
  const keywords = new Set<string>();
  if (textHas(text, ["sunflower"])) keywords.add("sunflower");
  if (textHas(text, ["field rows", "field_rows"])) keywords.add("field rows");
  if (textHas(text, ["berry walk", "berry_walk"])) keywords.add("berry walk");
  if (textHas(text, ["main garden", "tea courtyard", "potager"])) keywords.add("main garden");
  if (textHas(text, ["barn beds", "barn_beds"])) keywords.add("barn beds");
  if (textHas(text, ["u-pick", "u_pick"])) keywords.add("u-pick");
  if (textHas(text, ["entry billboard", "entry_billboard"])) keywords.add("entry billboard");
  if (textHas(text, ["curve garden", "curve_garden"])) keywords.add("curve garden");
  if (textHas(text, ["follow me", "follow_me", "arches", "arrival"])) keywords.add("follow me");
  if (textHas(text, ["july 6", "july6", "anna_july6", "launch hand"])) keywords.add("july6");
  return keywords;
}

function taskMatchesProject(project: AtlasProjectCardRow, task: TaskRow, zone: ZoneRow | undefined) {
  if (task.generated_from_id && (task.generated_from_id === project.project_id || task.generated_from_id === project.project_goal_id)) return "linked";

  const projectZones = projectCandidateZones(project);
  const tText = taskText(task);
  const pKeywords = projectKeywords(project);
  const zoneKey = zone?.stable_key;
  const zoneMatch = zoneKey ? projectZones.has(zoneKey) : false;

  if (pKeywords.has("july6") && (tText.includes("july6") || tText.includes("anna_july6"))) return "launch hand";
  if (pKeywords.has("sunflower") && tText.includes("sunflower")) return "sunflower";
  if (zoneMatch && pKeywords.size === 0) return "zone";
  if (zoneMatch && Array.from(pKeywords).some((keyword) => tText.includes(keyword.replace(" ", "_")) || tText.includes(keyword))) return "zone + topic";
  if (zoneMatch && ["field rows", "main garden", "barn beds", "u-pick", "entry billboard", "curve garden", "follow me", "berry walk"].some((keyword) => pKeywords.has(keyword))) return "zone";

  return null;
}

function sortTasks(a: TaskRow, b: TaskRow) {
  return `${a.due_date ?? "9999-12-31"}-${priorityRank[a.priority ?? "normal"] ?? 9}-${a.title}`.localeCompare(
    `${b.due_date ?? "9999-12-31"}-${priorityRank[b.priority ?? "normal"] ?? 9}-${b.title}`,
  );
}

export async function GET() {
  const [{ data, error }, { data: tasks, error: tasksError }, { data: zones, error: zonesError }] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("v_project_cards")
      .select("*")
      .eq("farm_key", "elm_farm")
      .order("sort_order", { ascending: true }),
    atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, zone_id, title, task_type, status, priority, due_date, unlock_text, blocker_text, generated_from, generated_from_id, note, metadata")
      .eq("status", "open"),
    atlasSupabase
      .schema("atlas")
      .from("zones")
      .select("id, stable_key, label"),
  ]);

  const firstError = error ?? tasksError ?? zonesError;
  if (firstError) {
    console.error("Atlas project cards read failed:", firstError);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas project cards read failed.",
        details: firstError.message,
      },
      { status: 500 },
    );
  }

  const zoneById = new Map(((zones ?? []) as ZoneRow[]).map((zone) => [zone.id, zone]));
  const openTasks = ((tasks ?? []) as TaskRow[]).sort(sortTasks);
  const projects = ((data ?? []) as AtlasProjectCardRow[]).map((project) => {
    const currentTasks = openTasks
      .map((task) => {
        const zone = task.zone_id ? zoneById.get(task.zone_id) : undefined;
        const reason = taskMatchesProject(project, task, zone);
        if (!reason) return null;
        return {
          task_id: task.id,
          task_title: task.title,
          task_type: task.task_type,
          task_status: task.status,
          task_priority: task.priority,
          task_due_date: task.due_date,
          zone_key: zone?.stable_key ?? null,
          zone_label: zone?.label ?? null,
          unlock_text: task.unlock_text,
          blocker_text: task.blocker_text,
          note: task.note,
          link_reason: reason,
        };
      })
      .filter(Boolean);

    return {
      ...project,
      open_task_count: currentTasks.length || project.open_task_count,
      current_tasks: currentTasks,
    };
  });

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    projects,
  });
}
