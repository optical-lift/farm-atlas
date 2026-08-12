import type {
  AtlasTaskCard,
  AtlasTaskDependencyContext,
  AtlasTaskProjectContext,
} from "@/lib/atlas/task-cards-client";
import { atlasTaskDisplay, type AtlasWorkRouteKey } from "@/lib/atlas/task-display";
import { taskExecutionModel } from "@/lib/atlas/task-execution";
import { assembleTaskMoveCore } from "./task-move-assembly-core";
import { attachCanonicalMoveRoles } from "./task-move-role-enrichment";

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
  unitCompatible?: boolean | null;
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

export type TaskMovePresentationFact = {
  label: string;
  value: string;
};

export type TaskMovePresentation = {
  actionLabel: string;
  actionSubject: string;
  placeRelation: "Where" | "Into" | "From" | "To" | "At" | "Place";
  placeLabel: string | null;
  methodFacts: TaskMovePresentationFact[];
  resultLabel: string | null;
  resultText: string | null;
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
    role?: string | null;
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
  presentation: TaskMovePresentation;
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

function metadataText(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function metadataLines(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function placeRelation(task: AtlasTaskCard, route: AtlasWorkRouteKey): TaskMovePresentation["placeRelation"] {
  const type = task.task_type.toLowerCase();
  const action = (task.action_key ?? "").toLowerCase();
  if (type.includes("transplant") || action.includes("transplant")) return "Into";
  if (route === "harvest" || type.includes("harvest")) return "From";
  if (type.includes("deliver") || action.includes("deliver")) return "To";
  if (type.includes("move") || type.includes("relocat") || action === "move") return "Place";
  if (route === "seed" || type.includes("sow")) return "Where";
  if (route === "plant") return "Where";
  return "At";
}

function meaningfulResult(task: AtlasTaskCard, route: AtlasWorkRouteKey) {
  const label = metadataText(task, "worker_result_label");
  const lines = metadataLines(task, "worker_result_lines");
  if (label && lines.length) return { label, text: lines.join(" · ") };

  const batchCount = metadataNumber(task, "batch_item_count");
  const batchTotal = metadataNumber(task, "batch_total_quantity");
  const batchUnit = metadataText(task, "batch_quantity_unit") || metadataText(task, "quantity_unit");
  if (task.task_type === "pot_up" && batchCount !== null && batchTotal !== null) {
    return {
      label: "After",
      text: `${batchCount} trays · ${batchTotal}${batchUnit ? ` ${batchUnit}` : ""}`,
    };
  }

  // Do not spend a trail node saying that sowing makes a bed sown, weeding makes
  // a bed weeded, etc. A result node is reserved for information beyond the verb.
  if (["seed", "weed", "mow", "water"].includes(route)) return { label: null, text: null };

  const doneWhen = metadataText(task, "execution_done_when");
  const generic = [
    "the requested result is recorded.",
    "the requested work is finished.",
    "the requested task is finished.",
    "the assigned planting is in place.",
  ];
  if (!doneWhen || generic.includes(doneWhen.toLowerCase())) return { label: null, text: null };
  return { label: "After", text: doneWhen };
}

function taskMovePresentation(task: AtlasTaskCard, route: AtlasWorkRouteKey, action: string, subject: string, place: string): TaskMovePresentation {
  const methodFacts: TaskMovePresentationFact[] = [];
  const rows = metadataNumber(task, "rows_per_3ft_bed");
  const spacing = metadataNumber(task, "in_row_spacing_in");
  const depth = metadataNumber(task, "target_depth_inches");
  const cutHeight = metadataNumber(task, "target_cut_height_inches");

  if (rows !== null) methodFacts.push({ label: "Rows", value: `${rows} per bed` });
  if (spacing !== null) methodFacts.push({ label: "Spacing", value: `${spacing}″` });
  if (depth !== null) methodFacts.push({ label: "Depth", value: `${depth}″` });
  if (cutHeight !== null) methodFacts.push({ label: "Cut height", value: `${cutHeight}″` });

  const result = meaningfulResult(task, route);
  return {
    actionLabel: action || "Work",
    actionSubject: subject || task.title,
    placeRelation: placeRelation(task, route),
    placeLabel: place && place !== "Elm Farm" ? place : null,
    methodFacts,
    resultLabel: result.label,
    resultText: result.text,
  };
}

/**
 * Assemble the canonical semantic payload for one Atlas Task Move.
 *
 * The spine is the state transition. Requirements remain independent branches;
 * presentation describes how a human should read the particular operation.
 */
export function assembleTaskMove(task: AtlasTaskCard): TaskMoveAssembly {
  const execution = taskExecutionModel(task);
  const display = atlasTaskDisplay(task);

  const canonicalMoveSemantics = {
    route: display.route,
    instruction: display.action || execution.doText || task.title,
    placeLabel: execution.placeText || display.location || "Elm Farm",
    dueLabel: execution.dueLabel,
    whyNow: metadataText(task, "why_now"),
    stateEffect: metadataText(task, "state_effect"),
  };

  const baseAssembly = assembleTaskMoveCore({
    task,
    execution,
    display,
    moveSemantics: canonicalMoveSemantics,
    moveContext: task.move_context ?? null,
  });
  const enriched = attachCanonicalMoveRoles(baseAssembly, task) as Omit<TaskMoveAssembly, "presentation">;

  return {
    ...enriched,
    presentation: taskMovePresentation(
      task,
      display.route,
      display.action || execution.doText || task.title,
      display.subject || task.title,
      execution.placeText || display.location || "Elm Farm",
    ),
  };
}
