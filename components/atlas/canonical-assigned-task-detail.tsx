"use client";

import DecisionSelectorTaskDetail from "@/components/atlas/decision-selector-task-detail";
import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import ExecutionChecklistTaskDetail from "@/components/atlas/execution-checklist-task-detail";
import NetworkInputsTaskDetail from "@/components/atlas/network-inputs-task-detail";
import SeedInventoryTaskLoader from "@/components/atlas/seed-inventory-task-loader";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function isDecisionSelectorTask(task: AtlasTaskCard) {
  return task.metadata?.task_style === "decision_selector"
    && typeof task.metadata?.decision_selector_key === "string"
    && task.metadata.decision_selector_key.length > 0;
}

function isWeedTask(task: AtlasTaskCard) {
  return task.action_key === "weed"
    || task.task_type === "weed"
    || task.metadata?.work_route === "weed"
    || /^weed\b/i.test(task.title.trim());
}

function isSeedInventoryTask(task: AtlasTaskCard) {
  return task.task_type === "seed_inventory_recount"
    || task.action_key === "recount_seed_inventory"
    || task.metadata?.task_style === "seed_inventory_recount";
}

function isNetworkInputsTask(task: AtlasTaskCard) {
  return task.metadata?.network_input_research === true
    || task.metadata?.network_input_master_task === true
    || task.metadata?.checklist_mode === "network_input_research"
    || task.metadata?.task_key === "anna_20260728_call_local_companies_florist_buckets"
    || task.metadata?.task_key === "anna_20260730_source_free_farm_inputs";
}

function isExecutionChecklistTask(task: AtlasTaskCard) {
  return typeof task.metadata?.execution_checklist_template_key === "string"
    && task.metadata.execution_checklist_template_key.length > 0;
}

export default function CanonicalAssignedTaskDetail(props: Props) {
  if (isDecisionSelectorTask(props.task)) return <DecisionSelectorTaskDetail {...props} />;
  if (isWeedTask(props.task)) return <WeedCardTaskLoader {...props} />;
  if (isSeedInventoryTask(props.task)) return <SeedInventoryTaskLoader {...props} />;
  if (isNetworkInputsTask(props.task)) return <NetworkInputsTaskDetail {...props} />;
  if (isExecutionChecklistTask(props.task)) return <ExecutionChecklistTaskDetail {...props} />;
  return <DominionAssignedTaskDetail {...props} />;
}
