export type CloseoutPeriod = "day" | "week" | "month";
type JsonObject = Record<string, unknown>;

type FieldLogRow = {
  id: string;
  log_date: string;
  action_types: string[] | null;
  summary_sentence: string;
  note: string | null;
  source: string | null;
  metadata: JsonObject | null;
  created_at: string;
};

type EventRow = {
  id: string;
  event_type: string;
  event_date: string;
  note: string | null;
  metadata: JsonObject | null;
};

type TaskRow = {
  id: string;
  title: string;
  task_type: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  generated_from: string | null;
};

type TaskOutcomeRow = {
  id: string;
  task_id: string;
  outcome: string;
  task_title: string;
  task_type: string | null;
  due_date: string | null;
  note: string | null;
  created_at: string;
};

export type CloseoutSource = {
  logs?: FieldLogRow[] | null;
  events?: EventRow[] | null;
  tasks?: TaskRow[] | null;
  taskOutcomes?: TaskOutcomeRow[] | null;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function prettyDate(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function closeoutPeriodBounds(todayIso: string, period: CloseoutPeriod) {
  const today = new Date(`${todayIso}T12:00:00Z`);
  if (period === "day") return { start: todayIso, end: isoDate(addDays(today, 1)), label: "Today" };

  if (period === "week") {
    const day = today.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = addDays(today, mondayOffset);
    return { start: isoDate(start), end: isoDate(addDays(start, 7)), label: "This week" };
  }

  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1, 12));
  return {
    start: isoDate(start),
    end: isoDate(end),
    label: today.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
  };
}

function emptyCounts() {
  return {
    logs: 0,
    objectEvents: 0,
    tasksDone: 0,
    tasksBlocked: 0,
    openTasks: 0,
    followUps: 0,
    seeded: 0,
    germination: 0,
    weeded: 0,
    harvested: 0,
    changed: 0,
    closeouts: 0,
  };
}

function includesAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

function addActionCounts(counts: ReturnType<typeof emptyCounts>, raw: string) {
  const text = raw.toLowerCase();
  if (includesAny(text, ["seed", "sow", "sown", "planted", "plant "])) counts.seeded += 1;
  if (includesAny(text, ["germin", "stand"])) counts.germination += 1;
  if (includesAny(text, ["weed"])) counts.weeded += 1;
  if (includesAny(text, ["harvest", "cut", "bundle", "deliver"])) counts.harvested += 1;
  if (includesAny(text, ["changed", "changed_plan", "decision", "partial"])) counts.changed += 1;
  if (includesAny(text, ["closeout"])) counts.closeouts += 1;
}

function cleanSentence(value: string) {
  return value
    .replace(/^Checklist\s*[—-]\s*/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}\s*[·-]\s*/g, "")
    .replace(/^[^·]+\s+recorded state for\s+/i, "")
    .replace(/^[^·]+\s+completed\s+/i, "")
    .replace(/^[^·]+\s+closed\s+(day|week|month)\.\s*/i, "")
    .replaceAll('"', "")
    .replace(/\bAnna\b/g, "crew")
    .replace(/\bLex\b/g, "crew")
    .trim();
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isCurated(log: FieldLogRow) {
  return log.source === "atlas_curated_record" || log.metadata?.record_source === "curated_july_record";
}

function curatedLine(log: FieldLogRow) {
  const metadata = log.metadata ?? {};
  const spot = textValue(metadata.spot) ?? textValue(metadata.display_label);
  const variety = textValue(metadata.variety);
  const action = textValue(metadata.action);
  const status = textValue(metadata.status);
  const note = textValue(log.note);
  const pieces = [spot, variety, prettyDate(log.log_date), action ?? status].filter(Boolean);
  const base = pieces.join(" · ");
  return note ? `${base} · ${note}` : base;
}

function taskOutcomeLabel(outcome: string) {
  if (outcome === "done") return "Done";
  if (outcome === "partial") return "Partly done";
  if (outcome === "blocked") return "Blocked";
  if (outcome === "changed_plan") return "Changed plan";
  if (outcome === "not_relevant") return "Not relevant";
  return outcome.replaceAll("_", " ");
}

