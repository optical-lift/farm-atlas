function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
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
    source: "prerequisite",
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

function linkedObject(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.object_id ?? value.id);
  if (!id) return null;
  return {
    id,
    key: text(value.object_key),
    label: text(value.object_label) || "Farm object",
    objectType: text(value.object_type) || "object",
    objectMode: text(value.object_mode) || null,
    lifeStatus: text(value.life_status) || null,
    source: "task_object",
    resolution: "resolved",
  };
}

function resourceRequirement(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.requirement_id ?? value.id);
  if (!id) return null;

  const label = text(value.resource_label)
    || text(value.resource_key)
    || text(value.resource_category)
    || "Required resource";
  const restockNeeded = value.restock_needed === true;
  const resourceStatus = normalizeKey(value.resource_status);
  const requirementStatus = normalizeKey(value.status);
  const warningStatus = ["missing", "unavailable", "out", "out_of_stock", "blocked"].includes(resourceStatus)
    || ["missing", "blocked"].includes(requirementStatus)
    || restockNeeded;

  return {
    id,
    role: text(value.requirement_role) || "resource",
    label,
    resourceKey: text(value.resource_key) || null,
    resourceType: text(value.resource_type) || null,
    resourceCategory: text(value.resource_category) || null,
    quantityNeeded: typeof value.quantity_needed === "number" ? value.quantity_needed : null,
    unit: text(value.unit) || null,
    requirementStatus: text(value.status) || "required",
    resourceStatus: text(value.resource_status) || null,
    quantityAvailable: typeof value.resource_quantity === "number" ? value.resource_quantity : null,
    resourceUnit: text(value.resource_unit) || null,
    note: text(value.note) || null,
    conditionNotes: text(value.condition_notes) || null,
    restockNeeded,
    source: "resource_requirement",
    resolution: warningStatus ? "warning" : "resolved",
  };
}

