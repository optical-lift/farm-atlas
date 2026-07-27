"use client";

import { useEffect } from "react";

export default function ProjectTaskDestinationGuard() {
  useEffect(() => {
    if (window.location.pathname !== "/task") return;
    const taskId = new URLSearchParams(window.location.search).get("taskId");
    if (!taskId) return;

    let cancelled = false;
    fetch(`/api/atlas/project-tasks/${encodeURIComponent(taskId)}/destination`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((result: { destination?: { projectId?: string; taskId?: string } | null }) => {
        if (cancelled || !result.destination?.projectId) return;
        const destinationTaskId = result.destination.taskId || taskId;
        const returnTo = `/project/${encodeURIComponent(result.destination.projectId)}`;
        window.location.replace(
          `/task-focus/${encodeURIComponent(destinationTaskId)}?returnTo=${encodeURIComponent(returnTo)}`,
        );
      })
      .catch(() => {
        // Farm tasks continue through the existing task page when no project destination exists.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
