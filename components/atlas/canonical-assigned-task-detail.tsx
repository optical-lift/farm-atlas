"use client";

import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function isWeedTask(task: AtlasTaskCard) {
  return task.action_key === "weed"
    || task.task_type === "weed"
    || task.metadata?.work_route === "weed"
    || /^weed\b/i.test(task.title.trim());
}

export default function CanonicalAssignedTaskDetail(props: Props) {
  if (isWeedTask(props.task)) return <WeedCardTaskLoader {...props} />;
  return <DominionAssignedTaskDetail {...props} />;
}