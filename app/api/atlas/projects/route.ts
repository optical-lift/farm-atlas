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

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const statusRank: Record<string, number> = { open: 0, blocked: 1, done: 2, archived: 3 };

function sortValue(task: { status: string; due_date: string | null; priority: string | null; task_title: string; sort_order: number }) {
  return `${statusRank[task.status] ?? 9}-${task.due_date ?? "9999-12-31"}-${priorityRank[task.priority ?? "normal"] ?? 9}-${String(task.sort_order).padStart(4, "0")}-${task.task_title}`;
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

  const projects = (projectRows ?? []) as ProjectRow[];
  const projectIds = Array.from(new Set(projects.map((project) => project.project_id)));
  let links: LinkRow[] = [];
  let taskRows: TaskRow[] = [];

  if (projectIds.length > 0) {
    const { data: linkRows, error: linkError } = await atlasSupabase
      .schema("atlas")
      .from("project_task_links")
      .select("project_id, task_id, link_role, sort_order")
      .in("project_id", projectIds)
      .order("sort_order", { ascending: true });

    if (linkError) {
      return NextResponse.json({ ok: false, error: "Atlas project task links read failed.", details: linkError.message }, { status: 500 });
    }

    links = (linkRows ?? []) as LinkRow[];
    const taskIds = Array.from(new Set(links.map((link) => link.task_id)));

    if (taskIds.length > 0) {
      const { data: cards, error: cardError } = await atlasSupabase
        .schema("atlas")
        .from("v_task_cards")
        .select("task_id, title, task_type, status, priority, due_date, unlock_text, blocker_text, note, zone_key, zone_label, objects")
        .in("task_id", taskIds);

      if (cardError) {
        return NextResponse.json({ ok: false, error: "Atlas project tasks read failed.", details: cardError.message }, { status: 500 });
      }

      taskRows = (cards ?? []) as TaskRow[];
    }
  }

  const tasksById = new Map(taskRows.map((task) => [task.task_id, task]));
  const linksByProject = new Map<string, LinkRow[]>();
  links.forEach((link) => {
    const list = linksByProject.get(link.project_id) ?? [];
    list.push(link);
    linksByProject.set(link.project_id, list);
  });

  const output = projects.map((project) => {
    const collection = (linksByProject.get(project.project_id) ?? [])
      .map((link) => {
        const task = tasksById.get(link.task_id);
        if (!task) return null;
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
          link_role: link.link_role,
          sort_order: link.sort_order,
        };
      })
      .filter((task): task is NonNullable<typeof task> => Boolean(task))
      .sort((a, b) => sortValue(a).localeCompare(sortValue(b)));

    return {
      ...project,
      task_count: collection.length,
      open_task_count: collection.filter((task) => task.task_status === "open").length,
      blocked_task_count: collection.filter((task) => task.task_status === "blocked").length,
      done_task_count: collection.filter((task) => task.task_status === "done" || task.task_status === "archived").length,
      next_due_date: collection.find((task) => task.task_status === "open")?.task_due_date ?? project.next_due_date,
      current_tasks: collection,
      steps: [],
      step_count: null,
      done_step_count: null,
      blocked_step_count: null,
    };
  });

  return NextResponse.json({ ok: true, farmKey: "elm_farm", projects: output });
}
