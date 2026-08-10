import type {
  AtlasTaskCard,
  AtlasTaskDependencyContext,
  AtlasTaskProjectContext,
} from "@/lib/atlas/task-cards-client";
import { taskDominionModel } from "@/lib/atlas/task-dominion";
import { atlasTaskDisplay, type AtlasWorkRouteKey } from "@/lib/atlas/task-display";
import { taskExecutionModel } from "@/lib/atlas/task-execution";
import { assembleTaskMoveCore } from "./task-move-assembly-core";

export type TaskMoveResolution = "resolved" | "warning" | "missing" | "blocked";
export type TaskMoveReadiness = "ready" | "warning" | "blocked";
export type TaskMoveRequirementKind =
  | "resource"
  | "container"
  | "medium"
  | "source"
  | "destination"
  | "capacity"
  | "dependency"
  | "prerequisite"
  | "method";

export type TaskMoveProvenance =
  | "task_object"
  | "resource_requirement"
  | "action_template"
  | "prerequisite"
  | "capacity_pool"
  | "task_record"
  | "legacy_metadata"
  | "derived"
  | "missing";

export type TaskMoveCapacityQuestion = {
  id: string;
  key: string | null;
  kind: string | null;
  label: string;
  status: string;
  blockerRole: string;
  answerValue: number | null;
  answerUnit: string | null;
  answerText: string | null;
};

export type TaskMoveFact = {
  label: string;
  status: TaskMoveResolution;
  provenance: TaskMoveProvenance;
  sourceTable?: string | null;
  sourceId?: string | null;
};

export type TaskMoveRequirement = {
  id: string;
  kind: TaskMoveRequirementKind;
  label: string;
  required: boolean;
  quantity: number | null;
  unit: string | null;
  provenance: TaskMoveProvenance;
  status: TaskMoveResolution;
  availableQuantity?: number | null;
  availableUnit?: string | null;
  resourceKey?: string | null;
  resourceCategory?: string | null;
  note?: string | null;
  conditionNotes?: string | null;
  templateKey?: string | null;
  poolKey?: string | null;
  capacityRole?: string;
  capacityStatus?: string;
  totalCapacity?: number | null;
  totalUnit?: string | null;
  questions?: TaskMoveCapacityQuestion[];
  taskId?: string;
  assigneeName?: string;
  requiredStatus?: string;
  holdMode?: string;
  sourceId?: string;
};

export type TaskMoveUnresolvedItem = {
  kind: TaskMoveRequirementKind | "current" | "move" | "after";
  label: string;
  provenance: TaskMoveProvenance;
  status: Exclude<TaskMoveResolution, "resolved">;
};

export type TaskMoveAssembly = {
  version: 2;
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
  spine: {
    current: TaskMoveFact[];
    move: {
      action: TaskMoveFact;
      subject: TaskMoveFact;
      workSite: TaskMoveFact;
    };
    after: TaskMoveFact[];
    connection: "continuous" | "stops_at_move";
  };
  requirements: TaskMoveRequirement[];
  linkedObjects: Array<{
    id: string;
    key: string;
    label: string;
    objectType: string;
    objectMode: string | null;
    lifeStatus: string | null;
    provenance: "task_object";
  }>;
  execution: {
    what: string;
    where: string;
    how: string[];
    doneWhen: string;
    details: string | null;
    dueLabel: string;
  };
  checklist: Array<{
    id: string;
    label: string;
    provenance: "legacy_metadata";
  }>;
  context: {
    projects: AtlasTaskProjectContext[];
    unlocks: AtlasTaskDependencyContext[];
    whyNow: string | null;
    stateEffect: string | null;
  };
  unresolved: TaskMoveUnresolvedItem[];
  readiness: {
    status: TaskMoveReadiness;
    executable: boolean;
    unresolvedCount: number;
  };
};

/**
 * Assemble the canonical semantic payload for one Atlas Task Move.
 *
 * The spine is only the state transition: CURRENT -> MOVE -> AFTER.
 * Requirements attach to MOVE as branches. Their array order is never sequential
 * and must never be rendered as though one resource or dependency happens after
 * another. A blocked branch may stop the spine at MOVE while AFTER remains known.
 */
export function assembleTaskMove(task: AtlasTaskCard): TaskMoveAssembly {
  const execution = taskExecutionModel(task);
  const display = atlasTaskDisplay(task);
  const dominion = taskDominionModel(task, null);

  return assembleTaskMoveCore({
    task,
    execution,
    display,
    dominion,
    moveContext: task.move_context ?? null,
  }) as TaskMoveAssembly;
}
