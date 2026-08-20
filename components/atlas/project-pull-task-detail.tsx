"use client";

import AssignedTaskExecutionShell from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

export default function ProjectPullTaskDetail(props: Props) {
  return <AssignedTaskExecutionShell {...props} />;
}
