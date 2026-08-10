import type {
  AtlasTaskCard,
  AtlasTaskDependencyContext,
  AtlasTaskProjectContext,
} from "@/lib/atlas/task-cards-client";
import { taskDominionModel } from "@/lib/atlas/task-dominion";
import { taskExecutionModel } from "@/lib/atlas/task-execution";
import { assembleTaskMoveCore } from "./task-move-assembly-core";

export type TaskMoveAssembly = {
  version: 1;
  task: {
    id: string;
    title: string;
    taskType: string;
    status: string;
    priority: string;
    dueDate: string | null;
    route: string;
    workClass: string | null;
    updatedAt: string | null;
  };
  move: {
    what: string;
    where: string;
    how: string[];
    doneWhen: string;
    details: string | null;
    dueLabel: string;
  };
  context: {
    whyNow: string | null;
    stateEffect: string | null;
    projects: AtlasTaskProjectContext[];
    waitingOn: AtlasTaskDependencyContext[];
    unlocks: AtlasTaskDependencyContext[];
  };
};

/**
 * Canonical execution payload for one Atlas task.
 *
 * This deliberately assembles the layers Atlas already owns:
 * - task-execution: what / where / how / done
 * - task-dominion: why now / state effect
 * - task-move-context: project and dependency context
 *
 * It does not invent task truth or specialize presentation for a viewer.
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
