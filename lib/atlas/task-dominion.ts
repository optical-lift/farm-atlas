import type { AtlasTaskCard, AtlasTaskCardObject } from "@/lib/atlas/task-cards-client";
import {
  atlasMetaString,
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasTaskDisplay,
  atlasText,
  type AtlasWorkRouteKey,
} from "@/lib/atlas/task-display";
import {
  formatTendingEffort,
  tendingClock,
  tendingDueLabel,
  tendingStepsToHarvestLabel,
  type TendingBedTrack,
  type TendingGateStatus,
} from "@/lib/atlas/tending-client";

export type TaskDominionStepStatus = TendingGateStatus | "context";

export type TaskDominionStep = {
  key: string;
  label: string;
  status: TaskDominionStepStatus;
};

export type TaskDominionFact = {
  label: string;
  value: string;
};

export type TaskDominionOutcomeLabels = {
  done: string;
  partial: string;
  blocked: string;
};

export type TaskDominionModel = {
  route: AtlasWorkRouteKey;
  familyLabel: string;
  zoneLabel: string;
  placeLabel: string;
  subjectLabel: string;
  actionLabel: string;
  instruction: string;
  dueLabel: string;
  whyNow: string;
  stateEffect: string;
  steps: TaskDominionStep[];
  facts: TaskDominionFact[];
  outcomes: TaskDominionOutcomeLabels;
};

type WorkflowTemplate = {
  before: string;
  current: string;
  after: string;
  why: string;
  effect: string;
  outcomes: TaskDominionOutcomeLabels;
};

const WORKFLOWS: Record<AtlasWorkRouteKey, WorkflowTemplate> = {
  weed: {
    before: "Crop established",
    current: "Weed",
    after: "Stand check",
    why: "The intended planting needs to stay visible and free of competing growth.",
    effect: "The crop becomes readable enough for the next stand or harvest decision.",
    outcomes: { done: "Row clear", partial: "Partly cleared", blocked: "Blocked" },
  },
  plant: {
    before: "Site ready",
    current: "Plant",
    after: "Establishment check",
    why: "The site and plant material are ready for placement.",
    effect: "The planting moves into establishment care.",
    outcomes: { done: "Planted", partial: "Partly planted", blocked: "Blocked" },
  },
  mow: {
    before: "Growth threshold",
    current: "Mow",
    after: "Route check",
    why: "The route has reached its next maintenance pass.",
    effect: "The route returns to maintained condition until the next growth threshold.",
    outcomes: { done: "Route complete", partial: "Partly mowed", blocked: "Blocked" },
  },
  seed: {
    before: "Bed prepared",
    current: "Sow",
    after: "Germination watch",
    why: "The sowing window is active and the prepared space is ready.",
    effect: "The crop enters germination watch.",
    outcomes: { done: "Sown", partial: "Partly sown", blocked: "Blocked" },
  },
  crop_cycle: {
    before: "Previous crop signal",
    current: "Check",
    after: "Next crop gate",
    why: "The crop cycle has reached a decision or observation gate.",
    effect: "Atlas can release the next crop move from the observed state.",
    outcomes: { done: "Check complete", partial: "Partly checked", blocked: "Blocked" },
  },
  harvest: {
    before: "Harvest ready",
    current: "Harvest",
    after: "Post-harvest",
    why: "The crop is in its current harvest window.",
    effect: "The crop moves into post-harvest handling and the next harvest decision.",
    outcomes: { done: "Harvested", partial: "Partly harvested", blocked: "Blocked" },
  },
  build: {
    before: "Need identified",
    current: "Build / prep",
    after: "Verify",
    why: "This preparation move is holding the next work open.",
    effect: "The dependent work can move into verification or release.",
    outcomes: { done: "Move complete", partial: "Partly complete", blocked: "Blocked" },
  },
  venue: {
    before: "Space assessed",
    current: "Prepare",
    after: "Guest-ready check",
    why: "The space is in the current venue-preparation sequence.",
    effect: "The space moves to guest-ready verification.",
    outcomes: { done: "Guest-ready", partial: "Partly ready", blocked: "Blocked" },
  },
  water: {
    before: "Moisture interval",
    current: "Water",
    after: "Moisture check",
    why: "The linked plants or space are due for their next moisture-care pass.",
    effect: "The linked plants move into the next moisture-check interval.",
    outcomes: { done: "Watered", partial: "Partly watered", blocked: "Blocked" },
  },
  propagation: {
    before: "Material ready",
    current: "Propagate",
    after: "Rooting check",
    why: "The propagation cycle is ready for this move.",
    effect: "The material moves into its next rooting or establishment check.",
    outcomes: { done: "Step complete", partial: "Partly complete", blocked: "Blocked" },
  },
};

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstObject(task: AtlasTaskCard) {
  return task.objects.find((object) => object.object_type === "bed") ?? task.objects[0] ?? null;
}

