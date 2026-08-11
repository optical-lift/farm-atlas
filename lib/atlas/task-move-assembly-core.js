function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function uniqueFacts(facts) {
  const seen = new Set();
  return facts.filter((fact) => {
    const key = `${fact.provenance}:${normalizeKey(fact.label)}`;
    if (!fact.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fact(label, provenance, status = "resolved", extra = {}) {
  return { label: text(label), status, provenance, ...extra };
}

function metadataList(metadata, keys) {
  for (const key of keys) {
    const values = stringList(metadata?.[key]);
    if (values.length) return values;
  }
  return [];
}

function objectStateFacts(task) {
  const facts = [];
  for (const object of Array.isArray(task?.objects) ? task.objects : []) {
    const metadata = object?.state_metadata && typeof object.state_metadata === "object"
      ? object.state_metadata
      : {};
    const labels = metadataList(metadata, ["current_truth", "current_state", "current_state_summary", "state_summary"]);
    for (const label of labels) {
      facts.push(fact(label, "task_object", "resolved", {
        sourceId: text(object?.object_id) || null,
        sourceTable: "task_objects",
      }));
    }
  }
  return facts;
}

function currentFacts(task) {
  const objectFacts = objectStateFacts(task);
  if (objectFacts.length) return uniqueFacts(objectFacts);
  const labels = metadataList(task?.metadata, [
    "current_truth",
    "current_state",
    "current_state_summary",
    "execution_current_state",
    "starting_state",
  ]);
  if (labels.length) return labels.map((label) => fact(label, "legacy_metadata"));
  return [fact("Current farm state not resolved", "missing", "missing")];
}

function afterFacts(task) {
  const labels = metadataList(task?.metadata, [
    "after_truth",
    "resulting_truth",
    "target_state",
    "target_state_summary",
    "completion_condition",
    "done_condition",
    "condition_target",
  ]);
  if (labels.length) return labels.map((label) => fact(label, "legacy_metadata"));
  const doneWhen = text(task?.metadata?.execution_done_when);
  if (doneWhen) return [fact(doneWhen, "legacy_metadata")];
  return [fact("Resulting farm state not resolved", "missing", "missing")];
}

function moveFact(label, provenance) {
  if (text(label)) return fact(label, provenance);
  return fact("Move not resolved", "missing", "missing");
}

function displayProvenance(task, key, fallback = "derived") {
  return text(task?.metadata?.[key]) ? "legacy_metadata" : fallback;
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
    provenance: "task_object",
  };
}

function classifyRequirement(value) {
  const joined = [
    value?.kind,
    value?.requirement_role,
    value?.resource_type,
    value?.resource_category,
    value?.resource_key,
    value?.resource_label,
    value?.label,
  ].map(normalizeKey).filter(Boolean).join(" ");

  if (/prereq|waiting_on/.test(joined)) return "prerequisite";
  if (/depend|blocker/.test(joined)) return "dependency";
  if (/capacity|position|slot|light_space|lit_space/.test(joined)) return "capacity";
  if (/destination|target_bed|target_location|receiving/.test(joined)) return "destination";
  if (/source|origin|from_location/.test(joined)) return "source";
  if (/medium|media|potting_mix|soil|compost/.test(joined)) return "medium";
  if (/container|tray|pot|bucket|flat/.test(joined)) return "container";
  if (/method|spacing|height|depth|target_height|pattern/.test(joined)) return "method";
  return "resource";
}

function requirementStatus(value, kind) {
  const status = normalizeKey(value?.status);
  const resourceStatus = normalizeKey(value?.resource_status);
  const resolution = normalizeKey(value?.resolution);
  const needed = typeof value?.quantity_needed === "number"
    ? value.quantity_needed
    : typeof value?.required_quantity === "number" ? value.required_quantity : null;
  const available = typeof value?.resource_quantity === "number"
    ? value.resource_quantity
    : typeof value?.quantity_available === "number" ? value.quantity_available : null;

  if (resolution === "resolved" || status === "ready" || status === "resolved") {
    if (needed !== null && available !== null && available < needed) return "blocked";
    if (["missing", "unavailable", "out", "out_of_stock", "blocked"].includes(resourceStatus)) return "blocked";
    return "resolved";
  }
  if (["blocked", "missing", "unavailable", "out", "out_of_stock"].includes(resolution)) {
    return resolution === "missing" ? "missing" : "blocked";
  }
  if (["blocked", "missing"].includes(status)) return status;
  if (["missing", "unavailable", "out", "out_of_stock", "blocked"].includes(resourceStatus)) return "blocked";
  if (needed !== null && available !== null && available < needed) return "blocked";
  if (value?.restock_needed === true) return "warning";
  if (kind === "capacity" && resolution !== "resolved") return "blocked";
  if (status === "optional") return "resolved";
  if (resourceStatus === "available" || (needed !== null && available !== null && available >= needed)) return "resolved";
  return "warning";
}

function requirementFromResource(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.requirement_id ?? value.id);
  if (!id) return null;
  const label = text(value.resource_label) || text(value.resource_key) || text(value.resource_category) || "Required resource";
  const kind = classifyRequirement(value);
  return {
    id,
    kind,
    label,
    required: normalizeKey(value.status) !== "optional",
    quantity: typeof value.quantity_needed === "number" ? value.quantity_needed : null,
    unit: text(value.unit) || null,
    availableQuantity: typeof value.resource_quantity === "number" ? value.resource_quantity : null,
    availableUnit: text(value.resource_unit) || null,
    resourceKey: text(value.resource_key) || null,
    resourceCategory: text(value.resource_category) || null,
    note: text(value.note) || null,
    conditionNotes: text(value.condition_notes) || null,
    provenance: "resource_requirement",
    status: requirementStatus(value, kind),
  };
}

function expectedRequirements(task, actualRequirements) {
  const templates = Array.isArray(task?.action_templates) ? task.action_templates : [];
  const actualKeys = new Set(actualRequirements.map((item) => normalizeKey(item.resourceKey)).filter(Boolean));
  const actualCategories = new Set(actualRequirements.map((item) => normalizeKey(item.resourceCategory)).filter(Boolean));
  const output = [];

  for (const template of templates) {
    for (const key of stringList(template?.required_resource_keys)) {
      const normalized = normalizeKey(key);
      if (!normalized || actualKeys.has(normalized)) continue;
      output.push({
        id: `template-key:${text(template?.template_key) || "task"}:${normalized}`,
        kind: classifyRequirement({ resource_key: key }),
        label: key.replaceAll("_", " "),
        required: true,
        quantity: null,
        unit: null,
        provenance: "action_template",
        status: "missing",
        templateKey: text(template?.template_key) || null,
      });
    }
    for (const category of stringList(template?.required_resource_categories)) {
      const normalized = normalizeKey(category);
      if (!normalized || actualCategories.has(normalized)) continue;
      output.push({
        id: `template-category:${text(template?.template_key) || "task"}:${normalized}`,
        kind: classifyRequirement({ resource_category: category }),
        label: category.replaceAll("_", " "),
        required: true,
        quantity: null,
        unit: null,
        provenance: "action_template",
        status: "missing",
        templateKey: text(template?.template_key) || null,
      });
    }
  }
  return output;
}

function dependency(value, index) {
  if (!value || typeof value !== "object") return null;
  const taskId = text(value.taskId ?? value.task_id);
  if (!taskId) return null;
  const status = text(value.status) || "open";
  const requiredStatus = text(value.requiredStatus ?? value.required_status) || "done";
  const holdMode = text(value.holdMode ?? value.hold_mode) || "blocking";
  const resolved = normalizeKey(status) === normalizeKey(requiredStatus);
  return {
    id: `prerequisite:${taskId || index + 1}`,
    kind: "prerequisite",
    label: text(value.title) || "Prerequisite task",
    required: true,
    quantity: null,
    unit: null,
    provenance: "prerequisite",
    status: resolved ? "resolved" : holdMode === "blocking" ? "blocked" : "warning",
    taskId,
    assigneeName: text(value.assigneeName ?? value.assignee_name) || "Farm Team",
    requiredStatus,
    holdMode,
  };
}

function legacyStructuredRequirements(task) {
  const metadata = task?.metadata ?? {};
  const output = [];
  const collections = [
    ["move_requirements", null],
    ["capacity_requirements", "capacity"],
    ["destination_requirements", "destination"],
    ["source_requirements", "source"],
    ["method_constraints", "method"],
  ];

  for (const [key, forcedKind] of collections) {
    const raw = metadata?.[key];
    const items = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? [raw.trim()] : [];
    items.forEach((item, index) => {
      const value = typeof item === "string" ? { label: item } : item;
      if (!value || typeof value !== "object") return;
      const label = text(value.label ?? value.capacity_label ?? value.pool_label ?? value.name);
      if (!label) return;
      const kind = forcedKind || classifyRequirement(value);
      const status = typeof item === "string" && kind === "method"
        ? "resolved"
        : requirementStatus(value, kind);
      output.push({
        id: text(value.id ?? value.capacity_requirement_id) || `legacy:${key}:${index + 1}`,
        kind,
        label,
        required: value.required !== false,
        quantity: typeof value.required_quantity === "number"
          ? value.required_quantity
          : typeof value.quantity === "number" ? value.quantity : null,
        unit: text(value.unit) || null,
        provenance: "legacy_metadata",
        status,
        poolKey: text(value.pool_key ?? value.capacity_pool_key) || null,
      });
    });
  }
  return output;
}

function explicitObjectRequirements(task) {
  const metadata = task?.metadata ?? {};
  const objects = Array.isArray(task?.objects) ? task.objects : [];
  const output = [];
  for (const [key, kind] of [["source_object_id", "source"], ["destination_object_id", "destination"]]) {
    const objectId = text(metadata?.[key]);
    if (!objectId) continue;
    const object = objects.find((item) => text(item?.object_id) === objectId);
    output.push({
      id: `${kind}:${objectId}`,
      kind,
      label: text(object?.object_label) || `${kind} object`,
      required: true,
      quantity: null,
      unit: null,
      provenance: object ? "task_object" : "legacy_metadata",
      status: object ? "resolved" : "missing",
      sourceId: objectId,
    });
  }
  return output;
}

function taskBlocker(task) {
  const label = text(task?.blocker_text);
  if (!label) return [];
  return [{
    id: `task-blocker:${normalizeKey(label) || "blocker"}`,
    kind: "dependency",
    label,
    required: true,
    quantity: null,
    unit: null,
    provenance: "task_record",
    status: "blocked",
  }];
}

function dedupeRequirements(requirements) {
  const precedence = {
    task_object: 5,
    resource_requirement: 4,
    prerequisite: 4,
    action_template: 3,
    task_record: 3,
    legacy_metadata: 2,
    derived: 1,
    missing: 0,
  };
  const byKey = new Map();
  for (const item of requirements) {
    const key = `${item.kind}:${normalizeKey(item.label)}:${item.quantity ?? ""}:${normalizeKey(item.unit)}`;
    const existing = byKey.get(key);
    if (!existing || (precedence[item.provenance] ?? 0) > (precedence[existing.provenance] ?? 0)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
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
    path: Array.isArray(value.path) ? value.path : [],
  };
}

function unresolvedItems(spine, requirements) {
  const unresolved = [];
  for (const item of spine.current.filter((item) => item.status !== "resolved")) {
    unresolved.push({ kind: "current", label: item.label, provenance: item.provenance, status: item.status });
  }
  for (const item of [spine.move.action, spine.move.subject, spine.move.workSite].filter(Boolean).filter((item) => item.status !== "resolved")) {
    unresolved.push({ kind: "move", label: item.label, provenance: item.provenance, status: item.status });
  }
  for (const item of spine.after.filter((item) => item.status !== "resolved")) {
    unresolved.push({ kind: "after", label: item.label, provenance: item.provenance, status: item.status });
  }
  for (const item of requirements.filter((item) => item.status !== "resolved")) {
    unresolved.push({ kind: item.kind, label: item.label, provenance: item.provenance, status: item.status });
  }
  return unresolved;
}

function readiness(task, spine, requirements) {
  const requiredBlocked = requirements.some((item) => item.required && ["blocked", "missing"].includes(item.status));
  const taskBlocked = normalizeKey(task?.status) === "blocked";
  const warningRequirement = requirements.some((item) => item.status === "warning");
  const missingMove = [spine.move.action, spine.move.subject].some((item) => item.status === "missing");
  const incompleteTruth = [...spine.current, ...spine.after].some((item) => item.status === "missing");
  const status = taskBlocked || requiredBlocked || missingMove
    ? "blocked"
    : warningRequirement || incompleteTruth ? "warning" : "ready";
  return { status, executable: status !== "blocked", canReachAfter: status !== "blocked" };
}

function checklist(task) {
  return stringList(task?.metadata?.execution_checklist).map((label, index) => ({
    id: `legacy-checklist-${index + 1}`,
    label,
    provenance: "legacy_metadata",
  }));
}

export function assembleTaskMoveCore({ task, execution, display, moveSemantics, moveContext }) {
  const taskId = text(task?.task_id ?? task?.id);
  if (!taskId) throw new Error("TaskMoveAssembly requires a task id.");

  const title = text(task?.title) || text(execution?.doText) || "Task";
  const route = text(display?.route) || text(moveSemantics?.route) || "general";
  const objects = (Array.isArray(task?.objects) ? task.objects : []).map(linkedObject).filter(Boolean);
  const actionLabel = text(display?.action) || text(execution?.doText) || text(moveSemantics?.instruction) || title;
  const subjectLabel = text(display?.subject) || title;
  const workSiteLabel = text(execution?.placeText) || text(display?.location) || text(moveSemantics?.placeLabel) || "Elm Farm";

  const spine = {
    current: currentFacts(task),
    move: {
      action: moveFact(actionLabel, displayProvenance(task, "display_action")),
      subject: moveFact(subjectLabel, displayProvenance(task, "display_subject", objects.length ? "task_object" : "derived")),
      workSite: moveFact(workSiteLabel, displayProvenance(task, "execution_place", objects.length ? "task_object" : "derived")),
    },
    after: afterFacts(task),
  };

  const actualResources = (Array.isArray(task?.resource_requirements) ? task.resource_requirements : [])
    .map(requirementFromResource)
    .filter(Boolean);
  const expected = expectedRequirements(task, actualResources);
  const context = moveContext && typeof moveContext === "object" ? moveContext : {};
  const prerequisites = (Array.isArray(context.waitingOn) ? context.waitingOn : []).map(dependency).filter(Boolean);
  const requirements = dedupeRequirements([
    ...actualResources,
    ...expected,
    ...explicitObjectRequirements(task),
    ...legacyStructuredRequirements(task),
    ...prerequisites,
    ...taskBlocker(task),
  ]);

  const ready = readiness(task, spine, requirements);
  const unresolved = unresolvedItems(spine, requirements);
  const projects = (Array.isArray(context.projects) ? context.projects : []).map(project).filter(Boolean);
  const unlocks = Array.isArray(context.unlocks) ? context.unlocks : [];

  return {
    version: 2,
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
    spine: { ...spine, connection: ready.canReachAfter ? "continuous" : "stops_at_move" },
    requirements,
    linkedObjects: objects,
    execution: {
      what: text(execution?.doText) || title,
      where: workSiteLabel,
      how: stringList(execution?.howLines),
      doneWhen: text(execution?.doneWhen) || "The requested result is recorded.",
      details: text(execution?.details) || null,
      dueLabel: text(execution?.dueLabel) || text(moveSemantics?.dueLabel) || "Open date",
    },
    checklist: checklist(task),
    context: {
      projects,
      unlocks,
      whyNow: text(moveSemantics?.whyNow) || null,
      stateEffect: text(moveSemantics?.stateEffect) || null,
    },
    unresolved,
    readiness: {
      status: ready.status,
      executable: ready.executable,
      unresolvedCount: unresolved.length,
    },
  };
}
