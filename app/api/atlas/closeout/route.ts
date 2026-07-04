import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Period = "day" | "week" | "month";
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
  generated_from: string | null;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function periodBounds(todayIso: string, period: Period) {
  const today = new Date(`${todayIso}T12:00:00Z`);

  if (period === "day") {
    return { start: todayIso, end: isoDate(addDays(today, 1)), label: "Today" };
  }

  if (period === "week") {
    const day = today.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = addDays(today, mondayOffset);
    return { start: isoDate(start), end: isoDate(addDays(start, 7)), label: "This week" };
  }

  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1, 12));
  return { start: isoDate(start), end: isoDate(end), label: today.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }) };
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
  if (includesAny(text, ["seed", "sow", "sown", "planted"])) counts.seeded += 1;
  if (includesAny(text, ["germin", "stand"])) counts.germination += 1;
  if (includesAny(text, ["weed"])) counts.weeded += 1;
  if (includesAny(text, ["harvest", "cut", "bundle", "deliver"])) counts.harvested += 1;
  if (includesAny(text, ["changed", "changed_plan", "decision"])) counts.changed += 1;
  if (includesAny(text, ["closeout"])) counts.closeouts += 1;
}

function humanAction(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  if (text.includes("germin")) return "germination checked";
  if (text.includes("seed") || text.includes("sow")) return "sowing recorded";
  if (text.includes("weed")) return "weeding recorded";
  if (text.includes("harvest") || text.includes("cut")) return "harvest recorded";
  if (text.includes("blocked")) return "blocked";
  if (text.includes("closeout")) return "closeout saved";
  if (text.includes("changed")) return "changed";
  return text;
}

function cleanSentence(value: string) {
  return value
    .replace(/^\d{4}-\d{2}-\d{2}\s*[·-]\s*/g, "")
    .replace(/^[^·]+\s+recorded state for\s+/i, "")
    .replace(/^[^·]+\s+completed\s+/i, "")
    .replace(/^[^·]+\s+closed\s+(day|week|month)\.\s*/i, "")
    .replaceAll('"', "")
    .trim();
}

function recentLines(logs: FieldLogRow[], events: EventRow[]) {
  const logLines = logs
    .filter((log) => log.source !== "atlas_closeout")
    .map((log) => {
      const line = cleanSentence(log.summary_sentence || log.note || "");
      return line || null;
    })
    .filter(Boolean) as string[];

  const eventLines = events.map((event) => {
    const action = humanAction(event.event_type);
    return event.note ? `${action} · ${event.note}` : action;
  });

  return Array.from(new Set([...logLines, ...eventLines])).slice(0, 4);
}

function carryForwardLines(logs: FieldLogRow[], tasks: TaskRow[]) {
  const fromCloseouts = logs.flatMap((log) => {
    const metadata = log.metadata ?? {};
    return [metadata.carry_forward, metadata.next_focus]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
  });

  const fromTasks = tasks
    .filter((task) => task.status === "blocked" || task.generated_from === "task_result")
    .map((task) => task.title)
    .filter(Boolean);

  return Array.from(new Set([...fromCloseouts, ...fromTasks])).slice(0, 4);
}

async function getFarmId() {
  const { data, error } = await atlasSupabase.schema("atlas").from("farms").select("id").eq("stable_key", "elm_farm").single();
  if (error || !data) throw error ?? new Error("Elm Farm not found.");
  return data.id as string;
}

