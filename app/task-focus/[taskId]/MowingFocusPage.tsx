"use client";

import { useEffect, useState } from "react";

import MowingFocusCard, { type MowingFocusTask } from "@/components/atlas/mowing-focus-card";
import TaskFocusCueDelivery from "./TaskFocusCueDelivery";

export type { MowingFocusTask } from "@/components/atlas/mowing-focus-card";

type ResourceRequirement = {
  requirement_role?: string | null;
  resource_label?: string | null;
  resource_status?: string | null;
  status?: string | null;
};

type TaskCardResponse = {
  ok?: boolean;
  taskCards?: Array<{ resource_requirements?: ResourceRequirement[] }>;
};

export default function MowingFocusPage({ task }: { task: MowingFocusTask }) {
  const [resource, setResource] = useState<ResourceRequirement | null>(null);

  useEffect(() => {
    if (task.resourceLabel) return;
    const controller = new AbortController();
    void fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.id)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: TaskCardResponse) => {
        if (controller.signal.aborted || !body.ok) return;
        const requirements = body.taskCards?.[0]?.resource_requirements ?? [];
        setResource(requirements.find((item) => item.requirement_role === "required") ?? requirements[0] ?? null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [task.id, task.resourceLabel]);

  const hydratedTask: MowingFocusTask = {
    ...task,
    resourceLabel: task.resourceLabel || resource?.resource_label || null,
    resourceStatus: task.resourceStatus || resource?.resource_status || resource?.status || null,
  };

  return (
    <>
      <MowingFocusCard task={hydratedTask} />
      <TaskFocusCueDelivery taskId={task.id} />
    </>
  );
}