function expectedRequirements(task, actualResources) {
  const templates = Array.isArray(task?.action_templates) ? task.action_templates : [];
  const actualKeys = new Set(actualResources.map((item) => normalizeKey(item.resourceKey)).filter(Boolean));
  const actualCategories = new Set(actualResources.map((item) => normalizeKey(item.resourceCategory)).filter(Boolean));
  const expected = [];

  for (const template of templates) {
    for (const key of stringList(template?.required_resource_keys)) {
      const normalized = normalizeKey(key);
      if (!normalized || actualKeys.has(normalized)) continue;
      expected.push({
        key,
        label: key.replaceAll("_", " "),
        kind: "resource_key",
        templateKey: text(template?.template_key) || null,
        source: "action_template",
        resolution: "missing",
      });
    }
    for (const category of stringList(template?.required_resource_categories)) {
      const normalized = normalizeKey(category);
      if (!normalized || actualCategories.has(normalized)) continue;
      expected.push({
        key: category,
        label: category.replaceAll("_", " "),
        kind: "resource_category",
        templateKey: text(template?.template_key) || null,
        source: "action_template",
        resolution: "missing",
      });
    }
  }

  const seen = new Set();
  return expected.filter((item) => {
    const key = `${item.kind}:${normalizeKey(item.key)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacyCapacityRequirements(task) {
  const raw = task?.metadata?.capacity_requirements;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const label = text(item.label ?? item.capacity_label ?? item.pool_label);
      if (!label) return null;
      return {
        id: text(item.id ?? item.capacity_requirement_id) || `legacy-capacity-${index + 1}`,
        label,
        poolKey: text(item.pool_key ?? item.capacity_pool_key) || null,
        requiredQuantity: typeof item.required_quantity === "number" ? item.required_quantity : null,
        unit: text(item.unit) || null,
        source: "legacy_metadata",
        resolution: text(item.resolution) || "warning",
      };
    })
    .filter(Boolean);
}

function legacyChecklist(task) {
  const raw = task?.metadata?.execution_checklist;
  return stringList(raw).map((label, index) => ({
    id: `legacy-checklist-${index + 1}`,
    label,
    source: "legacy_metadata",
  }));
}

function unresolvedItems({ task, expected, resources, capacity, waitingOn }) {
  const unresolved = [];

  if (text(task?.blocker_text)) {
    unresolved.push({
      kind: "blocker",
      label: text(task.blocker_text),
      source: "task",
      resolution: "blocked",
    });
  }

  for (const item of expected) {
    unresolved.push({
      kind: "resource_requirement",
      label: item.label,
      source: item.source,
      resolution: "missing",
    });
  }

  for (const item of resources.filter((resource) => resource.resolution === "warning")) {
    unresolved.push({
      kind: "resource_requirement",
      label: item.label,
      source: item.source,
      resolution: "warning",
    });
  }

  for (const item of capacity.filter((requirement) => requirement.resolution !== "resolved")) {
    unresolved.push({
      kind: "capacity_requirement",
      label: item.label,
      source: item.source,
      resolution: item.resolution,
    });
  }

  for (const item of waitingOn.filter((dependencyItem) => dependencyItem.status !== dependencyItem.requiredStatus)) {
    unresolved.push({
      kind: "prerequisite",
      label: item.title,
      source: "prerequisite",
      resolution: item.holdMode === "blocking" ? "blocked" : "warning",
    });
  }

  return unresolved;
}

function readiness(task, unresolved) {
  if (text(task?.status).toLowerCase() === "blocked" || unresolved.some((item) => item.resolution === "blocked")) {
    return { status: "blocked", unresolvedCount: unresolved.length };
  }
  if (unresolved.some((item) => item.resolution === "missing")) {
    return { status: "incomplete", unresolvedCount: unresolved.length };
  }
  if (unresolved.some((item) => item.resolution === "warning")) {
    return { status: "warning", unresolvedCount: unresolved.length };
  }
  return { status: "ready", unresolvedCount: 0 };
}

export function assembleTaskMoveCore({ task, execution, dominion, moveContext }) {
  const taskId = text(task?.task_id ?? task?.id);
  if (!taskId) throw new Error("TaskMoveAssembly requires a task id.");

  const title = text(task?.title) || text(execution?.doText) || "Task";
  const route = text(dominion?.route) || "general";
  const objects = (Array.isArray(task?.objects) ? task.objects : []).map(linkedObject).filter(Boolean);
  const resources = (Array.isArray(task?.resource_requirements) ? task.resource_requirements : [])
    .map(resourceRequirement)
    .filter(Boolean);
  const expected = expectedRequirements(task, resources);
  const capacity = legacyCapacityRequirements(task);
  const context = moveContext && typeof moveContext === "object" ? moveContext : {};
  const waitingOn = (Array.isArray(context.waitingOn) ? context.waitingOn : []).map(dependency).filter(Boolean);
  const unlocks = (Array.isArray(context.unlocks) ? context.unlocks : []).map(dependency).filter(Boolean);
  const projects = (Array.isArray(context.projects) ? context.projects : []).map(project).filter(Boolean);
  const unresolved = unresolvedItems({ task, expected, resources, capacity, waitingOn });

  const currentTruth = text(task?.metadata?.current_truth) || null;
  const resultingTruth = text(task?.metadata?.after_truth)
    || text(task?.metadata?.resulting_truth)
    || null;

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
    transition: {
      currentTruth,
      action: text(execution?.doText) || text(dominion?.instruction) || title,
      resultingTruth,
      source: currentTruth || resultingTruth ? "task" : "unresolved",
    },
    execution: {
      what: text(execution?.doText) || text(dominion?.instruction) || title,
      where: text(execution?.placeText) || text(dominion?.placeLabel) || "Elm Farm",
      how: stringList(execution?.howLines),
      doneWhen: text(execution?.doneWhen) || "The requested result is recorded.",
      details: text(execution?.details) || null,
      dueLabel: text(execution?.dueLabel) || text(dominion?.dueLabel) || "Open date",
      provenance: {
        what: text(task?.metadata?.execution_do) ? "legacy_metadata" : "derived",
        where: text(task?.metadata?.execution_place) ? "legacy_metadata" : "derived",
        how: task?.metadata?.execution_how ? "legacy_metadata" : "derived",
        doneWhen: text(task?.metadata?.execution_done_when) ? "legacy_metadata" : "derived",
      },
    },
    linkedObjects: objects,
    requirements: {
      resources,
      expected,
      capacity,
      prerequisites: waitingOn,
    },
    checklist: legacyChecklist(task),
    context: {
      projects,
      unlocks,
      whyNow: text(dominion?.whyNow) || null,
      stateEffect: text(dominion?.stateEffect) || null,
    },
    unresolved,
    readiness: readiness(task, unresolved),
  };
}
