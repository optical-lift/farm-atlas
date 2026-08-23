function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateInTimeZone(value, timeZone) {
  if (!value) return null;
  if (isIsoDate(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isTopLevelTask(task) {
  if (task.parentTaskId) return false;
  const metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
  if (metadata.parent_task_id) return false;
  if (metadata.is_child_task === true) return false;
  return true;
}

function ownerTaskResponsibility(task, ownerMembershipId, ownerUserId) {
  if (!isTopLevelTask(task)) return null;
  if (task.assignedMembershipId === ownerMembershipId) return "assigned_to_you";
  if (ownerUserId && task.assignedUserId === ownerUserId) return "assigned_to_you";
  if (task.visibilityScope === "owner") return "owner_scope";
  return null;
}

function taskBucket(task, today, weekEnd) {
  if (task.status === "blocked") return "waiting";
  if (task.dueDate === today) return "today";
  if (task.dueDate && task.dueDate > today && task.dueDate <= weekEnd) return "thisWeek";
  return "backlog";
}

function candidateDates(candidate, timeZone) {
  const fixed = dateInTimeZone(candidate.fixedStart, timeZone);
  const available = dateInTimeZone(candidate.windowStart, timeZone);
  const beginBy = dateInTimeZone(candidate.mustBeginBy, timeZone);
  const finishBy = dateInTimeZone(candidate.mustFinishBy, timeZone);
  const windowEnd = dateInTimeZone(candidate.windowEnd, timeZone);
  const deadlines = [beginBy, finishBy, windowEnd].filter(Boolean).sort();
  const starts = [fixed, available].filter(Boolean).sort();

  return {
    fixed,
    available,
    beginBy,
    finishBy,
    windowEnd,
    earliestStart: starts[0] ?? null,
    earliestDeadline: deadlines[0] ?? null,
    earliestTiming: [...starts, ...deadlines].filter(Boolean).sort()[0] ?? null,
  };
}

function candidateBucket(candidate, today, weekEnd, timeZone) {
  const dates = candidateDates(candidate, timeZone);
  const isAvailable = Boolean(dates.earliestStart && dates.earliestStart <= today);
  const deadlineReached = Boolean(dates.earliestDeadline && dates.earliestDeadline <= today);
  if (isAvailable || deadlineReached) return { bucket: "now", dates };
  if (dates.earliestTiming && dates.earliestTiming <= weekEnd) return { bucket: "thisWeek", dates };
  return { bucket: "backlog", dates };
}

function candidateTiming(dates) {
  const timingDate = dates.fixed
    ?? dates.available
    ?? dates.beginBy
    ?? dates.finishBy
    ?? dates.windowEnd
    ?? null;
  const timingKind = dates.fixed
    ? "fixed"
    : dates.available
      ? "available"
      : dates.beginBy
        ? "begin_by"
        : dates.finishBy
          ? "finish_by"
          : dates.windowEnd
            ? "window_end"
            : "undated";
  return { timingDate, timingKind };
}

function shouldPromoteTaskBucket(currentBucket, principalBucket) {
  if (currentBucket === "waiting") return false;
  const rank = {
    now: 0,
    today: 1,
    thisWeek: 2,
    backlog: 3,
  };
  return rank[principalBucket] < rank[currentBucket];
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1;
    const leftDate = left.timingDate ?? "9999-12-31";
    const rightDate = right.timingDate ?? "9999-12-31";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank;
    return left.title.localeCompare(right.title);
  });
}

function priorityRank(priority) {
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  if (priority === "normal") return 2;
  if (priority === "low") return 3;
  return 4;
}

export function buildOwnerMyWorkProjection({
  ownerMembershipId,
  ownerUserId,
  tasks,
  principalCandidates,
  today,
  weekEnd,
  principalTimeZone,
}) {
  const buckets = {
    now: [],
    today: [],
    thisWeek: [],
    waiting: [],
    backlog: [],
  };

  let excludedTaskRows = 0;
  let excludedPrincipalCandidates = 0;
  let linkedPrincipalCandidates = 0;
  let ownerScopeTaskCount = 0;
  let assignedTaskCount = 0;
  const taskItems = [];
  const taskItemBySourceId = new Map();
  const standalonePrincipalItems = [];

  for (const task of tasks) {
    const responsibility = ownerTaskResponsibility(task, ownerMembershipId, ownerUserId);
    if (!responsibility) {
      excludedTaskRows += 1;
      continue;
    }

    if (responsibility === "owner_scope") ownerScopeTaskCount += 1;
    else assignedTaskCount += 1;

    const item = {
      key: `task:${task.id}`,
      source: "task",
      sourceType: task.taskType || "task",
      sourceId: task.id,
      title: task.title,
      status: task.status,
      bucket: taskBucket(task, today, weekEnd),
      href: `/owner/tasks/${encodeURIComponent(task.id)}`,
      detail: task.blocker || task.detail || null,
      timingDate: task.dueDate || null,
      timingKind: task.dueDate ? "due" : "undated",
      isOverdue: Boolean(task.dueDate && task.dueDate < today),
      responsibility,
      priority: task.priority || "normal",
      priorityRank: priorityRank(task.priority),
      principalSignal: null,
    };
    taskItems.push(item);
    taskItemBySourceId.set(task.id, item);
  }

  for (const candidate of principalCandidates) {
    if (candidate.ownerRequired !== true) {
      excludedPrincipalCandidates += 1;
      continue;
    }

    const { bucket, dates } = candidateBucket(candidate, today, weekEnd, principalTimeZone);
    const { timingDate, timingKind } = candidateTiming(dates);
    const linkedTaskItem = taskItemBySourceId.get(candidate.sourceId);

    if (linkedTaskItem) {
      linkedPrincipalCandidates += 1;
      linkedTaskItem.principalSignal = {
        sourceType: candidate.sourceType || "principal_work",
        floorClass: candidate.floorClass ?? null,
        expectedMinutes: candidate.expectedMinutes ?? null,
        domain: candidate.domain || null,
        timingDate,
        timingKind,
      };
      if (shouldPromoteTaskBucket(linkedTaskItem.bucket, bucket)) {
        linkedTaskItem.bucket = bucket;
      }
      continue;
    }

    standalonePrincipalItems.push({
      key: `principal:${candidate.sourceType}:${candidate.sourceId}`,
      source: "principal",
      sourceType: candidate.sourceType || "principal_work",
      sourceId: candidate.sourceId,
      title: candidate.title,
      status: "candidate",
      bucket,
      href: "/principal",
      detail: candidate.consequence || candidate.reasonForFloor || null,
      timingDate,
      timingKind,
      isOverdue: Boolean(dates.earliestDeadline && dates.earliestDeadline < today),
      responsibility: "principal_required",
      priority: candidate.floorClass != null ? `floor_${candidate.floorClass}` : "principal",
      priorityRank: Number.isFinite(Number(candidate.floorClass)) ? Number(candidate.floorClass) : 4,
      expectedMinutes: candidate.expectedMinutes ?? null,
      domain: candidate.domain || null,
      principalSignal: null,
    });
  }

  for (const item of [...taskItems, ...standalonePrincipalItems]) {
    buckets[item.bucket].push(item);
  }

  const sorted = {
    now: sortItems(buckets.now),
    today: sortItems(buckets.today),
    thisWeek: sortItems(buckets.thisWeek),
    waiting: sortItems(buckets.waiting),
    backlog: sortItems(buckets.backlog),
  };
  const all = [
    ...sorted.now,
    ...sorted.today,
    ...sorted.thisWeek,
    ...sorted.waiting,
    ...sorted.backlog,
  ];

  return {
    buckets: sorted,
    all,
    counts: {
      all: all.length,
      now: sorted.now.length,
      today: sorted.today.length,
      thisWeek: sorted.thisWeek.length,
      waiting: sorted.waiting.length,
      backlog: sorted.backlog.length,
      overdue: all.filter((item) => item.isOverdue).length,
      taskItems: all.filter((item) => item.source === "task").length,
      principalItems: all.filter((item) => item.source === "principal").length,
      principalLinkedTaskItems: all.filter((item) => item.principalSignal).length,
    },
    audit: {
      taskRowsRead: tasks.length,
      principalCandidatesRead: principalCandidates.length,
      assignedTaskCount,
      ownerScopeTaskCount,
      excludedTaskRows,
      excludedPrincipalCandidates,
      linkedPrincipalCandidates,
      bucketedItems: all.length,
      unexplainedItems: 0,
    },
  };
}