async function getSummary(farmId: string, todayIso: string, period: Period) {
  const bounds = periodBounds(todayIso, period);
  const counts = emptyCounts();

  const { data: logs, error: logsError } = await atlasSupabase
    .schema("atlas")
    .from("field_logs")
    .select("id, log_date, action_types, summary_sentence, note, source, metadata, created_at")
    .eq("farm_id", farmId)
    .gte("log_date", bounds.start)
    .lt("log_date", bounds.end)
    .order("created_at", { ascending: false })
    .limit(80);

  if (logsError) throw logsError;

  const { data: events, error: eventsError } = await atlasSupabase
    .schema("atlas")
    .from("object_activity_events")
    .select("id, event_type, event_date, note, metadata")
    .eq("farm_id", farmId)
    .gte("event_date", bounds.start)
    .lt("event_date", bounds.end)
    .order("event_date", { ascending: false })
    .limit(80);

  if (eventsError) throw eventsError;

  const { data: tasks, error: tasksError } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, title, task_type, status, due_date, generated_from")
    .eq("farm_id", farmId)
    .or(`due_date.gte.${bounds.start},completed_at.gte.${bounds.start},created_at.gte.${bounds.start}`)
    .limit(200);

  if (tasksError) throw tasksError;

  const logRows = (logs ?? []) as FieldLogRow[];
  const eventRows = (events ?? []) as EventRow[];
  const taskRows = (tasks ?? []) as TaskRow[];

  counts.logs = logRows.length;
  counts.objectEvents = eventRows.length;

  logRows.forEach((log) => {
    (log.action_types ?? []).forEach((action) => addActionCounts(counts, action));
    addActionCounts(counts, `${log.summary_sentence} ${log.note ?? ""}`);
  });

  eventRows.forEach((event) => addActionCounts(counts, `${event.event_type} ${event.note ?? ""}`));

  taskRows.forEach((task) => {
    const dueInPeriod = !task.due_date || (task.due_date >= bounds.start && task.due_date < bounds.end);
    if (!dueInPeriod) return;
    if (task.status === "done") counts.tasksDone += 1;
    if (task.status === "blocked") counts.tasksBlocked += 1;
    if (task.status === "open") counts.openTasks += 1;
    if (task.generated_from === "task_result") counts.followUps += 1;
  });

  return {
    period,
    label: bounds.label,
    startDate: bounds.start,
    endDate: bounds.end,
    counts,
    recent: recentLines(logRows, eventRows),
    carryForward: carryForwardLines(logRows, taskRows),
  };
}

export async function GET() {
  try {
    const farmId = await getFarmId();
    const today = isoDate(new Date());
    const summaries = await Promise.all([
      getSummary(farmId, today, "day"),
      getSummary(farmId, today, "week"),
      getSummary(farmId, today, "month"),
    ]);

    return NextResponse.json({ ok: true, today, summaries });
  } catch (error) {
    console.error("Atlas closeout load failed:", error);
    return NextResponse.json({ ok: false, error: "Atlas closeout load failed.", details: error instanceof Error ? error.message : "Unknown closeout error." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const farmId = await getFarmId();
    const body = (await request.json()) as { period?: Period; note?: string; carryForward?: string; nextFocus?: string; createdBy?: string };
    const period = body.period ?? "day";
    const note = body.note?.trim();
    const carryForward = body.carryForward?.trim() || null;
    const nextFocus = body.nextFocus?.trim() || null;
    const createdBy = body.createdBy?.trim() || "anna";
    const today = isoDate(new Date());

    if (!note) return NextResponse.json({ ok: false, error: "Closeout note required." }, { status: 400 });

    const summary = [
      `${today} · ${createdBy} closed ${period}.`,
      note,
      carryForward ? `Carry forward: ${carryForward}` : null,
      nextFocus ? `Next focus: ${nextFocus}` : null,
    ].filter(Boolean).join(" ");

    const { data, error } = await atlasSupabase.schema("atlas").from("field_logs").insert({
      farm_id: farmId,
      log_date: today,
      action_types: ["closeout", `${period}_closeout`],
      summary_sentence: summary,
      note,
      created_by: createdBy,
      source: "atlas_closeout",
      metadata: {
        closeout_period: period,
        carry_forward: carryForward,
        next_focus: nextFocus,
      },
    }).select("id").single();

    if (error) throw error;

    return NextResponse.json({ ok: true, fieldLogId: data.id });
  } catch (error) {
    console.error("Atlas closeout save failed:", error);
    return NextResponse.json({ ok: false, error: "Atlas closeout save failed.", details: error instanceof Error ? error.message : "Unknown closeout save error." }, { status: 500 });
  }
}
