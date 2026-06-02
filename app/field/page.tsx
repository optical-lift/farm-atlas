"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { farms, type FarmId } from "../../data/atlas/farms";
import { farmScopedKey, getActiveFarmId, setActiveFarmId } from "../../data/atlas/active-farm";
import { atlasTasksJuneJuly2026 } from "../../data/atlas/atlas-tasks-june-july-2026";
import { atlasAreas2026, getAtlasAreaLabel } from "../../data/atlas/atlas-areas-2026";
import type {
  AtlasActionType,
  AtlasAreaId,
  AtlasTask,
  AtlasTaskStateMap,
  AtlasTaskStatus,
} from "../../data/atlas/field-types";

const STORAGE_KEY = "atlas-field-mode-v1";
const GENERATED_TASKS_KEY = "atlas-field-mode-generated-tasks-v1";

const actionTypes: AtlasActionType[] = [
  "field_check",
  "direct_sow",
  "seed",
  "transplant",
  "water_check",
  "observe",
  "path",
  "record",
  "move",
  "pot_up",
  "handoff",
];

type TaskTab = "today" | "earlier" | "next";

type TaskCue = {
  icon: string;
  label: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function addDaysIso(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
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

function mergeTask(task: AtlasTask, stored: AtlasTaskStateMap): AtlasTask {
  return {
    ...task,
    status: stored[task.id]?.status ?? task.status,
  };
}

function getWatchTask(tasks: AtlasTask[], selectedDate: string, primaryId?: string) {
  return tasks.find((task) => {
    const text = `${task.title} ${task.instructions}`.toLowerCase();

    return (
      task.date === selectedDate &&
      task.id !== primaryId &&
      (text.includes("check") ||
        text.includes("germination") ||
        text.includes("water") ||
        text.includes("mark") ||
        task.status === "blocked")
    );
  });
}

function getActionCue(actionType: AtlasActionType): TaskCue {
  switch (actionType) {
    case "direct_sow":
      return { icon: "🌱", label: "Sow" };
    case "seed":
      return { icon: "✦", label: "Start" };
    case "transplant":
      return { icon: "⇄", label: "Plant" };
    case "pot_up":
      return { icon: "◌", label: "Pot up" };
    case "water_check":
      return { icon: "◍", label: "Water" };
    case "field_check":
      return { icon: "👁", label: "Check" };
    case "record":
      return { icon: "✎", label: "Record" };
    case "handoff":
      return { icon: "→", label: "Handoff" };
    case "observe":
      return { icon: "◇", label: "Observe" };
    case "move":
      return { icon: "✓", label: "Move" };
    case "path":
      return { icon: "⌁", label: "Path" };
    default:
      return { icon: "•", label: "Task" };
  }
}

function getDurationCue(task: AtlasTask): TaskCue {
  const text = `${task.title} ${task.instructions}`.toLowerCase();

  if (text.includes("quick") || text.includes("mark") || task.actionType === "observe") {
    return { icon: "◴", label: "5m" };
  }

  if (task.actionType === "water_check" || task.actionType === "field_check") {
    return { icon: "◴", label: "10m" };
  }

  if (task.actionType === "direct_sow" || task.actionType === "seed") {
    return { icon: "◴", label: "20m" };
  }

  if (task.actionType === "transplant" || task.actionType === "pot_up" || task.actionType === "move") {
    return { icon: "◴", label: "45m" };
  }

  if (task.actionType === "path") {
    return { icon: "◴", label: "1h+" };
  }

  return { icon: "◴", label: "15m" };
}

function getPlaceCue(task: AtlasTask): TaskCue {
  const area = getAtlasAreaLabel(task.areaId);
  const object = task.objectId?.trim();

  return { icon: "⌖", label: object || area };
}

function getSettingCue(task: AtlasTask): TaskCue {
  if (task.areaId === "seed_room" || task.actionType === "pot_up" || task.actionType === "seed") {
    return { icon: "⌂", label: "Inside" };
  }

  if (task.actionType === "record" || task.actionType === "handoff") {
    return { icon: "☉", label: "Desk" };
  }

  return { icon: "☀", label: "Outside" };
}

function getWeightCue(task: AtlasTask): TaskCue {
  const text = `${task.title} ${task.instructions}`.toLowerCase();

  if (text.includes("check") || text.includes("watch") || task.actionType === "field_check") {
    return { icon: "◷", label: "Watch" };
  }

  if (task.status === "blocked") {
    return { icon: "✕", label: "Blocked" };
  }

  return { icon: "✓", label: "Move" };
}

function getTaskCues(task: AtlasTask): TaskCue[] {
  return [
    getActionCue(task.actionType),
    getPlaceCue(task),
    getDurationCue(task),
    getSettingCue(task),
    getWeightCue(task),
  ];
}

function FieldModeInner() {
  const searchParams = useSearchParams();
  const requestedArea = searchParams.get("area") as AtlasAreaId | null;
  const shouldOpenAdd = searchParams.get("add") === "1";

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [activeFarmId, setActiveFarmIdState] = useState<FarmId>("elm");
  const [stored, setStored] = useState<AtlasTaskStateMap>({});
  const [generatedTasks, setGeneratedTasks] = useState<AtlasTask[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskTab>("today");
  const [showHeroDetail, setShowHeroDetail] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newAreaId, setNewAreaId] = useState<AtlasAreaId>("field_rows");
  const [newDate, setNewDate] = useState(todayIso());
  const [newActionType, setNewActionType] = useState<AtlasActionType>("field_check");
  const [newInstructions, setNewInstructions] = useState("");

  const storageKey = farmScopedKey(STORAGE_KEY, activeFarmId);
  const generatedTasksKey = farmScopedKey(GENERATED_TASKS_KEY, activeFarmId);

  useEffect(() => {
    const farmId = getActiveFarmId();
    setActiveFarmIdState(farmId);
    setStored(loadState(farmScopedKey(STORAGE_KEY, farmId)));
    setGeneratedTasks(loadGeneratedTasks(farmScopedKey(GENERATED_TASKS_KEY, farmId)));

    if (requestedArea && atlasAreas2026.some((area) => area.id === requestedArea)) {
      setNewAreaId(requestedArea);
    }

    if (shouldOpenAdd) {
      setShowAddTask(true);
    }
  }, [requestedArea, shouldOpenAdd]);

  useEffect(() => {
    setStored(loadState(storageKey));
    setGeneratedTasks(loadGeneratedTasks(generatedTasksKey));
  }, [storageKey, generatedTasksKey]);

  const tasks = useMemo(
    () =>
      [...atlasTasksJuneJuly2026, ...generatedTasks]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((task) => mergeTask(task, stored)),
    [stored, generatedTasks],
  );

  const visibleTasks = requestedArea
    ? tasks.filter((task) => task.areaId === requestedArea)
    : tasks;

  const todayTasks = visibleTasks.filter((task) => task.date === selectedDate);
  const openTodayTasks = todayTasks.filter((task) => task.status === "open");
  const primaryTask = openTodayTasks[0] ?? todayTasks[0];

  const watchTask = getWatchTask(visibleTasks, selectedDate, primaryTask?.id);

  const earlierTasks = visibleTasks
    .filter((task) => task.date < selectedDate && task.status === "open")
    .slice(0, 8);

  const nextTasks = visibleTasks
    .filter((task) => task.date > selectedDate)
    .slice(0, 8);

  const tabTasks =
    activeTab === "today"
      ? todayTasks
      : activeTab === "earlier"
        ? earlierTasks
        : nextTasks;

  const openCount = visibleTasks.filter((task) => task.status === "open").length;
  const doneCount = visibleTasks.filter((task) => task.status === "done").length;
  const blockedCount = visibleTasks.filter((task) => task.status === "blocked").length;

  const activeFarm = farms.find((farm) => farm.id === activeFarmId);

  function handleFarmChange(farmId: FarmId) {
    setActiveFarmId(farmId);
    setActiveFarmIdState(farmId);
    setStored(loadState(farmScopedKey(STORAGE_KEY, farmId)));
    setGeneratedTasks(loadGeneratedTasks(farmScopedKey(GENERATED_TASKS_KEY, farmId)));
  }

  function setTaskStatus(task: AtlasTask, status: AtlasTaskStatus) {
    const next = {
      ...stored,
      [task.id]: {
        status,
        updatedAt: new Date().toISOString(),
      },
    };

    setStored(next);
    saveState(storageKey, next);

    const effects =
      status === "done" ? task.ifDone ?? [] : status === "skipped" ? task.ifSkipped ?? [] : [];

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
          unlockText: `Follow-up from ${task.title}.`,
          status: "open",
        };
      });

    if (followupTasks.length > 0) {
      const existingIds = new Set(generatedTasks.map((task) => task.id));
      const newFollowups = followupTasks.filter((task) => !existingIds.has(task.id));

      if (newFollowups.length > 0) {
        const nextGeneratedTasks = [...generatedTasks, ...newFollowups].sort((a, b) =>
          a.date.localeCompare(b.date),
        );

        setGeneratedTasks(nextGeneratedTasks);
        saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);
      }
    }
  }

  function resetTask(task: AtlasTask) {
    const next = { ...stored };
    delete next[task.id];
    setStored(next);
    saveState(storageKey, next);
  }

  function addCustomTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newTitle.trim()) return;

    const task: AtlasTask = {
      id: `custom-${Date.now()}`,
      date: newDate,
      title: newTitle.trim(),
      areaId: newAreaId,
      actionType: newActionType,
      instructions:
        newInstructions.trim() || `Added for ${getAtlasAreaLabel(newAreaId)}.`,
      unlockText: "Manual task.",
      status: "open",
    };

    const nextGeneratedTasks = [...generatedTasks, task].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    setGeneratedTasks(nextGeneratedTasks);
    saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);
    setSelectedDate(task.date);
    setActiveTab("today");
    setNewTitle("");
    setNewInstructions("");
    setShowAddTask(false);
  }

  return (
    <main className="atlas-phone-shell">
      <section className="atlas-phone">
        <header className="atlas-phone-top with-weather">
<div className="atlas-phone-brand atlas-title-weather">
  <Link href="/" className="atlas-phone-kicker">
    ← Atlas
  </Link>

<div className="atlas-title-row">
  <strong className="atlas-phone-title">{activeFarm?.label ?? "Farm"}</strong>

  <select
    aria-label="Choose farm"
    className="atlas-farm-inline-select"
    value={activeFarmId}
    onChange={(event) => handleFarmChange(event.target.value as FarmId)}
  >
    {farms.map((farm) => (
      <option key={farm.id} value={farm.id}>
        {farm.label}
      </option>
    ))}
  </select>
</div>
</div>

<div className="atlas-weather-center">☁ 61°</div>

<div className="atlas-phone-actions">
  <button
    type="button"
    className="atlas-plus-square"
    onClick={() => setShowAddTask((value) => !value)}
    aria-label="Add task"
    title="Add task"
  >
    +
  </button>
</div>

        </header>

        <div className="atlas-phone-body">
          <section className="atlas-hero-compact">
            <div className="atlas-hero-top">
              <h1 className="atlas-hero-title">Today</h1>

              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="atlas-soft-date"
              />
            </div>

            <div className="atlas-hero-grid">
              <button
                type="button"
                className="atlas-hero-tile atlas-hero-tile-button"
                onClick={() => setShowHeroDetail((value) => !value)}
              >
                <span className="atlas-soft-label">Do</span>
                <strong>{primaryTask?.title ?? "No task"}</strong>
                <em>{primaryTask ? getAtlasAreaLabel(primaryTask.areaId) : "+ Task"}</em>
                {primaryTask && <TaskCues task={primaryTask} compact max={2} />}
              </button>

              <button
                type="button"
                className="atlas-hero-tile atlas-hero-tile-button"
                onClick={() => setShowHeroDetail(false)}
              >
                <span className="atlas-soft-label">Watch</span>
                <strong>{watchTask?.title ?? "Clear"}</strong>
                <em>{watchTask ? getAtlasAreaLabel(watchTask.areaId) : "No check"}</em>
                {watchTask && <TaskCues task={watchTask} compact max={2} />}
              </button>
            </div>

            {showHeroDetail && primaryTask && (
              <HeroTaskDetail
                task={primaryTask}
                onDone={() => setTaskStatus(primaryTask, "done")}
                onBlocked={() => setTaskStatus(primaryTask, "blocked")}
                onSkipped={() => setTaskStatus(primaryTask, "skipped")}
                onClose={() => setShowHeroDetail(false)}
              />
            )}

            <div className="atlas-hero-stats">
              <div className="atlas-hero-stat">
                <span>Open</span>
                <strong>{openCount}</strong>
              </div>
              <div className="atlas-hero-stat">
                <span>Done</span>
                <strong>{doneCount}</strong>
              </div>
              <div className="atlas-hero-stat">
                <span>Block</span>
                <strong>{blockedCount}</strong>
              </div>
            </div>
          </section>

          <div className="atlas-tab-row">
            <button
              type="button"
              className={`atlas-tab ${activeTab === "today" ? "active" : ""}`}
              onClick={() => setActiveTab("today")}
            >
              Today
            </button>
            <button
              type="button"
              className={`atlas-tab ${activeTab === "earlier" ? "active" : ""}`}
              onClick={() => setActiveTab("earlier")}
            >
              Earlier
            </button>
            <button
              type="button"
              className={`atlas-tab ${activeTab === "next" ? "active" : ""}`}
              onClick={() => setActiveTab("next")}
            >
              Next
            </button>
          </div>

          {showAddTask && (
            <section className="atlas-soft-card tight">
              <div className="atlas-soft-head">
                <strong className="atlas-soft-heading">Add task</strong>

                <button
                  type="button"
                  className="atlas-phone-pill"
                  onClick={() => setShowAddTask(false)}
                >
                  Close
                </button>
              </div>

              <form onSubmit={addCustomTask} className="atlas-add-form">
                <label>
                  <span className="atlas-soft-label">Task</span>
                  <input
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder="Weed Main Garden edge"
                  />
                </label>

                <label>
                  <span className="atlas-soft-label">Area</span>
                  <select
                    value={newAreaId}
                    onChange={(event) => setNewAreaId(event.target.value as AtlasAreaId)}
                  >
                    {atlasAreas2026.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Date</span>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(event) => setNewDate(event.target.value)}
                  />
                </label>

                <label>
                  <span className="atlas-soft-label">Type</span>
                  <select
                    value={newActionType}
                    onChange={(event) => setNewActionType(event.target.value as AtlasActionType)}
                  >
                    {actionTypes.map((action) => (
                      <option key={action} value={action}>
                        {action.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Note</span>
                  <textarea
                    value={newInstructions}
                    onChange={(event) => setNewInstructions(event.target.value)}
                    placeholder="What needs to happen?"
                  />
                </label>

                <button className="atlas-phone-pill primary" style={{ width: "100%" }}>
                  Save
                </button>
              </form>
            </section>
          )}

          <section className="atlas-task-list">
            {tabTasks.length > 0 ? (
              tabTasks.map((task) => (
                <TaskWorkCard
                  key={task.id}
                  task={task}
                  storedState={stored[task.id]}
                  isPrimary={task.id === primaryTask?.id && activeTab === "today"}
                  onDone={() => setTaskStatus(task, "done")}
                  onBlocked={() => setTaskStatus(task, "blocked")}
                  onSkipped={() => setTaskStatus(task, "skipped")}
                  onReset={() => resetTask(task)}
                />
              ))
            ) : (
              <div className="atlas-empty">None</div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function HeroTaskDetail({
  task,
  onDone,
  onBlocked,
  onSkipped,
  onClose,
}: {
  task: AtlasTask;
  onDone: () => void;
  onBlocked: () => void;
  onSkipped: () => void;
  onClose: () => void;
}) {
  return (
    <div className="atlas-hero-detail">
      <div className="atlas-hero-detail-title">{task.title}</div>

      <TaskCues task={task} compact />

      <div className="atlas-detail-grid">
        <div className="atlas-detail-row">
          <span>When</span>
          <strong>{prettyDate(task.date)} · {getDurationCue(task).label}</strong>
        </div>

        <div className="atlas-detail-row">
          <span>Where</span>
          <strong>{getPlaceCue(task).label}</strong>
        </div>

        <div className="atlas-detail-row">
          <span>How</span>
          <strong>{task.instructions}</strong>
        </div>

        <div className="atlas-detail-row">
          <span>Why</span>
          <strong>{task.unlockText}</strong>
        </div>
      </div>

      <div className="atlas-hero-icon-actions">
        <button type="button" className="atlas-hero-icon-tap" onClick={onDone} aria-label="Done">
          ✓
        </button>

        <button type="button" className="atlas-hero-icon-tap" onClick={onBlocked} aria-label="Block">
          ✕
        </button>

        <button type="button" className="atlas-hero-icon-tap" onClick={onSkipped} aria-label="Skip">
          ↷
        </button>

        <button type="button" className="atlas-hero-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function TaskCues({
  task,
  compact = false,
  max,
}: {
  task: AtlasTask;
  compact?: boolean;
  max?: number;
}) {
  const cues = typeof max === "number" ? getTaskCues(task).slice(0, max) : getTaskCues(task);

  return (
    <div className={`atlas-cue-row ${compact ? "compact" : ""}`}>
      {cues.map((cue) => (
        <span className="atlas-cue" key={`${task.id}-${cue.icon}-${cue.label}`}>
          <span className="atlas-cue-icon">{cue.icon}</span>
          <span className="atlas-cue-label">{cue.label}</span>
        </span>
      ))}
    </div>
  );
}

function TaskIconActions({
  onDone,
  onBlocked,
  onSkipped,
  onReset,
  showReset,
}: {
  onDone: () => void;
  onBlocked: () => void;
  onSkipped: () => void;
  onReset: () => void;
  showReset?: boolean;
}) {
  return (
    <div className="atlas-icon-actions">
      <button
        type="button"
        className="atlas-icon-tap"
        onClick={onDone}
        aria-label="Done"
        title="Done"
      >
        ✓
      </button>

      <button
        type="button"
        className="atlas-icon-tap"
        onClick={onBlocked}
        aria-label="Block"
        title="Block"
      >
        ✕
      </button>

      <button
        type="button"
        className="atlas-icon-tap"
        onClick={onSkipped}
        aria-label="Skip"
        title="Skip"
      >
        ↷
      </button>

      {showReset ? (
        <button type="button" className="atlas-reset-link" onClick={onReset}>
          Reset
        </button>
      ) : null}
    </div>
  );
}

function TaskWorkCard({
  task,
  storedState,
  isPrimary,
  onDone,
  onBlocked,
  onSkipped,
  onReset,
}: {
  task: AtlasTask;
  storedState?: AtlasTaskStateMap[string];
  isPrimary?: boolean;
  onDone: () => void;
  onBlocked: () => void;
  onSkipped: () => void;
  onReset: () => void;
}) {
  return (
    <article className="atlas-primary-card">
      <div className="atlas-primary-top">
        <div>
          <span className="atlas-phone-kicker">
            {isPrimary ? "Now" : prettyDate(task.date)}
          </span>
          <h2 className="atlas-primary-title">{task.title}</h2>
        </div>

        <span className="atlas-primary-status">{task.status}</span>
      </div>

      <TaskCues task={task} />

      <p className="atlas-primary-text">{task.instructions}</p>

      <TaskIconActions
        onDone={onDone}
        onBlocked={onBlocked}
        onSkipped={onSkipped}
        onReset={onReset}
        showReset={Boolean(storedState)}
      />
    </article>
  );
}

export default function AtlasFieldModePage() {
  return (
    <Suspense fallback={<main className="atlas-phone-shell">Loading Atlas…</main>}>
      <FieldModeInner />
    </Suspense>
  );
}
