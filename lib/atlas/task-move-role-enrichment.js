function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function objectRoleKind(role) {
  const value = normalize(role);
  if (["source", "origin", "from", "source_object"].includes(value)) return "source";
  if (["destination", "target", "receiving", "destination_object"].includes(value)) return "destination";
  return null;
}

function resourceMoveRoleKind(role) {
  const value = normalize(role);
  if (value === "container") return "container";
  if (value === "growing_medium") return "medium";
  if (value === "source") return "source";
  if (value === "destination") return "destination";
  if (value === "method") return "method";
  if (value) return "resource";
  return null;
}

function requirementIdentity(item) {
  return `${item?.kind ?? ""}:${normalize(item?.label)}:${item?.sourceId ?? ""}`;
}

/**
 * Enrich a TaskMoveAssembly with canonical semantic roles already present on the
 * task record. This is deliberately post-assembly so the v2 spine stays stable
 * while older task-card fallbacks are migrated.
 *
 * Precedence:
 * - task_resource_requirements.move_role beats heuristic resource classification.
 * - task_objects.role beats execution metadata for source/destination relationships.
 */
export function attachCanonicalMoveRoles(assembly, task) {
  if (!assembly || typeof assembly !== "object") return assembly;

  let requirements = Array.isArray(assembly.requirements)
    ? assembly.requirements.map((item) => ({ ...item }))
    : [];

  const resourceKindsById = new Map();
  for (const row of Array.isArray(task?.resource_requirements) ? task.resource_requirements : []) {
    const id = text(row?.requirement_id ?? row?.id);
    const kind = resourceMoveRoleKind(row?.move_role);
    if (id && kind) resourceKindsById.set(id, kind);
  }

  requirements = requirements.map((item) => {
    const kind = resourceKindsById.get(text(item?.id));
    if (!kind || item?.provenance !== "resource_requirement") return item;
    return { ...item, kind };
  });

  const canonicalObjectRequirements = [];
  const objectRolesById = new Map();
  for (const object of Array.isArray(task?.objects) ? task.objects : []) {
    const objectId = text(object?.object_id ?? object?.id);
    if (!objectId) continue;
    const role = text(object?.role) || null;
    objectRolesById.set(objectId, role);
    const kind = objectRoleKind(role);
    if (!kind) continue;
    canonicalObjectRequirements.push({
      id: `${kind}:${objectId}`,
      kind,
      label: text(object?.object_label) || `${kind} object`,
      required: true,
      quantity: null,
      unit: null,
      provenance: "task_object",
      status: "resolved",
      sourceId: objectId,
    });
  }

  for (const canonical of canonicalObjectRequirements) {
    requirements = requirements.filter((item) => !(
      item?.provenance === "legacy_metadata"
      && item?.kind === canonical.kind
      && normalize(item?.label) === normalize(canonical.label)
    ));
    const exists = requirements.some((item) => requirementIdentity(item) === requirementIdentity(canonical));
    if (!exists) requirements.push(canonical);
  }

  const requirementKindByLabel = new Map(
    requirements.map((item) => [`${normalize(item?.label)}:${item?.provenance ?? ""}`, item?.kind]),
  );
  const unresolved = Array.isArray(assembly.unresolved)
    ? assembly.unresolved.map((item) => {
        const kind = requirementKindByLabel.get(`${normalize(item?.label)}:${item?.provenance ?? ""}`);
        return kind ? { ...item, kind } : item;
      })
    : [];

  const linkedObjects = Array.isArray(assembly.linkedObjects)
    ? assembly.linkedObjects.map((item) => ({
        ...item,
        role: objectRolesById.has(text(item?.id)) ? objectRolesById.get(text(item?.id)) : null,
      }))
    : [];

  return {
    ...assembly,
    requirements,
    unresolved,
    linkedObjects,
  };
}
