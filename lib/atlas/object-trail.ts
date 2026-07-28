import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import type {
  AtlasObjectCropCycle,
  AtlasObjectTimelineEvent,
  AtlasObjectWorkbenchObject,
  AtlasOperationalTimeline,
  AtlasOperationalTimelineItem,
} from "@/lib/atlas/object-workbench-client";
import type {
  AtlasRegistryObject,
  AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";
import {
  atlasTrailCurrentNode,
  type AtlasTrailContext,
  type AtlasTrailNode,
  type AtlasTrailNodeStatus,
} from "@/lib/atlas/trail";

const EVENT_LABELS: Record<string, string> = {
  observed: "Observed",
  checked: "Checked",
  weeded: "Weeded",
  watered: "Watered",
  sowed: "Sown",
  planted: "Planted",
  germinated: "Germinated",
  pinched: "Pinched",
  bloom_started: "Bloom started",
  harvested: "Harvested",
  maintained: "Maintained",
  cleared: "Cleared",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readable(value: string | null | undefined) {
  return text(value).replaceAll("_", " ");
}

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function taskHref(taskId: string, objectKey: string) {
  const returnTo = `/objects/${objectKey}`;
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function itemIdentity(item: AtlasOperationalTimelineItem) {
  return item.taskId
    || item.eventId
    || `${item.kind}:${item.cropCycleId ?? "object"}:${item.action}:${item.subject}:${item.startDate ?? "current"}`;
}

function itemLabel(item: AtlasOperationalTimelineItem) {
  const action = text(item.action);
  const subject = text(item.subject);
  if (!action) return subject || "Current state";
  if (!subject || action.toLowerCase().includes(subject.toLowerCase())) return action;
  return `${action} · ${subject}`;
}

function itemNodeKind(item: AtlasOperationalTimelineItem) {
  const value = `${item.kind} ${item.action}`.toLowerCase();
  if (value.includes("decision") || item.kind === "clear_window") return "decision";
  if (/water|weed|check|inspect|maintain|care/.test(value)) return "care_pulse";
  return "milestone";
}

function futureItems(timeline: AtlasOperationalTimeline) {
  const seen = new Set<string>();
  return [...timeline.next, ...timeline.later]
    .filter((item) => {
      const key = itemIdentity(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftTask = left.kind === "task" ? 0 : 1;
      const rightTask = right.kind === "task" ? 0 : 1;
      return leftTask - rightTask
        || (left.startDate ?? "9999-12-31").localeCompare(right.startDate ?? "9999-12-31")
        || itemLabel(left).localeCompare(itemLabel(right));
    })
    .slice(0, 3);
}

function currentTimelineItem(timeline: AtlasOperationalTimeline) {
  const ordered = [...timeline.now].sort((left, right) => {
    const leftBlocked = left.state === "blocked" ? 0 : 1;
    const rightBlocked = right.state === "blocked" ? 0 : 1;
    const leftTask = left.kind === "task" ? 0 : left.kind === "current_crop" ? 1 : 2;
    const rightTask = right.kind === "task" ? 0 : right.kind === "current_crop" ? 1 : 2;
    return leftBlocked - rightBlocked
      || leftTask - rightTask
      || (left.startDate ?? "9999-12-31").localeCompare(right.startDate ?? "9999-12-31");
  });
  return ordered[0] ?? null;
}

function lastMovedAt(object: AtlasObjectWorkbenchObject, events: AtlasObjectTimelineEvent[]) {
  const values = [
    object.last_touched_at,
    ...events.map((event) => event.created_at || event.event_date),
  ].filter((value): value is string => Boolean(value));
  return values.sort().at(-1) ?? null;
}

function objectProfile(object: AtlasObjectWorkbenchObject, cropCycles: AtlasObjectCropCycle[]) {
  if (object.object_type === "room") return { key: "room_readiness", label: "Room Trail", kind: "room" };
  if (cropCycles.length > 0) return { key: "crop_object", label: "Crop + Place Trail", kind: "object" };
  return { key: "object_stewardship", label: "Object Trail", kind: "object" };
}

function fallbackStateNode(object: AtlasObjectWorkbenchObject): AtlasTrailNode {
  const decision = Boolean(object.decision_required);
  const state = readable(object.life_status) || readable(object.presentability);
  const unresolved = !decision && !state;
  return {
    nodeId: `object:${object.object_id}:state`,
    nodeKey: "current_state",
    label: decision ? "Decision needed" : state || "State not logged",
    status: decision ? "blocked" : unresolved ? "unresolved" : "current",
    nodeKind: decision ? "decision" : "milestone",
    occurredOn: object.last_touched_at,
    evidenceCount: object.last_touched_at ? 1 : 0,
  };
}

export function atlasTrailFromObjectWorkbench(input: {
  object: AtlasObjectWorkbenchObject;
  cropCycles: AtlasObjectCropCycle[];
  events: AtlasObjectTimelineEvent[];
  operationalTimeline: AtlasOperationalTimeline | null;
}): AtlasTrailContext {
  const { object, cropCycles, events, operationalTimeline } = input;
  const profile = objectProfile(object, cropCycles);
  const recentEvents = events
    .filter((event) => event.event_type !== "blocked")
    .slice(0, 2)
    .reverse();
  const nodes: AtlasTrailNode[] = recentEvents.map((event) => ({
    nodeId: `object:${object.object_id}:event:${event.event_id}`,
    nodeKey: `event_${event.event_id}`,
    label: `${EVENT_LABELS[event.event_type] ?? readable(event.event_type)}${event.entity_label ? ` · ${event.entity_label}` : ""}`,
    status: "complete",
    nodeKind: "milestone",
    occurredOn: event.event_date,
    evidenceCount: 1,
    note: event.note,
  }));

  const currentItem = operationalTimeline ? currentTimelineItem(operationalTimeline) : null;
  let currentNode: AtlasTrailNode;
  if (currentItem) {
    const status: AtlasTrailNodeStatus = currentItem.state === "blocked" ? "blocked" : "current";
    currentNode = {
      nodeId: `object:${object.object_id}:current:${itemIdentity(currentItem)}`,
      nodeKey: `current_${itemIdentity(currentItem)}`,
      label: itemLabel(currentItem),
      status,
      nodeKind: itemNodeKind(currentItem),
      occurredOn: currentItem.kind === "observation" ? currentItem.startDate : null,
      dueOn: currentItem.kind === "task" ? currentItem.startDate : null,
      taskId: currentItem.taskId,
      href: currentItem.taskId ? taskHref(currentItem.taskId, object.object_key) : null,
      evidenceCount: currentItem.eventId ? 1 : 0,
      note: currentItem.detail,
    };
  } else {
    currentNode = fallbackStateNode(object);
  }
  nodes.push(currentNode);

  if (operationalTimeline) {
    futureItems(operationalTimeline).forEach((item) => {
      nodes.push({
        nodeId: `object:${object.object_id}:projected:${itemIdentity(item)}`,
        nodeKey: `projected_${itemIdentity(item)}`,
        label: itemLabel(item),
        status: "projected",
        nodeKind: itemNodeKind(item),
        dueOn: item.startDate,
        taskId: null,
        href: null,
        evidenceCount: 0,
        note: item.detail,
      });
    });
  }

  const nextNode = nodes.find((node) => node.status === "projected") ?? null;
  const currentMove = currentItem?.taskId ? {
    kind: "farm_task",
    taskId: currentItem.taskId,
    title: itemLabel(currentItem),
    status: currentItem.state,
    dueDate: currentItem.startDate,
    href: taskHref(currentItem.taskId, object.object_key),
  } : null;
  const blocker = currentNode.status === "blocked" ? {
    kind: object.decision_required ? "decision" : "blocked_move",
    title: currentNode.label,
    detail: currentNode.note || (object.decision_required ? "This place needs a decision before its Trail can move." : "The current move is blocked."),
    dueDate: currentNode.dueOn,
  } : null;

  return {
    trailId: `object:${object.object_id}`,
    profileKey: profile.key,
    profileLabel: profile.label,
    subject: {
      kind: profile.kind,
      id: object.object_id,
      label: object.object_label,
      farmId: object.farm_id,
    },
    nodes,
    currentNodeId: currentNode.status === "unresolved" ? null : currentNode.nodeId,
    currentMove,
    nextNode,
    blocker,
    unresolvedEvidenceCount: currentNode.status === "unresolved" ? 1 : 0,
    evidenceCount: recentEvents.length + (currentItem?.eventId ? 1 : 0),
    lastMovedAt: lastMovedAt(object, events),
  };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  return text(metadata?.[key]);
}

function metadataBoolean(metadata: Record<string, unknown> | null | undefined, key: string) {
  return metadata?.[key] === true;
}

function activeTasks(tasks: AtlasTaskCard[]) {
  return tasks
    .filter((task) => task.status === "open" || task.status === "blocked")
    .sort((left, right) => {
      const leftBlocked = left.status === "blocked" ? 0 : 1;
      const rightBlocked = right.status === "blocked" ? 0 : 1;
      return leftBlocked - rightBlocked
        || (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31")
        || left.title.localeCompare(right.title);
    });
}

function releasedTask(tasks: AtlasTaskCard[]) {
  const today = todayIso();
  return activeTasks(tasks).find((task) => task.status === "blocked" || !task.due_date || task.due_date <= today) ?? null;
}

function projectedTask(tasks: AtlasTaskCard[], currentTaskId: string | null) {
  return activeTasks(tasks).find((task) => task.task_id !== currentTaskId) ?? null;
}

function registryTaskNode(task: AtlasTaskCard, object: AtlasRegistryObject, status: AtlasTrailNodeStatus): AtlasTrailNode {
  const display = atlasTaskDisplay(task);
  return {
    nodeId: `object:${object.id}:task:${task.task_id}`,
    nodeKey: `task_${task.task_id}`,
    label: display.title,
    status,
    nodeKind: /water|weed|check|care|maintain/i.test(`${task.task_type} ${task.action_key} ${task.title}`) ? "care_pulse" : "milestone",
    dueOn: task.due_date,
    taskId: status === "current" || status === "blocked" ? task.task_id : null,
    href: status === "current" || status === "blocked" ? taskHref(task.task_id, object.stable_key) : null,
    note: task.blocker_text || display.detail,
  };
}

function registryCropTrail(object: AtlasRegistryObject, tasks: AtlasTaskCard[]): AtlasTrailContext {
  const content = object.contents.find((row) => row.content_type === "crop_cycle") ?? object.contents[0];
  const inspection = content?.inspection;
  const stage = readable(inspection?.stage) || "Current crop";
  const currentTask = releasedTask(tasks);
  const nextTask = projectedTask(tasks, currentTask?.task_id ?? null);
  const nodes: AtlasTrailNode[] = [];

  if (content) {
    nodes.push({
      nodeId: `object:${object.id}:sown`,
      nodeKey: "sown",
      label: "Sown",
      status: inspection?.seeded_date ? "complete" : "unresolved",
      nodeKind: "milestone",
      occurredOn: inspection?.seeded_date,
      evidenceCount: inspection?.seeded_date ? 1 : 0,
    });
    nodes.push({
      nodeId: `object:${object.id}:germinated`,
      nodeKey: "germinated",
      label: "Germinated",
      status: inspection?.germinated_date ? "complete" : "unresolved",
      nodeKind: "milestone",
      occurredOn: inspection?.germinated_date,
      dueOn: inspection?.expected_germination_start,
      evidenceCount: inspection?.germinated_date ? 1 : 0,
    });
  }

  const stageNode: AtlasTrailNode = {
    nodeId: `object:${object.id}:stage`,
    nodeKey: "current_stage",
    label: stage,
    status: currentTask ? "care" : object.decision_required ? "blocked" : "current",
    nodeKind: object.decision_required ? "decision" : "milestone",
  };
  nodes.push(stageNode);

  if (currentTask) nodes.push(registryTaskNode(currentTask, object, currentTask.status === "blocked" ? "blocked" : "current"));
  if (nextTask) nodes.push(registryTaskNode(nextTask, object, "projected"));

  if (content) {
    const harvested = Boolean(inspection?.harvest_dates.length);
    nodes.push({
      nodeId: `object:${object.id}:harvest`,
      nodeKey: "harvest",
      label: "Harvest",
      status: harvested ? "complete" : "projected",
      nodeKind: "milestone",
      occurredOn: harvested ? inspection?.harvest_dates.at(-1) ?? null : null,
      dueOn: harvested ? null : inspection?.expected_harvest_watch_start,
      evidenceCount: inspection?.harvest_dates.length ?? 0,
    });
    nodes.push({
      nodeId: `object:${object.id}:clear`,
      nodeKey: "clear",
      label: "Clear / turn over",
      status: inspection?.clear_bed_date ? "complete" : "projected",
      nodeKind: "decision",
      occurredOn: inspection?.clear_bed_date,
      evidenceCount: inspection?.clear_bed_date ? 1 : 0,
    });
  }

  const currentNode = currentTask
    ? nodes.find((node) => node.taskId === currentTask.task_id) ?? stageNode
    : stageNode;
  const nextNode = nodes.slice(nodes.indexOf(currentNode) + 1).find((node) => node.status === "projected") ?? null;

  return {
    trailId: `object:${object.id}`,
    profileKey: "crop_object",
    profileLabel: "Crop + Place Trail",
    subject: { kind: "object", id: object.id, label: object.label },
    nodes,
    currentNodeId: currentNode.nodeId,
    currentMove: currentTask ? {
      kind: "farm_task",
      taskId: currentTask.task_id,
      title: atlasTaskDisplay(currentTask).title,
      status: currentTask.status,
      dueDate: currentTask.due_date,
      href: taskHref(currentTask.task_id, object.stable_key),
    } : null,
    nextNode,
    blocker: currentNode.status === "blocked" ? {
      kind: object.decision_required ? "decision" : "blocked_move",
      title: currentNode.label,
      detail: currentNode.note || "This object needs attention before its Trail can move.",
      dueDate: currentNode.dueOn,
    } : null,
    unresolvedEvidenceCount: nodes.filter((node) => node.status === "unresolved").length,
    evidenceCount: nodes.reduce((sum, node) => sum + (node.evidenceCount ?? 0), 0),
  };
}

function registryRoomTrail(object: AtlasRegistryObject, tasks: AtlasTaskCard[]): AtlasTrailContext {
  const readiness = object.presentability
    || metadataString(object.state_metadata, "rental_readiness")
    || metadataString(object.metadata, "rental_readiness");
  const bookingReady = metadataBoolean(object.state_metadata, "booking_ready")
    || metadataBoolean(object.metadata, "booking_ready");
  const currentTask = releasedTask(tasks);
  const nextTask = projectedTask(tasks, currentTask?.task_id ?? null);
  const assessed = Boolean(readiness && !["unknown", "not_assessed"].includes(readiness));
  const stateNode: AtlasTrailNode = {
    nodeId: `object:${object.id}:room-state`,
    nodeKey: "room_state",
    label: readable(readiness) || "Room state not assessed",
    status: currentTask ? "care" : object.decision_required ? "blocked" : assessed ? "current" : "unresolved",
    nodeKind: object.decision_required ? "decision" : "milestone",
    evidenceCount: assessed ? 1 : 0,
  };
  const nodes: AtlasTrailNode[] = [{
    nodeId: `object:${object.id}:assessed`,
    nodeKey: "assessed",
    label: "Assessed",
    status: assessed ? "complete" : "unresolved",
    nodeKind: "review",
    evidenceCount: assessed ? 1 : 0,
  }, stateNode];
  if (currentTask) nodes.push(registryTaskNode(currentTask, object, currentTask.status === "blocked" ? "blocked" : "current"));
  if (nextTask) nodes.push(registryTaskNode(nextTask, object, "projected"));
  nodes.push({
    nodeId: `object:${object.id}:booking-ready`,
    nodeKey: "booking_ready",
    label: "Booking ready",
    status: bookingReady ? "complete" : "projected",
    nodeKind: "terminal",
    evidenceCount: bookingReady ? 1 : 0,
  });

  const currentNode = currentTask
    ? nodes.find((node) => node.taskId === currentTask.task_id) ?? stateNode
    : stateNode;
  const nextNode = nodes.slice(nodes.indexOf(currentNode) + 1).find((node) => node.status === "projected") ?? null;
  return {
    trailId: `object:${object.id}`,
    profileKey: "room_readiness",
    profileLabel: "Room Trail",
    subject: { kind: "room", id: object.id, label: object.label },
    nodes,
    currentNodeId: currentNode.status === "unresolved" ? null : currentNode.nodeId,
    currentMove: currentTask ? {
      kind: "farm_task",
      taskId: currentTask.task_id,
      title: atlasTaskDisplay(currentTask).title,
      status: currentTask.status,
      dueDate: currentTask.due_date,
      href: taskHref(currentTask.task_id, object.stable_key),
    } : null,
    nextNode,
    blocker: currentNode.status === "blocked" ? {
      kind: object.decision_required ? "decision" : "blocked_move",
      title: currentNode.label,
      detail: currentNode.note || "Room readiness is blocked.",
      dueDate: currentNode.dueOn,
    } : null,
    unresolvedEvidenceCount: nodes.filter((node) => node.status === "unresolved").length,
    evidenceCount: nodes.reduce((sum, node) => sum + (node.evidenceCount ?? 0), 0),
  };
}

function registryGenericTrail(object: AtlasRegistryObject, tasks: AtlasTaskCard[]): AtlasTrailContext {
  const currentTask = releasedTask(tasks);
  const nextTask = projectedTask(tasks, currentTask?.task_id ?? null);
  const state = readable(object.life_status) || readable(object.presentability);
  const stateNode: AtlasTrailNode = {
    nodeId: `object:${object.id}:state`,
    nodeKey: "current_state",
    label: object.decision_required ? "Decision needed" : state || "State not logged",
    status: currentTask ? "care" : object.decision_required ? "blocked" : state ? "current" : "unresolved",
    nodeKind: object.decision_required ? "decision" : "milestone",
  };
  const nodes = [stateNode];
  if (currentTask) nodes.push(registryTaskNode(currentTask, object, currentTask.status === "blocked" ? "blocked" : "current"));
  if (nextTask) nodes.push(registryTaskNode(nextTask, object, "projected"));
  const currentNode = currentTask
    ? nodes.find((node) => node.taskId === currentTask.task_id) ?? stateNode
    : stateNode;
  const nextNode = nodes.slice(nodes.indexOf(currentNode) + 1).find((node) => node.status === "projected") ?? null;
  return {
    trailId: `object:${object.id}`,
    profileKey: "object_stewardship",
    profileLabel: "Object Trail",
    subject: { kind: "object", id: object.id, label: object.label },
    nodes,
    currentNodeId: currentNode.status === "unresolved" ? null : currentNode.nodeId,
    currentMove: currentTask ? {
      kind: "farm_task",
      taskId: currentTask.task_id,
      title: atlasTaskDisplay(currentTask).title,
      status: currentTask.status,
      dueDate: currentTask.due_date,
      href: taskHref(currentTask.task_id, object.stable_key),
    } : null,
    nextNode,
    blocker: currentNode.status === "blocked" ? {
      kind: object.decision_required ? "decision" : "blocked_move",
      title: currentNode.label,
      detail: currentNode.note || "This object needs attention.",
      dueDate: currentNode.dueOn,
    } : null,
    unresolvedEvidenceCount: currentNode.status === "unresolved" ? 1 : 0,
    evidenceCount: 0,
  };
}

export function atlasTrailFromRegistryObject(object: AtlasRegistryObject, tasks: AtlasTaskCard[] = []) {
  if (object.object_type === "room") return registryRoomTrail(object, tasks);
  if (object.contents.length > 0) return registryCropTrail(object, tasks);
  return registryGenericTrail(object, tasks);
}

function trailPriority(context: AtlasTrailContext) {
  const current = atlasTrailCurrentNode(context);
  if (current?.status === "blocked") return 0;
  if (context.currentMove) return 1;
  if (current?.status === "current") return 2;
  if (context.unresolvedEvidenceCount > 0) return 3;
  return 4;
}

export function atlasPrimaryTrailForZone(zone: AtlasRegistryZone) {
  return zone.objects
    .map((object) => atlasTrailFromRegistryObject(object))
    .sort((left, right) => trailPriority(left) - trailPriority(right)
      || left.subject.label.localeCompare(right.subject.label))[0] ?? null;
}
