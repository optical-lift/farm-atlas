import { notFound, redirect } from "next/navigation";

import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { isValidAtlasTaskId } from "@/lib/atlas/task-routing-core.js";

type TaskPortalRow = {
  title: string;
  task_type: string | null;
  metadata: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isGrowRoomDoorway(task: TaskPortalRow | null) {
  if (!task || task.task_type !== "grow_room_care") return false;
  if (text(task.metadata?.portal_href) === "/grow-room") return true;
  return ["grow room care", "water + check grow room", "check grow room"].includes(task.title.trim().toLowerCase());
}

export const dynamic = "force-dynamic";

export default async function TaskFocusLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ taskId: string }>;
}>) {
  const { taskId } = await params;
  if (!isValidAtlasTaskId(taskId)) notFound();

  const { data } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("title, task_type, metadata")
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();

  if (isGrowRoomDoorway(data as TaskPortalRow | null)) redirect("/grow-room");
  return children;
}
