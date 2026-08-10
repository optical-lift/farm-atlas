import type {
  AtlasTaskCard,
  AtlasTaskDependencyContext,
  AtlasTaskProjectContext,
} from "@/lib/atlas/task-cards-client";
import { taskDominionModel } from "@/lib/atlas/task-dominion";
import type { AtlasWorkRouteKey } from "@/lib/atlas/task-display";
import { taskExecutionModel } from "@/lib/atlas/task-execution";
import { assembleTaskMoveCore } from "./task-move-assembly-core";

export type TaskMoveResolution = "resolved" | "warning" | "missing" | "blocked";
export type TaskMoveReadiness = "ready" | "warning" | "incomplete" | "blocked";
export type TaskMoveProvenance =
  | "task"
  | "task_object"
  | "resource_requirement"
  | "action_template"
  | "prerequisite"
  | "capacity_pool"
  | "legacy_metadata"
  | "derived"
  | "unresolved";

export type TaskMoveResourceRole =
  | "container"
  | "growing_medium"
  | "tool"
  | "equipment"
  | "material"
  | "plant_material"
  | "water"
  | "transport"
  | "protective_equipment"
  | "infrastructure"
  | "information"
  | "other";

export type TaskMoveLinkedObject = {
  id: string;
  key: string;
  label: string;
  objectType: string;
  objectMode: string | null;
  lifeStatus: string | null;
  source: "task_object";
  resolution: "resolved";
};

export type TaskMoveResourceRequirement = {
  id: string;
  requirementRole: string;
  moveRole: TaskMoveResourceRole;
  label: string;
  resourceKey: string | null;
  resourceType: string | null;
  resourceCategory: string | null;
  quantityNeeded: number | null;
  unit: string | null;
  requirementStatus: string;
  resourceStatus: string | null;
  quantityAvailable: number | null;
  resourceUnit: string | null;
  note: string | null;
  conditionNotes: string | null;
  restockNeeded: boolean;
  source: "resource_requirement";
  resolution: "resolved" | "warning";
};

export type TaskMoveExpectedRequirement = {
  key: string;
  label: string;
  kind: "resource_key" | "resource_category";
  templateKey: string | null;
  source: "action_template";
  resolution: "missing";
};

export type TaskMoveCapacityRequirement = {
  id: string;
  label: string;
  poolKey: string | null;
  requiredQuantity: number | null;
  unit: string | null;
  source: "legacy_metadata" | "capacity_pool";
  resolution: TaskMoveResolution;
};

export type TaskMoveChecklistItem = {
  id: string;
  label: string;
  source: "legacy_metadata";
};

export type TaskMoveUnresolvedItem = {
  kind: "blocker" | "resource_requirement" | "capacity_requirement" | "prerequisite";
  label: string;
  source: TaskMoveProvenance;
  resolution: Exclude<TaskMoveResolution, "resolved">;
};

export type TaskMoveAssembly = {
  version: 1;
  task: {
    id: string;
    title: string;
    taskType: string;
    status: string;
    priority: string;
    dueDate: string | null;
    route: AtlasWorkRouteKey;
    workClass: string | null;
    updatedAt: string | null;
  };
  transition: {
    currentTruth: string | null;
    action: string;
    resultingTruth: string | null;
    source: "task" | "unresolved";
  };
  execution: {
    what: string;
    where: string;
    how: string[];
    doneWhen: string;
    details: string | null;
    dueLabel: string;
    provenance: {
      what: "legacy_metadata" | "derived";
      where: "legacy_metadata" | "derived";
      how: "legacy_metadata" | "derived";
      doneWhen: "legacy_metadata" | "derived";
    };
  };
  linkedObjects: TaskMoveLinkedObject[];
  requirements: {
    resources: TaskMoveResourceRequirement[];
    expected: TaskMoveExpectedRequirement[];
    capacity: TaskMoveCapacityRequirement[];
    prerequisites: Array<AtlasTaskDependencyContext & { source: "prerequisite" }>;
  };
  checklist: TaskMoveChecklistItem[];
  context: {
    projects: AtlasTaskProjectContext[];
    unlocks: Array<AtlasTaskDependencyContext & { source: "prerequisite" }>;
    whyNow: string | null;
    stateEffect: string | null;
  };
  unresolved: TaskMoveUnresolvedItem[];
  readiness: {
    status: TaskMoveReadiness;
    unresolvedCount: number;
  };
};

/**
 * Canonical resolved contract for one executable Atlas task.
 *
 * This is intentionally a convergence layer, not a new task ontology. It assembles
 * existing task truth, linked farm objects, resource requirements, action-template
 * expectations, project/dependency context, and the legacy execution fallback into
 * one payload. Later passes may replace fallback sources with stronger canonical
 * links without changing the consumer contract.
 */
export function assembleTaskMove(task: AtlasTaskCard): TaskMoveAssembly {
  const execution = taskExecutionModel(task);
  const dominion = taskDominionModel(task, null);

  return assembleTaskMoveCore({
    task,
    execution,
    dominion,
    moveContext: task.move_context ?? null,
  }) as TaskMoveAssembly;
}
