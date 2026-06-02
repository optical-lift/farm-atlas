"use client";

import { farms, type FarmId } from "../../data/atlas/farms";
import { farmScopedKey, getActiveFarmId, setActiveFarmId } from "../../data/atlas/active-farm";
import React, { useEffect, useMemo, useState } from "react";
import { atlasTasksJuneJuly2026 } from "../../data/atlas/atlas-tasks-june-july-2026";
import { atlasAreas2026, getAtlasAreaLabel } from "../../data/atlas/atlas-areas-2026";
import type { AtlasTask, AtlasTaskStatus, AtlasTaskStateMap } from "../../data/atlas/field-types";

const STORAGE_KEY = "atlas-field-mode-v1";

const GENERATED_TASKS_KEY = "atlas-field-mode-generated-tasks-v1";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function loadState(storageKey: string): AtlasTaskStateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveState(storageKey: string, next: AtlasTaskStateMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

function loadGeneratedTasks(generatedTasksKey: string): AtlasTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(generatedTasksKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveGeneratedTasks(generatedTasksKey: string, next: AtlasTask[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(generatedTasksKey, JSON.stringify(next));
}

function addDaysIso(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function getNextOpenTaskDate(tasks: AtlasTask[], currentDate: string) {
  return (
    tasks.find((task) => task.date >= currentDate && task.status === "open")?.date ??
    tasks.find((task) => task.status === "open")?.date ??
    currentDate
  );
}


function getAreaGuardrail(areaId: AtlasTask["areaId"]) {
  return atlasAreas2026.find((area) => area.id === areaId)?.guardrail ?? "";
}

function getWatchTasks(tasks: AtlasTask[], selectedDate: string) {
  return tasks.filter((task) => {
    const title = task.title.toLowerCase();
    const instructions = task.instructions.toLowerCase();

    const isWatchTask =
      title.includes("check") ||
      title.includes("germination") ||
      title.includes("water") ||
      title.includes("mark") ||
      instructions.includes("check") ||
      instructions.includes("germination") ||
      task.status === "blocked";

    return task.date === selectedDate && isWatchTask;
  });
}

function mergeTask(task: AtlasTask, stored: AtlasTaskStateMap): AtlasTask {
  return {
    ...task,
    status: stored[task.id]?.status ?? task.status,
  };
}

function actionLabel(status: AtlasTaskStatus) {
  switch (status) {
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
    case "blocked":
      return "Blocked";
    case "observed":
      return "Observed";
    default:
      return "Open";
  }
}

function statusClass(status: AtlasTaskStatus) {
  switch (status) {
    case "done":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "skipped":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "blocked":
      return "bg-red-100 text-red-900 border-red-200";
    case "observed":
      return "bg-amber-100 text-amber-900 border-amber-200";
    default:
      return "bg-white text-slate-700 border-slate-200";
  }
}

export default function AtlasFieldModePage() {
  const [selectedDate, setSelectedDate] = useState(todayIso());
const [activeFarmId, setActiveFarmIdState] = useState<FarmId>("elm");
  const [stored, setStored] = useState<AtlasTaskStateMap>({});
const [generatedTasks, setGeneratedTasks] = useState<AtlasTask[]>([]);
  const [noteText, setNoteText] = useState("");
  const [blockerText, setBlockerText] = useState("");

const storageKey = farmScopedKey(STORAGE_KEY, activeFarmId);
const generatedTasksKey = farmScopedKey(GENERATED_TASKS_KEY, activeFarmId);

useEffect(() => {
  const farmId = getActiveFarmId();
  setActiveFarmIdState(farmId);
  setStored(loadState(farmScopedKey(STORAGE_KEY, farmId)));
  setGeneratedTasks(loadGeneratedTasks(farmScopedKey(GENERATED_TASKS_KEY, farmId)));
}, []);

useEffect(() => {
  setStored(loadState(storageKey));
  setGeneratedTasks(loadGeneratedTasks(generatedTasksKey));
}, [storageKey, generatedTasksKey]);

const tasks = useMemo(
  () =>
    [...atlasTasksJuneJuly2026, ...generatedTasks]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((task) => mergeTask(task, stored)),
  [stored, generatedTasks]
);

  const todayTasks = tasks.filter((task) => task.date === selectedDate);
  const openTodayTasks = todayTasks.filter((task) => task.status === "open");
  const primaryTask = openTodayTasks[0] ?? todayTasks[0];

const watchTasks = getWatchTasks(tasks, selectedDate).filter(
  (task) => task.id !== primaryTask?.id
);

const primaryGuardrail = primaryTask ? getAreaGuardrail(primaryTask.areaId) : "";

  const overdueOpenTasks = tasks
    .filter((task) => task.date < selectedDate && task.status === "open")
    .slice(0, 8);

  const upcomingTasks = tasks
    .filter((task) => task.date > selectedDate)
    .slice(0, 7);

  const doneCount = tasks.filter((task) => task.status === "done").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const observedCount = tasks.filter((task) => task.status === "observed").length;
  const openCount = tasks.filter((task) => task.status === "open").length;

function handleFarmChange(farmId: FarmId) {
  setActiveFarmId(farmId);
  setActiveFarmIdState(farmId);
  setStored(loadState(farmScopedKey(STORAGE_KEY, farmId)));
  setGeneratedTasks(loadGeneratedTasks(farmScopedKey(GENERATED_TASKS_KEY, farmId)));
}

function setTaskStatus(
  task: AtlasTask,
  status: AtlasTaskStatus,
  extra: Partial<AtlasTaskStateMap[string]> = {}
) {
  const next = {
    ...stored,
    [task.id]: {
      status,
      updatedAt: new Date().toISOString(),
      ...extra,
    },
  };

  setStored(next);
  saveState(storageKey, next);

  const effects =
    status === "done"
      ? task.ifDone ?? []
      : status === "skipped"
        ? task.ifSkipped ?? []
        : [];

  const followupTasks: AtlasTask[] = effects
    .filter((effect) => effect.type === "create_followup_task")
    .map((effect, index) => {
      const followupDate = addDaysIso(task.date, effect.daysAfter);
      return {
        id: `generated-${task.id}-${followupDate}-${index}`,
        date: followupDate,
        title: effect.title,
        areaId: task.areaId,
        objectId: task.objectId,
        actionType: effect.actionType,
        instructions: effect.title,
        unlockText:
          status === "done"
            ? `Follow-up created because ${task.objectId ?? task.title} was marked done.`
            : `Retry created because ${task.title} was skipped.`,
        status: "open",
      };
    });

  if (followupTasks.length > 0) {
    const existingIds = new Set(generatedTasks.map((task) => task.id));
    const newFollowups = followupTasks.filter((task) => !existingIds.has(task.id));

    if (newFollowups.length > 0) {
      const nextGeneratedTasks = [...generatedTasks, ...newFollowups].sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      setGeneratedTasks(nextGeneratedTasks);
      saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);
    }
  }

  setNoteText("");
  setBlockerText("");
}

  function resetTask(task: AtlasTask) {
    const next = { ...stored };
    delete next[task.id];
    setStored(next);
    saveState(storageKey, next);
  }

function clearAllProgress() {
  if (!window.confirm("Clear all Atlas Field Mode progress from this browser?")) return;
  setStored({});
  setGeneratedTasks([]);
saveState(storageKey, {});
saveGeneratedTasks(generatedTasksKey, []);
}

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-4 py-5 text-slate-950 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
<FarmSwitcher activeFarmId={activeFarmId} onFarmChange={handleFarmChange} />
       <CommandHud
  selectedDate={selectedDate}
  setSelectedDate={setSelectedDate}
  tasks={tasks}
  primaryTask={primaryTask}
  watchTasks={watchTasks}
  guardrail={primaryGuardrail}
  openCount={openCount}
  doneCount={doneCount}
  blockedCount={blockedCount}
  observedCount={observedCount}
/>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                {prettyDate(selectedDate)}
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                {primaryTask ? "Primary action" : "No task scheduled"}
              </h2>
            </div>
            {primaryTask && (
              <span
                className={`w-fit rounded-full border px-3 py-1 text-sm font-semibold ${statusClass(
                  primaryTask.status
                )}`}
              >
                {actionLabel(primaryTask.status)}
              </span>
            )}
          </div>

          {primaryTask ? (
            <TaskCard
              task={primaryTask}
              noteText={noteText}
              blockerText={blockerText}
              onNoteText={setNoteText}
              onBlockerText={setBlockerText}
              onDone={() => setTaskStatus(primaryTask, "done")}
              onSkipped={() => setTaskStatus(primaryTask, "skipped")}
              onObserved={() =>
                setTaskStatus(primaryTask, "observed", {
                  observation: noteText || "Observed without note.",
                })
              }
              onBlocked={() =>
                setTaskStatus(primaryTask, "blocked", {
                  blockerReason: blockerText || "Blocked without reason.",
                })
              }
              onReset={() => resetTask(primaryTask)}
              storedState={stored[primaryTask.id]}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-slate-600">
              Nothing is scheduled for this date. Use the date picker to jump into June or July 2026.
            </div>
          )}
        </section>

        {todayTasks.length > 1 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold">Other tasks today</h2>
            <div className="mt-3 grid gap-3">
              {todayTasks
                .filter((task) => task.id !== primaryTask?.id)
                .map((task) => (
                  <CompactTaskRow
                    key={task.id}
                    task={task}
                    storedState={stored[task.id]}
                    onDone={() => setTaskStatus(task, "done")}
                    onSkip={() => setTaskStatus(task, "skipped")}
                    onReset={() => resetTask(task)}
                  />
                ))}
            </div>
          </section>
        )}

        {overdueOpenTasks.length > 0 && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <h2 className="text-xl font-semibold">Open earlier tasks</h2>
            <p className="mt-1 text-sm text-amber-900">
              These did not disappear. Choose still do, skip, or block when you reach them.
            </p>
            <div className="mt-3 grid gap-3">
              {overdueOpenTasks.map((task) => (
                <CompactTaskRow
                  key={task.id}
                  task={task}
                  storedState={stored[task.id]}
                  onDone={() => setTaskStatus(task, "done")}
                  onSkip={() => setTaskStatus(task, "skipped")}
                  onReset={() => resetTask(task)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Next seven scheduled actions</h2>
          <div className="mt-3 grid gap-3">
            {upcomingTasks.map((task) => (
              <CompactTaskRow
                key={task.id}
                task={task}
                storedState={stored[task.id]}
                onDone={() => setTaskStatus(task, "done")}
                onSkip={() => setTaskStatus(task, "skipped")}
                onReset={() => resetTask(task)}
              />
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Area guardrails</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {atlasAreas2026
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((area) => (
                <div key={area.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{area.label}</h3>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                      Priority {area.priority}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{area.currentGoal}</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">Guardrail: {area.guardrail}</p>
                </div>
              ))}
          </div>
        </section>

        <button
          type="button"
          onClick={clearAllProgress}
          className="mx-auto mb-10 w-fit rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600"
        >
          Clear local progress
        </button>
      </div>
    </main>
  );
}
function CommandHud({
  selectedDate,
  setSelectedDate,
  tasks,
  primaryTask,
  watchTasks,
  guardrail,
  openCount,
  doneCount,
  blockedCount,
  observedCount,
}: {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  tasks: AtlasTask[];
  primaryTask?: AtlasTask;
  watchTasks: AtlasTask[];
  guardrail: string;
  openCount: number;
  doneCount: number;
  blockedCount: number;
  observedCount: number;
}) {
  const firstWatch = watchTasks[0];

  const palette = {
    ink: "#343747",
    inkSoft: "#555b89",
    lavender: "#737aaa",
    periwinkle: "#858caf",
    mauve: "#a58e9d",
    olive: "#b9bf57",
    moss: "#7b7159",
    cream: "#f7f3e7",
    mist: "#d8d8e6",
  };

  return (
    <header
  className="rounded-[2rem] border p-3 shadow-sm sm:p-5"
      style={{
        background:
          "linear-gradient(135deg, #555b89 0%, #737aaa 42%, #858caf 100%)",
        borderColor: "rgba(255,255,255,0.38)",
        color: palette.cream,
      }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.28em]"
            style={{ color: "#d8d8e6" }}
          >
            Atlas Field Mode
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-3xl">
            Today’s Farm Board
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#f7f3e7" }}>
            Bite-sized actions first. Full task detail below.
          </p>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <label
            className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.16em]"
            style={{ color: "#d8d8e6" }}
          >
            Working date
            <input
              type="date"
              className="rounded-2xl border px-4 py-2 text-base font-semibold"
              style={{
                background: "#f7f3e7",
                color: "#343747",
                borderColor: "rgba(255,255,255,0.55)",
              }}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <HudButton onClick={() => setSelectedDate(todayIso())}>
              Today
            </HudButton>

            <HudButton onClick={() => setSelectedDate(addDaysIso(todayIso(), 1))}>
              Tomorrow
            </HudButton>

            <HudButton onClick={() => setSelectedDate("2026-06-01")}>
              June Plan
            </HudButton>

            <button
              type="button"
              onClick={() => setSelectedDate(getNextOpenTaskDate(tasks, selectedDate))}
              className="rounded-full px-3 py-2 text-sm font-semibold shadow-sm"
              style={{
                background: "#b9bf57",
                color: "#343747",
              }}
            >
              Next Open
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-[1.1fr_1.1fr_1fr]">
        <HudPanel label="Do Now">
          {primaryTask ? (
            <>
              <p className="truncate text-base font-semibold sm:text-lg">
                {primaryTask.title}
              </p>
              <p className="mt-1 text-xs" style={{ color: "#d8d8e6" }}>
                {primaryTask.objectId ? `${primaryTask.objectId} · ` : ""}
                {getAtlasAreaLabel(primaryTask.areaId)}
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "#d8d8e6" }}>
              No task scheduled.
            </p>
          )}
        </HudPanel>

        <HudPanel label="Watch">
          {firstWatch ? (
            <>
              <p className="truncate text-base font-semibold sm:text-lg">
                {firstWatch.title}
              </p>
              <p className="mt-1 text-xs" style={{ color: "#d8d8e6" }}>
                {getAtlasAreaLabel(firstWatch.areaId)}
                {watchTasks.length > 1 ? ` · +${watchTasks.length - 1} more` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "#d8d8e6" }}>
              No checks or blockers due.
            </p>
          )}
        </HudPanel>

        <HudPanel label="Do Not Forget">
          <p className="line-clamp-2 text-sm leading-5" style={{ color: "#f7f3e7" }}>
            {guardrail || "Keep the next action small and real."}
          </p>
        </HudPanel>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <MiniStat label="Open" value={openCount} />
        <MiniStat label="Done" value={doneCount} />
        <MiniStat label="Blocked" value={blockedCount} />
        <MiniStat label="Observed" value={observedCount} />
      </div>
    </header>
  );
}

function HudButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-2 text-sm font-semibold"
      style={{
        background: "rgba(247,243,231,0.14)",
        borderColor: "rgba(247,243,231,0.32)",
        color: "#f7f3e7",
      }}
    >
      {children}
    </button>
  );
}

function HudPanel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-2.5 sm:p-3"
      style={{
        background: "rgba(52,55,71,0.42)",
        borderColor: "rgba(247,243,231,0.18)",
      }}
    >
      <p
        className="text-[0.65rem] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "#d8d8e6" }}
      >
        {label}
      </p>
      <div className="mt-1 min-h-10">{children}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-2xl border px-2.5 py-1.5 sm:px-3 sm:py-2"
      style={{
        background: "rgba(247,243,231,0.12)",
        borderColor: "rgba(247,243,231,0.18)",
      }}
    >
      <p
        className="text-[0.62rem] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "#d8d8e6" }}
      >
        {label}
      </p>
      <p className="text-xl font-semibold leading-none" style={{ color: "#f7f3e7" }}>
        {value}
      </p>
    </div>
  );
}



function ScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function TaskCard({
  task,
  storedState,
  noteText,
  blockerText,
  onNoteText,
  onBlockerText,
  onDone,
  onSkipped,
  onObserved,
  onBlocked,
  onReset,
}: {
  task: AtlasTask;
  storedState?: AtlasTaskStateMap[string];
  noteText: string;
  blockerText: string;
  onNoteText: (value: string) => void;
  onBlockerText: (value: string) => void;
  onDone: () => void;
  onSkipped: () => void;
  onObserved: () => void;
  onBlocked: () => void;
  onReset: () => void;
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-[#fbfaf6] p-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-slate-500">{getAtlasAreaLabel(task.areaId)}</p>
        <h3 className="text-2xl font-semibold">{task.title}</h3>
        {task.objectId && (
          <p className="w-fit rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">
            Object: {task.objectId}
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-3">
        {task.packet && <InfoBlock label="Packet" value={task.packet} />}
        <InfoBlock label="Instructions" value={task.instructions} />
        {task.also && <InfoBlock label="Also" value={task.also} />}
        <InfoBlock label="Unlock" value={task.unlockText} strong />
      </div>

      {storedState?.blockerReason && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
          <strong>Blocked reason:</strong> {storedState.blockerReason}
        </div>
      )}

      {storedState?.observation && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Observation:</strong> {storedState.observation}
        </div>
      )}

{storedState?.status === "done" && (
  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
    <strong>Done:</strong> This action is complete. Atlas saved it in this browser.
  </div>
)}

{storedState?.status === "skipped" && (
  <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-100 p-4 text-sm text-slate-800">
    <strong>Skipped:</strong> This action was skipped. It is not counted as completed.
  </div>
)}

      <div className="mt-5 grid gap-3">
        <textarea
          value={noteText}
          onChange={(event) => onNoteText(event.target.value)}
          placeholder="Observation note, if needed..."
          className="min-h-24 rounded-2xl border border-slate-300 bg-white p-3 text-base"
        />
        <textarea
          value={blockerText}
          onChange={(event) => onBlockerText(event.target.value)}
          placeholder="Blocker reason, if blocked..."
          className="min-h-24 rounded-2xl border border-slate-300 bg-white p-3 text-base"
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button type="button" onClick={onDone} className="rounded-2xl bg-slate-950 px-4 py-3 font-semibold text-white">
          Done
        </button>
        <button type="button" onClick={onSkipped} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 font-semibold">
          Skipped
        </button>
        <button type="button" onClick={onBlocked} className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 font-semibold text-red-950">
          Blocked
        </button>
        <button type="button" onClick={onObserved} className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-950">
          Observed
        </button>
        <button type="button" onClick={onReset} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-600">
          Reset
        </button>
      </div>

      {task.ifDone && task.ifDone.length > 0 && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            If marked done
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {task.ifDone.map((effect, index) => (
              <li key={index}>{describeEffect(effect)}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function CompactTaskRow({
  task,
  storedState,
  onDone,
  onSkip,
  onReset,
}: {
  task: AtlasTask;
  storedState?: AtlasTaskStateMap[string];
  onDone: () => void;
  onSkip: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {task.date} · {getAtlasAreaLabel(task.areaId)}
          </p>
          <h3 className="mt-1 font-semibold">{task.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{task.unlockText}</p>
          {storedState?.blockerReason && (
            <p className="mt-1 text-sm text-red-800">Blocked: {storedState.blockerReason}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${statusClass(task.status)}`}>
            {actionLabel(task.status)}
          </span>
          <button type="button" onClick={onDone} className="rounded-full bg-slate-950 px-3 py-1 text-sm font-semibold text-white">
            Done
          </button>
          <button type="button" onClick={onSkip} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold">
            Skip
          </button>
          {task.status !== "open" && (
            <button type="button" onClick={onReset} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-600">
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-1 ${strong ? "text-lg font-semibold text-slate-950" : "text-slate-700"}`}>
        {value}
      </p>
    </div>
  );
}

function describeEffect(effect: NonNullable<AtlasTask["ifDone"]>[number]) {
  switch (effect.type) {
    case "set_object_state":
      return `${effect.objectId} changes to ${effect.nextState}.`;
    case "create_followup_task":
      return `Creates follow-up in ${effect.daysAfter} day(s): ${effect.title}.`;
    case "start_timer":
      return `Starts ${effect.timerName} timer for ${effect.objectId}: ${effect.days} day(s).`;
    case "unlock_chain":
      return `Unlocks ${effect.chainId}: ${effect.unlockText}`;
    default:
      return "Applies effect.";
  }
}


function FarmSwitcher({
  activeFarmId,
  onFarmChange,
}: {
  activeFarmId: FarmId;
  onFarmChange: (farmId: FarmId) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white/85 px-4 py-3 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Active Farm
        </p>
        <p className="text-lg font-semibold text-slate-950">
          {farms.find((farm) => farm.id === activeFarmId)?.label ?? activeFarmId}
        </p>
      </div>

      <select
        value={activeFarmId}
        onChange={(event) => onFarmChange(event.target.value as FarmId)}
        className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-950"
      >
        {farms.map((farm) => (
          <option key={farm.id} value={farm.id}>
            {farm.label}
          </option>
        ))}
      </select>
    </div>
  );
}