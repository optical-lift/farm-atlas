"use client";

import ContractorServiceTaskDetail from "@/components/atlas/contractor-service-task-detail";
import DecisionSelectorTaskDetail from "@/components/atlas/decision-selector-task-detail";
import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import ExecutionChecklistTaskDetail from "@/components/atlas/execution-checklist-task-detail";
import FarmHandConveyorTaskDetail from "@/components/atlas/farm-hand-conveyor-task-detail";
import NetworkInputsTaskDetail from "@/components/atlas/network-inputs-task-detail";
import NetworkOutreachTaskDetail from "@/components/atlas/network-outreach-task-detail";
import ProjectPullTaskDetail from "@/components/atlas/project-pull-task-detail";
import SeedInventoryTaskLoader from "@/components/atlas/seed-inventory-task-loader";
import { TaskProjectMoveContextPortal } from "@/components/atlas/task-project-move-context";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasTaskResultMode } from "@/lib/atlas/task-result-mode";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function isContractorServiceTask(task: AtlasTaskCard) {
  return task.task_type === "contractor_service_status"
    || task.metadata?.task_style === "contractor_service_status";
}

function isDecisionSelectorTask(task: AtlasTaskCard) {
  return task.metadata?.task_style === "decision_selector"
    && typeof task.metadata?.decision_selector_key === "string"
    && task.metadata.decision_selector_key.length > 0;
}

function isProjectPullTask(task: AtlasTaskCard) {
  return typeof task.metadata?.project_pull_item_id === "string"
    && task.metadata.project_pull_item_id.length > 0;
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

function isNetworkOutreachTask(task: AtlasTaskCard) {
  return task.metadata?.network_outreach_master_task === true
    || task.metadata?.checklist_mode === "network_outreach";
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
  let detail;
  if (isContractorServiceTask(props.task)) detail = <ContractorServiceTaskDetail {...props} />;
  else if (isDecisionSelectorTask(props.task)) detail = <DecisionSelectorTaskDetail {...props} />;
  else if (isWeedTask(props.task)) detail = <WeedCardTaskLoader {...props} />;
  else if (isSeedInventoryTask(props.task)) detail = <SeedInventoryTaskLoader {...props} />;
  else if (isNetworkOutreachTask(props.task)) detail = <NetworkOutreachTaskDetail {...props} />;
  else if (isNetworkInputsTask(props.task)) detail = <NetworkInputsTaskDetail {...props} />;
  else if (isExecutionChecklistTask(props.task)) detail = <ExecutionChecklistTaskDetail {...props} />;
  else if (isProjectPullTask(props.task)) detail = <ProjectPullTaskDetail {...props} />;
  else {
    const resultMode = atlasTaskResultMode(props.task);
    detail = props.assignee.key === "anna" && resultMode === "field_execution"
      ? <FarmHandConveyorTaskDetail {...props} />
      : <DominionAssignedTaskDetail {...props} />;
  }

  return (
    <>
      {detail}
      <TaskProjectMoveContextPortal task={props.task} />
    </>
  );
}
