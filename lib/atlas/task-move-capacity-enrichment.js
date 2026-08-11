function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeUnit(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = text(item.question_id ?? item.id);
      const label = text(item.question_text ?? item.label);
      if (!id || !label) return null;
      return {
        id,
        key: text(item.question_key) || null,
        kind: text(item.question_kind) || null,
        label,
        status: text(item.status) || "open",
        blockerRole: text(item.blocker_role) || "calculation_input",
        answerValue: numberOrNull(item.answer_value),
        answerUnit: text(item.answer_unit) || null,
        answerText: text(item.answer_text) || null,
      };
    })
    .filter(Boolean);
}

function canonicalCapacityRequirement(row) {
  if (!row || typeof row !== "object") return null;
  const id = text(row.requirement_id ?? row.id);
  const poolKey = text(row.pool_key);
  const label = text(row.pool_label);
  if (!id || !poolKey || !label) return null;

  const requirementStatus = text(row.requirement_status).toLowerCase() || "required";
  const capacityStatus = text(row.capacity_status).toLowerCase() || "unconfirmed";
  const quantity = numberOrNull(row.quantity_needed);
  const totalCapacity = numberOrNull(row.total_capacity);
  const required = !["optional", "waived"].includes(requirementStatus);
  const questions = normalizeQuestions(row.questions);
  const requirementUnit = text(row.unit) || null;
  const poolUnit = text(row.pool_unit) || null;
  const unitCompatible = requirementUnit && poolUnit
    ? normalizeUnit(requirementUnit) === normalizeUnit(poolUnit)
    : null;

  let status = "warning";
  if (requirementStatus === "waived" || requirementStatus === "satisfied") {
    status = "resolved";
  } else if (requirementStatus === "blocked") {
    status = "blocked";
  } else if (unitCompatible === false) {
    // Unlike units are a known incompatibility, not merely missing information.
    status = required ? "blocked" : "warning";
  } else if (
    capacityStatus === "confirmed"
    && totalCapacity !== null
    && quantity !== null
    && totalCapacity < quantity
  ) {
    // Only a known, comparable shortfall is allowed to stop a required move.
    status = required ? "blocked" : "warning";
  } else if (capacityStatus !== "confirmed" || totalCapacity === null || quantity === null) {
    // No answer is not the same thing as no capacity. Keep unknown capacity visible
    // as a check without inventing a blocker from missing confirmation.
    status = "warning";
  } else {
    // A confirmed pool total is not the same thing as currently available capacity.
    // Until Atlas has a trustworthy occupancy/reservation answer, keep it visible as a warning.
    status = "warning";
  }

  return {
    id,
    kind: "capacity",
    label,
    required,
    quantity,
    unit: requirementUnit,
    provenance: "capacity_pool",
    status,
    poolKey,
    sourceId: id,
    note: text(row.note) || null,
    capacityRole: text(row.capacity_role) || "destination",
    capacityStatus,
    totalCapacity,
    totalUnit: poolUnit,
    unitCompatible,
    questions,
  };
}

function readinessRank(status) {
  if (status === "blocked") return 3;
  if (status === "warning") return 2;
  return 1;
}

export function attachCanonicalCapacityRequirements(assembly, rows) {
  if (!assembly || typeof assembly !== "object") return assembly;
  const canonical = (Array.isArray(rows) ? rows : []).map(canonicalCapacityRequirement).filter(Boolean);
  if (!canonical.length) return assembly;

  const requirements = Array.isArray(assembly.requirements) ? [...assembly.requirements] : [];
  const existingKeys = new Set(requirements.map((item) => `${item.kind}:${item.sourceId ?? item.poolKey ?? item.id}`));
  for (const item of canonical) {
    const key = `${item.kind}:${item.sourceId ?? item.poolKey ?? item.id}`;
    if (!existingKeys.has(key)) {
      requirements.push(item);
      existingKeys.add(key);
    }
  }

  const unresolved = Array.isArray(assembly.unresolved) ? [...assembly.unresolved] : [];
  const unresolvedKeys = new Set(unresolved.map((item) => `${item.kind}:${item.label}:${item.provenance}`));
  for (const item of canonical.filter((requirement) => requirement.status !== "resolved")) {
    const unresolvedItem = {
      kind: "capacity",
      label: item.label,
      provenance: "capacity_pool",
      status: item.status,
    };
    const key = `${unresolvedItem.kind}:${unresolvedItem.label}:${unresolvedItem.provenance}`;
    if (!unresolvedKeys.has(key)) {
      unresolved.push(unresolvedItem);
      unresolvedKeys.add(key);
    }
  }

  const requiredBlocked = canonical.some((item) => item.required && item.status === "blocked");
  const hasWarning = canonical.some((item) => item.status === "warning");
  const currentReadiness = assembly.readiness?.status ?? "ready";
  let nextReadiness = currentReadiness;
  if (requiredBlocked) nextReadiness = "blocked";
  else if (hasWarning && readinessRank(nextReadiness) < readinessRank("warning")) nextReadiness = "warning";

  return {
    ...assembly,
    requirements,
    unresolved,
    readiness: {
      status: nextReadiness,
      executable: nextReadiness !== "blocked",
      unresolvedCount: unresolved.length,
    },
    spine: {
      ...assembly.spine,
      connection: requiredBlocked || assembly.spine?.connection === "stops_at_move"
        ? "stops_at_move"
        : "continuous",
    },
  };
}
