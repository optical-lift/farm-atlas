function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function dependency(value) {
  if (!value || typeof value !== "object") return null;
  const taskId = text(value.taskId ?? value.task_id);
  if (!taskId) return null;
  return {
    taskId,
    title: text(value.title) || "Task",
    status: text(value.status) || "open",
    assigneeName: text(value.assigneeName ?? value.assignee_name) || "Farm Team",
    requiredStatus: text(value.requiredStatus ?? value.required_status) || "done",
    holdMode: text(value.holdMode ?? value.hold_mode) || "blocking",
  };
}

function project(value) {
  if (!value || typeof value !== "object") return null;
  const projectId = text(value.projectId ?? value.project_id);
  if (!projectId) return null;
  return {
    projectId,
    projectKey: text(value.projectKey ?? value.project_key),
    title: text(value.title) || "Project",
    portfolioType: text(value.portfolioType ?? value.portfolio_type),
    targetDate: text(value.targetDate ?? value.target_date) || null,
    linkRole: text(value.linkRole ?? value.link_role) || "task",
    path: Array.isArray(value.path)
      ? value.path
          .map((node) => {
            if (!node || typeof node !== "object") return null;
            const nodeId = text(node.projectId ?? node.project_id);
            if (!nodeId) return null;
            return {
              projectId: nodeId,
              projectKey: text(node.projectKey ?? node.project_key),
              title: text(node.title) || "Project",
              portfolioType: text(node.portfolioType ?? node.portfolio_type),
            };
          })
          .filter(Boolean)
      : [],
  };
}

function dependencies(value) {
  return Array.isArray(value) ? value.map(dependency).filter(Boolean) : [];
}

function projects(value) {
  return Array.isArray(value) ? value.map(project).filter(Boolean) : [];
}

export function assembleTaskMoveCore({ task, execution, dominion, moveContext }) {
  const taskId = text(task?.task_id ?? task?.id);
  if (!taskId) throw new Error("TaskMoveAssembly requires a task id.");

  const title = text(task?.title) || text(execution?.doText) || "Task";
  const route = text(dominion?.route) || "general";
  const how = list(execution?.howLines);
  const context = moveContext && typeof moveContext === "object" ? moveContext : {};

  return {
    version: 1,
    task: {
      id: taskId,
      title,
      taskType: text(task?.task_type) || "general",
      status: text(task?.status) || "open",
      priority: text(task?.priority) || "normal",
      dueDate: text(task?.due_date) || null,
      route,
      workClass: text(task?.work_class) || null,
      updatedAt: text(task?.updated_at) || null,
    },
    move: {
      what: text(execution?.doText) || text(dominion?.instruction) || title,
      where: text(execution?.placeText) || text(dominion?.placeLabel) || "Elm Farm",
      how,
      doneWhen: text(execution?.doneWhen) || "The requested result is recorded.",
      details: text(execution?.details) || null,
      dueLabel: text(execution?.dueLabel) || text(dominion?.dueLabel) || "Open date",
    },
    context: {
      whyNow: text(dominion?.whyNow) || null,
      stateEffect: text(dominion?.stateEffect) || null,
      blocker: text(task?.blocker_text) || null,
      projects: projects(context.projects),
      waitingOn: dependencies(context.waitingOn),
      unlocks: dependencies(context.unlocks),
    },
  };
}
