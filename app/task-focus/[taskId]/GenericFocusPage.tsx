"use client";

import AssignedTaskFocusPage from "@/components/atlas/assigned-task-focus-page";

type Props = {
  taskId: string;
  assigneeLabel: string | null;
};

export default function GenericFocusPage({ taskId, assigneeLabel }: Props) {
  return <AssignedTaskFocusPage taskId={taskId} assigneeLabel={assigneeLabel} />;
}