function uniqueLatestTaskOutcomes(outcomes: TaskOutcomeRow[]) {
  const map = new Map<string, TaskOutcomeRow>();
  outcomes.forEach((outcome) => {
    const key = `${outcome.task_id || outcome.task_title}:${outcome.outcome}`;
    const previous = map.get(key);
    if (!previous || outcome.created_at > previous.created_at) map.set(key, outcome);
  });
  return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function taskOutcomeLines(outcomes: TaskOutcomeRow[]) {
  return uniqueLatestTaskOutcomes(outcomes)
    .map((outcome) => {
      const title = cleanSentence(outcome.task_title || "Task");
      const note = cleanSentence(outcome.note || "");
      return [taskOutcomeLabel(outcome.outcome), title, note].filter(Boolean).join(" · ");
    })
    .filter(Boolean);
}

function recentLines(logs: FieldLogRow[], events: EventRow[], taskOutcomes: TaskOutcomeRow[]) {
  const taskLines = taskOutcomeLines(taskOutcomes);
  const curated = logs.filter(isCurated).map(curatedLine).filter(Boolean);
  const logLines = logs
    .filter((log) => log.source !== "atlas_closeout" && log.source !== "atlas_task_board")
    .map((log) => cleanSentence(log.summary_sentence || log.note || ""))
    .filter(Boolean);
  const eventLines = events.map((event) => {
    const text = event.event_type.replaceAll("_", " ").toLowerCase();
    const action = text.includes("germin")
      ? "germination checked"
      : text.includes("seed") || text.includes("sow")
        ? "sowing recorded"
        : text;
    return event.note ? `${action} · ${cleanSentence(event.note)}` : action;
  });
  return Array.from(new Set([...taskLines, ...curated, ...logLines, ...eventLines])).slice(0, 24);
}

function carryForwardLines(logs: FieldLogRow[], tasks: TaskRow[], taskOutcomes: TaskOutcomeRow[]) {
  const fromCurated = logs
    .filter(isCurated)
    .map((log) => textValue(log.metadata?.next))
    .filter(Boolean) as string[];
  const fromCloseouts = logs.flatMap((log) => {
    const metadata = log.metadata ?? {};
    return [metadata.carry_forward, metadata.next_focus]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => cleanSentence(value));
  });
  const fromTasks = tasks
    .filter((task) => task.status === "blocked" || task.generated_from === "task_result")
    .map((task) => cleanSentence(task.title))
    .filter(Boolean);
  const fromOutcomes = taskOutcomes
    .filter((outcome) => ["partial", "blocked", "changed_plan"].includes(outcome.outcome))
    .map((outcome) => `${taskOutcomeLabel(outcome.outcome)} · ${cleanSentence(outcome.task_title)}`)
    .filter(Boolean);
  return Array.from(new Set([...fromCurated, ...fromCloseouts, ...fromTasks, ...fromOutcomes])).slice(0, 12);
}

export function buildCloseoutSummary(source: CloseoutSource, todayIso: string, period: CloseoutPeriod) {
  const bounds = closeoutPeriodBounds(todayIso, period);
  const counts = emptyCounts();
  const logRows = Array.isArray(source.logs) ? source.logs : [];
  const eventRows = Array.isArray(source.events) ? source.events : [];
  const taskRows = Array.isArray(source.tasks) ? source.tasks : [];
  const outcomeRows = uniqueLatestTaskOutcomes(Array.isArray(source.taskOutcomes) ? source.taskOutcomes : []);
  const curatedRows = logRows.filter(isCurated);
  const countRows = curatedRows.length > 0 ? curatedRows : logRows;

  counts.logs = logRows.length;
  counts.objectEvents = curatedRows.length > 0 ? curatedRows.length : eventRows.length;
  countRows.forEach((log) => {
    (log.action_types ?? []).forEach((action) => addActionCounts(counts, action));
    addActionCounts(counts, `${log.summary_sentence} ${log.note ?? ""} ${JSON.stringify(log.metadata ?? {})}`);
  });
  if (curatedRows.length === 0) {
    eventRows.forEach((event) => addActionCounts(counts, `${event.event_type} ${event.note ?? ""}`));
  }
  outcomeRows.forEach((outcome) => {
    if (outcome.outcome === "done") counts.tasksDone += 1;
    if (outcome.outcome === "blocked") counts.tasksBlocked += 1;
    addActionCounts(counts, `${outcome.outcome} ${outcome.task_title} ${outcome.task_type ?? ""} ${outcome.note ?? ""}`);
  });
  taskRows.forEach((task) => {
    const dueInPeriod = !task.due_date || (task.due_date >= bounds.start && task.due_date < bounds.end);
    if (dueInPeriod && task.status === "open") counts.openTasks += 1;
    if (dueInPeriod && task.generated_from === "task_result") counts.followUps += 1;
  });

  return {
    period,
    label: bounds.label,
    startDate: bounds.start,
    endDate: bounds.end,
    counts,
    recent: recentLines(logRows, eventRows, outcomeRows),
    carryForward: carryForwardLines(logRows, taskRows, outcomeRows),
    records: outcomeRows.map((outcome) => ({
      id: outcome.id,
      date: outcome.created_at.slice(0, 10),
      zone: null,
      spot: null,
      label: cleanSentence(outcome.task_title),
      action: taskOutcomeLabel(outcome.outcome),
      crop: null,
      variety: null,
      status: outcome.outcome,
      note: outcome.note,
      next: null,
      kind: "task_outcome",
    })),
  };
}
