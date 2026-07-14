import { notFound } from "next/navigation";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import GerminationFocusPage from "./GerminationFocusPage";
import GenericFocusPage from "./GenericFocusPage";
import "./focused-task-only.css";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  title: string;
  task_type: string | null;
  due_date: string | null;
  metadata: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isGerminationTask(task: TaskRow) {
  const metadata = task.metadata ?? {};
  return task.task_type === "germination_check" || text(metadata.task_style) === "germination_check" || text(metadata.milestone) === "germination_check";
}

async function loadTask(taskId: string) {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, title, task_type, due_date, metadata")
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as TaskRow | null) ?? null;
}

async function loadObjectLabel(taskId: string) {
  const { data } = await atlasSupabase
    .schema("atlas")
    .from("task_objects")
    .select("growing_objects(label)")
    .eq("task_id", taskId)
    .limit(1)
    .maybeSingle();

  const row = data as unknown as { growing_objects?: { label?: string } | null } | null;
  return text(row?.growing_objects?.label) || "Elm Farm";
}

async function loadCrop(task: TaskRow) {
  const metadata = task.metadata ?? {};
  let profileId = text(metadata.crop_profile_id);
  const cycleId = text(metadata.crop_cycle_id);

  if (!profileId && cycleId) {
    const { data } = await atlasSupabase
      .schema("atlas")
      .from("crop_cycles")
      .select("crop_profile_id")
      .eq("id", cycleId)
      .limit(1)
      .maybeSingle();
    profileId = text((data as { crop_profile_id?: string } | null)?.crop_profile_id);
  }

  if (profileId) {
    const { data } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("crop_label, variety")
      .eq("id", profileId)
      .limit(1)
      .maybeSingle();
    const profile = data as { crop_label?: string; variety?: string | null } | null;
    if (profile) {
      return {
        cropLabel: text(profile.crop_label) || text(metadata.crop_label) || "Crop",
        variety: text(profile.variety) || null,
      };
    }
  }

  return {
    cropLabel: text(metadata.crop_label) || text(metadata.crop) || task.title.split("—").pop()?.split("·")[0]?.trim() || "Crop",
    variety: text(metadata.variety) || null,
  };
}

export default async function TaskFocusPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await loadTask(taskId);
  if (!task) notFound();

  if (!isGerminationTask(task)) {
    return <GenericFocusPage taskId={task.id} />;
  }

  const [objectLabel, crop] = await Promise.all([loadObjectLabel(task.id), loadCrop(task)]);

  return (
    <div className="atlas-focused-task-only">
      <GerminationFocusPage
        task={{
          id: task.id,
          cropLabel: crop.cropLabel,
          variety: crop.variety,
          objectLabel,
          dueDate: task.due_date,
        }}
      />
    </div>
  );
}
