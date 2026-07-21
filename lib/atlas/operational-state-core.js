const RISK_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function booleanValue(value) {
  return value === true || value === "true";
}

function riskLevel(value) {
  const candidate = text(value) ?? "low";
  return Object.hasOwn(RISK_ORDER, candidate) ? candidate : "low";
}

function projectObject(row) {
  const source = asRecord(row);
  const cropCycleId = text(source.current_crop_cycle_id);
  const nextTaskId = text(source.next_task_id);
  const nextMaintenanceType = text(source.next_maintenance_type);
  const lastActionDate = text(source.last_action_date);

  return {
    id: text(source.object_id),
    key: text(source.object_key),
    label: text(source.object_label) ?? "Farm object",
    type: text(source.object_type) ?? "area",
    mode: text(source.object_mode),
    sortOrder: numberValue(source.object_sort_order),
    dimensions: {
      lengthFt: numberValue(source.length_ft, null),
      widthFt: numberValue(source.width_ft, null),
      areaSqft: numberValue(source.area_sqft, null),
    },
    guestVisible: booleanValue(source.guest_visible),
    state: {
      lifeStatus: text(source.life_status) ?? "open",
      currentStage: text(source.current_stage) ?? "open",
      weedPressure: text(source.weed_pressure) ?? "unknown",
      waterStatus: text(source.water_status) ?? "unknown",
      presentability: text(source.presentability),
      decisionRequired: booleanValue(source.decision_required),
      harvestConfidence: text(source.harvest_confidence),
    },
    crop: cropCycleId
      ? {
          id: cropCycleId,
          key: text(source.crop_cycle_key),
          label: text(source.crop_label) ?? "Crop",
          variety: text(source.variety),
          stage: text(source.crop_stage),
          lifecycleStatus: text(source.crop_lifecycle_status),
          sownDate: text(source.sown_date),
          plantedDate: text(source.planted_date),
          germinationWindow: {
            start: text(source.expected_germination_start),
            end: text(source.expected_germination_end),
          },
          harvestWindow: {
            start: text(source.expected_harvest_watch_start),
            end: text(source.expected_harvest_watch_end),
          },
          expectedClearDate: text(source.expected_clear_date),
        }
      : null,
    lastAction: lastActionDate
      ? {
          date: lastActionDate,
          label: text(source.last_action_label) ?? "Object updated",
        }
      : null,
    nextAction: {
      source: text(source.next_action_source) ?? "none",
      taskId: nextTaskId,
      label:
        text(source.next_action) ??
        (nextMaintenanceType
          ? `Maintain ${nextMaintenanceType.replaceAll("_", " ")}`
          : null),
      dueDate: text(source.next_action_due) ?? text(source.next_maintenance_date),
      taskStatus: text(source.next_task_status),
      workClass: text(source.next_work_class),
      visibilityScope: text(source.next_task_visibility),
      assignedMembershipId: text(source.assigned_membership_id),
      blocker: text(source.blocker),
      maintenanceType: nextMaintenanceType,
      maintenanceCondition: text(source.next_maintenance_condition),
    },
    maintenance: {
      dueCount: numberValue(source.maintenance_due_count),
      nextDue: text(source.next_maintenance_due),
      maxPriority: numberValue(source.max_maintenance_priority),
      maxRisk: numberValue(source.max_maintenance_risk),
    },
    riskLevel: riskLevel(source.risk_level),
  };
}

function zoneCounts(objects) {
  return {
    objects: objects.length,
    cropped: objects.filter((object) => object.crop).length,
    withNextAction: objects.filter((object) => object.nextAction.label).length,
    blocked: objects.filter((object) => object.nextAction.blocker).length,
    decisionRequired: objects.filter((object) => object.state.decisionRequired).length,
    critical: objects.filter((object) => object.riskLevel === "critical").length,
    high: objects.filter((object) => object.riskLevel === "high").length,
    maintenanceDue: objects.reduce((total, object) => total + object.maintenance.dueCount, 0),
  };
}

function objectSort(left, right) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  const leftRisk = RISK_ORDER[left.riskLevel] ?? 9;
  const rightRisk = RISK_ORDER[right.riskLevel] ?? 9;
  if (leftRisk !== rightRisk) return leftRisk - rightRisk;
  return left.label.localeCompare(right.label);
}

export function buildFarmOperationalState(rows) {
  const sourceRows = Array.isArray(rows) ? rows.map(asRecord) : [];
  const first = sourceRows[0] ?? {};
  const zonesByKey = new Map();

  for (const row of sourceRows) {
    const zoneId = text(row.zone_id);
    const zoneKey = text(row.zone_key) ?? zoneId ?? "unassigned";
    const existing = zonesByKey.get(zoneKey) ?? {
      id: zoneId,
      key: text(row.zone_key),
      label: text(row.zone_label) ?? "Unassigned",
      sortOrder: numberValue(row.zone_sort_order, 999),
      objects: [],
    };

    existing.objects.push(projectObject(row));
    zonesByKey.set(zoneKey, existing);
  }

  const zones = Array.from(zonesByKey.values())
    .map((zone) => {
      zone.objects.sort(objectSort);
      return {
        ...zone,
        counts: zoneCounts(zone.objects),
      };
    })
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.label.localeCompare(right.label);
    });

  const allObjects = zones.flatMap((zone) => zone.objects);

  return {
    farm: {
      id: text(first.farm_id),
      key: text(first.farm_key),
      name: text(first.farm_name) ?? "Farm",
    },
    counts: {
      zones: zones.length,
      ...zoneCounts(allObjects),
    },
    zones,
  };
}
