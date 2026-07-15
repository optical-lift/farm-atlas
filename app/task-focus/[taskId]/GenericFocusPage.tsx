"use client";

import AssignedTaskFocusPage from "@/components/atlas/assigned-task-focus-page";

function assigneeFromReturnPath() {
  if (typeof window === "undefined") return null;
  const returnTo = new URLSearchParams(window.location.search).get("returnTo") || "";
  if (returnTo === "/owner" || returnTo.startsWith("/owner?")) return "Owner";
  if (returnTo === "/marshall" || returnTo.startsWith("/marshall?")) return "Marshall";
  if (returnTo === "/children" || returnTo.startsWith("/children?")) return "Kids";
  return null;
}

export default function GenericFocusPage({ taskId }: { taskId: string }) {
  return <AssignedTaskFocusPage taskId={taskId} assigneeLabel={assigneeFromReturnPath()} />;
}
