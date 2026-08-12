import type {
  AtlasTaskCard,
  AtlasTaskCardMetadata,
  AtlasTaskCardObject,
  AtlasTaskCardResourceRequirement,
  AtlasTaskCardTemplate,
} from "@/lib/atlas/task-cards-client";
import type { TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";

/**
 * Farm Hand presentation is an execution packet, not a serialized copy of
 * everything Atlas/Owner knows about the task. Only keys in this set may cross
 * the worker presentation boundary.
 *
 * If worker-facing information is genuinely needed and does not belong in one of
 * the structured execution fields, author it deliberately as `worker_context`.
 */
export const WORKER_EXECUTION_METADATA_KEYS = new Set([
  // Stable identity used by a few execution instruments.
  "task_key",
  "seed_lot_id",

  // Execution identity + human display.
  "display_title",
  "display_action",
  "display_subject",
  "display_location",
  "display_detail",
  "display_instruction",
  "personal_display_label",
  "execution_do",
  "execution_place",
  "execution_how",
  "execution_done_when",
  "execution_details",
  "worker_context",
  "worker_result_label",
  "worker_result_lines",
  "detail_lines",
  "detail_heading",

  // Operation / route classification needed by worker renderers.
  "task_style",
  "work_route",
  "work_rhythm",
  "work_collection_key",
  "operation_class",
  "collection_zone",
  "collection_label",
  "window_key",
  "work_window_key",
  "daypart",
  "work_order_anchor",
  "day_work_order",
  "owner_day_window_override",
  "day_placement",
  "canonical_due_date",

  // Crop / quantity / spacing facts used to execute the move.
  "crop_label",
  "crop_variety",
  "variety",
  "crop_profile_id",
  "crop_profile_stable_key",
  "crop_cycle_id",
  "crop_cycle_key",
  "container_kind",
  "quantity_unit",
  "target_quantity",
  "batch_item_count",
  "batch_total_quantity",
  "batch_quantity_unit",
  "rows_per_3ft_bed",
  "in_row_spacing_in",
  "plant_spacing_lines",
  "target_depth_inches",
  "target_height_inches",
  "target_cut_height_inches",
  "source_object_id",
  "destination_object_id",
  "move_requirements",
  "capacity_requirements",
  "destination_requirements",
  "source_requirements",
  "method_constraints",

  // Recurrence provenance that distinguishes one overdue occurrence from a new
  // recurrence. This is schedule identity, not Owner reasoning.
  "weekday",
  "repeat_rule",
  "repeat_interval_days",
  "task_series_key",
  "engine_instance_key",
  "planned_occurrence_id",

  // Worker checklist / task-detail routing.
  "checklist_status",
  "checklist_mode",
  "checklist_heading",
  "checklist_label",
  "step_order",
  "execution_checklist_template_key",
  "execution_checklist_title",
  "execution_checklist_kicker",
  "execution_checklist_completion_label",
  "network_outreach_master_task",
  "network_input_research",
  "network_input_master_task",
  "buyer_outreach_mode",
  "contractor_service_status",
  "decision_selector_key",
  "decision_question",
  "decision_options",
  "project_pull_item_id",
  "requires_transplant_readiness_check",
  "weed_card_id",
  "weed_pass_id",
  "seed_inventory_recount",

  // Worker contact / script data for calling and outreach tasks. Business name,
  // phone, address and checklist order are execution facts; relationship status,
  // buyer history, volume strategy and management notes remain outside the packet.
  "contact_name",
  "contact_phone",
  "phone",
  "phone_number",
  "business_name",
  "business_phone",
  "business_address",
  "call_script",
  "outreach_script",
  "worker_script",
  "script",
  "result_options",
  "next_batch_task_key",

  // Explicit protection/execution flags may be used by the renderer. Strategic
  // damage analysis remains outside the packet.
  "deer_protection_relevant",
]);

function workerMetadata(metadata: AtlasTaskCardMetadata | null): AtlasTaskCardMetadata | null {
  if (!metadata) return null;
  const output: AtlasTaskCardMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!WORKER_EXECUTION_METADATA_KEYS.has(key)) continue;
    if (key === "day_placement" && value && typeof value === "object" && !Array.isArray(value)) {
      const placement = value as Record<string, unknown>;
      output[key] = {
        serviceDate: placement.serviceDate,
        dayWindow: placement.dayWindow,
        sortOrder: placement.sortOrder,
        placementSource: placement.placementSource,
      };
      continue;
    }
    output[key] = value;
  }
  return output;
}

