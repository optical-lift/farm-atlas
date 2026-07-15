"use client";

import AssignedTaskFocusPage from "@/components/atlas/assigned-task-focus-page";

export default function GenericFocusPage({ taskId }: { taskId: string }) {
  return <AssignedTaskFocusPage taskId={taskId} />;
}
