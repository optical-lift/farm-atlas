"use client";

import ConciseWeedTaskDetail from "@/components/atlas/concise-weed-task-detail";
import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function isWeedCardTask(task: AtlasTaskCard) {
  const value = task.metadata?.weed_card_session_task;
  return value === true || value === "true";
}

function isWeedTask(task: AtlasTaskCard) {
  return task.action_key === "weed"
    || task.task_type === "weed"
    || /^weed\b/i.test(task.title.trim());
}

export default function CanonicalAssignedTaskDetail(props: Props) {
  if (isWeedCardTask(props.task)) return <WeedCardTaskLoader {...props} />;
  if (isWeedTask(props.task)) return <ConciseWeedTaskDetail {...props} />;
  return <DominionAssignedTaskDetail {...props} />;
}