function workerObject(object: AtlasTaskCardObject): AtlasTaskCardObject {
  return {
    object_id: object.object_id,
    object_key: object.object_key,
    object_label: object.object_label,
    object_type: object.object_type,
    object_mode: object.object_mode,
    life_status: null,
    weed_pressure: null,
    water_status: null,
    last_touched_at: null,
    last_weeded_at: null,
    last_watered_at: null,
    last_checked_at: null,
    decision_required: null,
    presentability: null,
    state_metadata: null,
  };
}

function workerResourceRequirement(requirement: AtlasTaskCardResourceRequirement): AtlasTaskCardResourceRequirement {
  return {
    ...requirement,
    // Free-form requirement notes can contain management rationale. The worker
    // receives canonical resource identity, quantity and availability only.
    note: null,
    condition_notes: null,
  };
}

function workerTemplate(template: AtlasTaskCardTemplate): AtlasTaskCardTemplate {
  return {
    template_id: template.template_id,
    template_key: template.template_key,
    template_label: template.template_label,
    action_type: template.action_type,
    required_resource_categories: template.required_resource_categories,
    optional_resource_categories: template.optional_resource_categories,
    required_resource_keys: template.required_resource_keys,
    optional_resource_keys: template.optional_resource_keys,
    creates_follow_up_task_types: [],
    hard_parts: [],
    unlocks: [],
    card_language: null,
  };
}

/**
 * Produce the only task-card shape that a Farm Hand client should receive for
 * ordinary execution. Owner strategy and provenance stay server-side.
 */
export function workerExecutionTaskCard(task: AtlasTaskCard): AtlasTaskCard {
  return {
    ...task,
    unlock_text: null,
    note: null,
    generated_from: null,
    generated_from_id: null,
    metadata: workerMetadata(task.metadata),
    task_logs: [],
    task_outcomes: [],
    task_transitions: [],
    objects: (task.objects ?? []).map(workerObject),
    resource_requirements: (task.resource_requirements ?? []).map(workerResourceRequirement),
    action_templates: (task.action_templates ?? []).map(workerTemplate),
    move_context: task.move_context ? {
      projects: [],
      unlocks: [],
      waitingOn: task.move_context.waitingOn ?? [],
    } : null,
  };
}

export function workerExecutionTaskCards(tasks: AtlasTaskCard[]) {
  return tasks.map(workerExecutionTaskCard);
}

/**
 * Task Move is assembled from the full canonical graph on the server, then
 * narrowed for the worker. Requirements and execution instructions survive;
 * Owner reasoning and rich current-state commentary do not.
 */
export function workerExecutionTaskMove(assembly: TaskMoveAssembly): TaskMoveAssembly {
  return {
    ...assembly,
    spine: {
      ...assembly.spine,
      // Current-state facts can contain management observations (damage analysis,
      // tradeoffs, reset rationale). They are not worker-visible by default.
      current: [],
    },
    requirements: assembly.requirements.map((requirement) => ({
      ...requirement,
      note: null,
      conditionNotes: null,
    })),
    linkedObjects: assembly.linkedObjects.map((object) => ({
      ...object,
      lifeStatus: null,
    })),
    execution: {
      ...assembly.execution,
      // Free-form details are commonly sourced from task.note. Worker prose must
      // instead be deliberately authored in execution_how / worker_context.
      details: null,
    },
    context: {
      projects: [],
      unlocks: [],
      whyNow: null,
      stateEffect: null,
    },
  };
}
