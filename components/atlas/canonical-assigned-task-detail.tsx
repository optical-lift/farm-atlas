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

function isWeedCardTask(task: AtlasTaskCard) {
  const value = task.metadata?.weed_card_session_task;
  return value === true || value === "true";
}

export default function CanonicalAssignedTaskDetail(props: Props) {
  return isWeedCardTask(props.task)
    ? <WeedCardTaskLoader {...props} />
    : <DominionAssignedTaskDetail {...props} />;
}
