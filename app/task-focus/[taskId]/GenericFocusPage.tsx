"use client";

import { useSearchParams } from "next/navigation";
import AssignedTaskFocusPage from "@/components/atlas/assigned-task-focus-page";

type Props = {
  taskId: string;
  assigneeLabel?: string | null;
};

function assigneeFromReturnTo(returnTo: string | null) {
  if (!returnTo) return null;
  if (returnTo === "/owner" || returnTo.startsWith("/owner?")) return "Owner";
  if (returnTo === "/marshall" || returnTo.startsWith("/marshall?")) return "Marshall";
  if (returnTo === "/children" || returnTo.startsWith("/children?")) return "Kids";
  return null;
}

export default function GenericFocusPage({ taskId, assigneeLabel = null }: Props) {
  const searchParams = useSearchParams();
  const resolvedAssignee = assigneeLabel || assigneeFromReturnTo(searchParams.get("returnTo"));

  return <AssignedTaskFocusPage taskId={taskId} assigneeLabel={resolvedAssignee} />;
}
