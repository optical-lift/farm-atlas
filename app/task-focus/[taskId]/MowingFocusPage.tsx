"use client";

import MowingFocusCard, { type MowingFocusTask } from "@/components/atlas/mowing-focus-card";
import TaskFocusCueDelivery from "./TaskFocusCueDelivery";

export type { MowingFocusTask } from "@/components/atlas/mowing-focus-card";

export default function MowingFocusPage({ task }: { task: MowingFocusTask }) {
  return (
    <>
      <MowingFocusCard task={task} />
      <TaskFocusCueDelivery taskId={task.id} />
    </>
  );
}