function firstMetadataString(task: AtlasTaskCard, keys: string[]) {
  for (const key of keys) {
    const value = atlasMetaString(task, key);
    if (value) return value;
  }
  return "";
}

function firstTemplateUnlock(task: AtlasTaskCard) {
  for (const template of task.action_templates ?? []) {
    const unlock = template.unlocks?.find((value) => typeof value === "string" && value.trim());
    if (unlock) return unlock.trim();
  }
  return "";
}

function numericMetadata(task: AtlasTaskCard, keys: string[]) {
  for (const key of keys) {
    const value = task.metadata?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  }
  return null;
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "Date not set";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function genericDueLabel(task: AtlasTaskCard) {
  if (!task.due_date) return "Open date";
  const date = new Date(`${task.due_date.slice(0, 10)}T12:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Number.isNaN(date.getTime()) ? null : Math.round((date.getTime() - today.getTime()) / 86400000);
  const label = prettyDate(task.due_date);
  if (days === 0) return `Today · ${label}`;
  if (days === 1) return `Tomorrow · ${label}`;
  return `Due ${label}`;
}

function cropLabel(task: AtlasTaskCard) {
  return firstMetadataString(task, ["crop_variety", "variety", "crop_label", "crop", "main_crop_label"]);
}

function objectStateFact(object: AtlasTaskCardObject | null, route: AtlasWorkRouteKey): TaskDominionFact | null {
  if (!object) return null;
  if (route === "weed" && atlasText(object.weed_pressure)) return { label: "Weed pressure", value: titleCase(atlasText(object.weed_pressure).replaceAll("_", " ")) };
  if (route === "water" && atlasText(object.water_status)) return { label: "Water status", value: titleCase(atlasText(object.water_status).replaceAll("_", " ")) };
  if (route === "venue" && atlasText(object.presentability)) return { label: "Presentability", value: titleCase(atlasText(object.presentability).replaceAll("_", " ")) };
  if (object.decision_required) return { label: "Decision", value: "Required after this move" };
  return null;
}

function whyNow(task: AtlasTaskCard, route: AtlasWorkRouteKey, object: AtlasTaskCardObject | null, placeLabel: string) {
  const explicit = firstMetadataString(task, ["why_now", "why_active", "trigger_reason", "activation_reason", "display_reason"]);
  if (explicit) return explicit;

  if (route === "weed" && atlasText(object?.weed_pressure)) {
    return `${titleCase(atlasText(object?.weed_pressure).replaceAll("_", " "))} weed pressure is recorded on ${placeLabel}.`;
  }
  if (route === "water" && atlasText(object?.water_status)) {
    return `${titleCase(atlasText(object?.water_status).replaceAll("_", " "))} water status is recorded on ${placeLabel}.`;
  }
  if (route === "venue" && atlasText(object?.presentability)) {
    return `${placeLabel} is currently recorded as ${atlasText(object?.presentability).replaceAll("_", " ")}.`;
  }

  return WORKFLOWS[route].why;
}

function stateEffect(task: AtlasTaskCard, route: AtlasWorkRouteKey, track: TendingBedTrack | null) {
  const explicit = firstMetadataString(task, ["state_effect", "completion_effect", "what_this_opens", "unlocks_label"]);
  if (explicit) return explicit;

  const unlock = atlasText(track?.unlockLabel) || firstTemplateUnlock(task) || atlasText(task.unlock_text);
  if (unlock && unlock.toLowerCase() !== "open task") {
    const normalized = unlock.replace(/^opens?\s+/i, "").replace(/[.!]+$/, "");
    return `Completing this move opens ${normalized}.`;
  }

  return WORKFLOWS[route].effect;
}

function boundedTrackSteps(track: TendingBedTrack) {
  const gates = track.gates.filter((gate) => gate.status !== "skipped");
  if (gates.length <= 5) return gates;
  const currentIndex = gates.findIndex((gate) => gate.status === "current" || gate.status === "blocked");
  const anchor = currentIndex >= 0 ? currentIndex : 0;
  const start = Math.max(0, Math.min(anchor - 2, gates.length - 5));
  return gates.slice(start, start + 5);
}

function taskFacts(task: AtlasTaskCard, route: AtlasWorkRouteKey, track: TendingBedTrack | null, object: AtlasTaskCardObject | null) {
  const facts: TaskDominionFact[] = [];
  const add = (label: string, value: string) => {
    if (!value || facts.some((fact) => fact.value === value)) return;
    facts.push({ label, value });
  };

  if (track) {
    add("Clock", tendingClock(track));
    add("Trail", tendingStepsToHarvestLabel(track));
    add("Effort", formatTendingEffort(track.taskEffortMinutes));
  } else {
    add("Due", genericDueLabel(task));
    const minutes = numericMetadata(task, ["task_effort_minutes", "effort_minutes", "estimated_minutes", "duration_minutes"]);
    if (minutes) add("Effort", formatTendingEffort(minutes));
  }

  const state = objectStateFact(object, route);
  if (state) add(state.label, state.value);

  for (const requirement of task.resource_requirements ?? []) {
    const label = atlasText(requirement.resource_label) || atlasText(requirement.resource_category);
    if (label) add("Resource", label);
    if (facts.length >= 4) break;
  }

  return facts.slice(0, 4);
}

export function taskDominionOutcomeLabels(task: AtlasTaskCard) {
  return WORKFLOWS[atlasRouteKeyForTask(task)].outcomes;
}

export function taskDominionModel(task: AtlasTaskCard, track: TendingBedTrack | null, instructionOverride?: string): TaskDominionModel {
  const display = atlasTaskDisplay(task);
  const route = atlasRouteKeyForTask(task);
  const workflow = WORKFLOWS[route];
  const object = firstObject(task);
  const zoneLabel = atlasText(track?.zoneLabel)
    || atlasText(task.zone_label)
    || firstMetadataString(task, ["collection_zone", "display_zone", "location_group"])
    || atlasRouteLabels[route];
  const fallbackPlace = display.location && display.location !== "Elm Farm" ? display.location : display.subject;
  const placeLabel = atlasText(track?.bedLabel) || atlasText(object?.object_label) || fallbackPlace || "Elm Farm";
  const crop = atlasText(track?.cropLabel) || cropLabel(task);
  const subjectLabel = crop || (display.subject !== placeLabel ? display.subject : atlasRouteLabels[route]);
  const instruction = atlasText(instructionOverride)
    || firstMetadataString(task, ["display_instruction", "task_instruction", "current_move"])
    || display.title;

  const steps: TaskDominionStep[] = track
    ? boundedTrackSteps(track).map((gate, index) => ({ key: `${gate.key}:${gate.dueDate ?? index}`, label: gate.label, status: gate.status }))
    : [
      { key: "before", label: workflow.before, status: "context" },
      { key: "current", label: display.action || workflow.current, status: task.status === "blocked" ? "blocked" : "current" },
      { key: "after", label: workflow.after, status: "future" },
    ];

  return {
    route,
    familyLabel: atlasRouteLabels[route],
    zoneLabel,
    placeLabel,
    subjectLabel,
    actionLabel: display.action || workflow.current,
    instruction,
    dueLabel: track ? tendingDueLabel(track.taskDueDate || track.currentGate?.dueDate || task.due_date) : genericDueLabel(task),
    whyNow: whyNow(task, route, object, placeLabel),
    stateEffect: stateEffect(task, route, track),
    steps,
    facts: taskFacts(task, route, track, object),
    outcomes: workflow.outcomes,
  };
}
