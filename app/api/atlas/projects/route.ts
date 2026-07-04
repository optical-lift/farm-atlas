import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type ProjectRow = {
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
  steps: unknown[];
};

type LinkRow = {
  project_id: string;
  task_id: string;
  link_role: string;
  sort_order: number;
};

type TaskRow = {
  task_id: string;
  title: string;
  task_type: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  zone_key: string | null;
  zone_label: string | null;
  objects: Array<{ object_key: string; object_label: string }> | null;
};

type ProjectTaskItem = {
  task_id: string;
  task_title: string;
  task_type: string | null;
  task_status: string;
  task_priority: string | null;
  task_due_date: string | null;
  zone_key: string | null;
  zone_label: string | null;
  object_keys: string[];
  object_labels: string[];
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  link_role: string;
  sort_order: number;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const statusRank: Record<string, number> = { open: 0, blocked: 1, done: 2, archived: 3 };

function sortValue(task: ProjectTaskItem) {
  return `${statusRank[task.task_status] ?? 9}-${task.task_due_date ?? "9999-12-31"}-${priorityRank[task.task_priority ?? "normal"] ?? 9}-${String(task.sort_order).padStart(4, "0")}-${task.task_title}`;
}

function taskItem(task: TaskRow, linkRole = "belongs_to", sortOrder = 100): ProjectTaskItem {
  return {
    task_id: task.task_id,
    task_title: task.title,
    task_type: task.task_type,
    task_status: task.status,
    task_priority: task.priority,
    task_due_date: task.due_date,
    zone_key: task.zone_key,
    zone_label: task.zone_label,
    object_keys: (task.objects ?? []).map((object) => object.object_key).filter(Boolean),
    object_labels: (task.objects ?? []).map((object) => object.object_label).filter(Boolean),
    unlock_text: task.unlock_text,
    blocker_text: task.blocker_text,
    note: task.note,
    link_role: linkRole,
    sort_order: sortOrder,
  };
}

function asLegacyStep(task: ProjectTaskItem, index: number) {
  return {
    step_id: `project-task-${task.task_id}`,
    step_order: index + 1,
    step_title: task.task_title,
    step_status: task.task_status,
    step_note: task.note ?? task.unlock_text ?? task.zone_label ?? null,
    task_id: task.task_id,
    task_title: task.task_title,
    task_type: task.task_type,
    task_status: task.task_status,
    task_priority: task.task_priority,
    task_due_date: task.task_due_date,
    unlock_text: task.unlock_text,
    blocker_text: task.blocker_text,
  };
}

function words(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function projectText(project: ProjectRow) {
  return `${project.project_key} ${project.project_title} ${project.project_goal_text ?? ""} ${project.goal_label ?? ""} ${project.zone_key ?? ""}`.toLowerCase();
}

function taskText(task: TaskRow) {
  return `${task.title} ${task.task_type ?? ""} ${task.note ?? ""} ${task.unlock_text ?? ""} ${task.zone_key ?? ""} ${task.zone_label ?? ""}`.toLowerCase();
}

function inferredProjectMatch(project: ProjectRow, task: TaskRow) {
  const p = projectText(project);
  const t = taskText(task);
  const zone = words(task.zone_key);

  if (p.includes("sunflower") && t.includes("sunflower")) return true;
  if ((p.includes("field_rows") || p.includes("field rows")) && (zone === "field_rows" || t.includes("field row"))) return true;
  if ((p.includes("main_garden") || p.includes("main garden") || p.includes("potager")) && (zone === "main_garden" || t.includes("main garden") || t.includes("tea courtyard"))) return true;
  if ((p.includes("berry_walk") || p.includes("berry walk")) && (zone === "berry_walk_flower_rows" || t.includes("berry walk"))) return true;
  if ((p.includes("barn_beds") || p.includes("barn beds")) && (zone === "barn_beds" || t.includes("barn bed"))) return true;
  if ((p.includes("curve_garden") || p.includes("curve garden")) && (zone === "curve_garden" || t.includes("curve garden") || t.includes("arch"))) return true;
  if ((p.includes("follow_me") || p.includes("follow me") || p.includes("arrival")) && (zone === "follow_me" || t.includes("follow me") || t.includes("arrival"))) return true;
  if ((p.includes("july6") || p.includes("july 6") || p.includes("launch hand")) && (t.includes("july6") || t.includes("july 6") || t.includes("launch"))) return true;

  return false;
}

export async function GET() {
  const { data: projectRows, error: projectError } = await atlasSupabase
    .schema("atlas")
    .from("v_project_cards")
    .select("*")
    .eq("farm_key", "elm_farm")
    .order("sort_order", { ascending: true });

  if (projectError) {
    return NextResponse.json({ ok: false, error: "Atlas project cards read failed.", details: projectError.message }, { status: 500 });
  }

  const { data: taskRows, error: taskError } = await atlasSupabase
    .schema("atlas")
    .from("v_task_cards")
    .select("task_id, title, task_type, status, priority, due_date, unlock_text, blocker_text, note, zone_key, zone_label, objects")
    .eq("farm_key", "elm_farm");

  const projects = (projectRows ?? []) as ProjectRow[];
  const allTasks = taskError ? [] : ((taskRows ?? []) as TaskRow[]);
  const taskById = new Map(allTasks.map((task) => [task.task_id, task]));
  const projectIds = Array.from(new Set(projects.map((project) => project.project_id)));
  let links: LinkRow[] = [];

  if (projectIds.length > 0) {
    const { data: linkRows } = await atlasSupabase
      .schema("atlas")
      .from("project_task_links")
      .select("project_id, task_id, link_role, sort_order")
      .in("project_id", projectIds)
      .order("sort_order", { ascending: true });

    links = (linkRows ?? []) as LinkRow[];
  }

  const linksByProject = new Map<string, LinkRow[]>();
  links.forEach((link) => {
    const list = linksByProject.get(link.project_id) ?? [];
    list.push(link);
    linksByProject.set(link.project_id, list);
  });

  const output = projects.map((project) => {
    const explicit = (linksByProject.get(project.project_id) ?? [])
      .map((link) => {
        const task = taskById.get(link.task_id);
        return task ? taskItem(task, link.link_role, link.sort_order) : null;
      })
      .filter((item): item is ProjectTaskItem => Boolean(item));

    const inferred = explicit.length > 0 ? [] : allTasks
      .filter((task) => inferredProjectMatch(project, task))
      .map((task, index) => taskItem(task, "inferred", index + 1));

    const collection = [...explicit, ...inferred].sort((a, b) => sortValue(a).localeCompare(sortValue(b)));
    const legacySteps = collection.map(asLegacyStep);

    return {
      ...project,
      task_count: collection.length,
      open_task_count: collection.filter((task) => task.task_status === "open").length,
      blocked_task_count: collection.filter((task) => task.task_status === "blocked").length,
      done_task_count: collection.filter((task) => task.task_status === "done" || task.task_status === "archived").length,
      next_due_date: collection.find((task) => task.task_status === "open")?.task_due_date ?? project.next_due_date,
      current_tasks: collection,
      steps: legacySteps,
      step_count: collection.length,
      done_step_count: collection.filter((task) => task.task_status === "done" || task.task_status === "archived").length,
      blocked_step_count: collection.filter((task) => task.task_status === "blocked").length,
    };
  });

  return NextResponse.json({ ok: true, farmKey: "elm_farm", projects: output, taskFallback: Boolean(taskError) });
}
