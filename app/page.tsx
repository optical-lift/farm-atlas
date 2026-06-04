"use client";

import React, { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasDashboard,
  type AtlasDashboardZone,
} from "@/lib/atlas/dashboard-client";
import { createAtlasFieldLog } from "@/lib/atlas/field-log-client";

import {
  fetchAtlasTaskCards,
  type AtlasTaskCard,
} from "@/lib/atlas/task-cards-client";

import {
  fetchAtlasProjects,
  type AtlasProjectCard,
} from "@/lib/atlas/projects-client";

import {
  saveAtlasTaskResult,
  type AtlasTaskResult,
} from "@/lib/atlas/task-result-client";

import { atlasTasksJuneJuly2026 } from "../data/atlas/atlas-tasks-june-july-2026";
import {
  atlasAreas2026,
  getAtlasAreaLabel,
} from "../data/atlas/atlas-areas-2026";
import {
  cropProfiles,
  type CropProfileId,
} from "../data/atlas/crop-profiles";
import {
  deriveClaim,
  getAreaInventorySummary,
} from "../data/atlas/claim-automation";
import {
  plantingClaims,
  type PlantingClaim,
} from "../data/atlas/planting-claims";
import {
  getDefaultGrowingObjectForArea,
  getGrowingObjectLabel,
  getPlantingObjectsForArea,
  getTaskObjectsForArea,
} from "../data/atlas/growing-objects";
import { getAreaObjectStateSummary } from "../data/atlas/object-state";
import type {
  AtlasActionType,
  AtlasAreaId,
  AtlasTask,
  AtlasTaskStateMap,
  AtlasTaskStatus,
} from "../data/atlas/field-types";

import {
  bedRecords,
  type BedRecord,
  type BedContent,
  type BedObservation,
} from "../data/atlas/bed-records";

type TaskTab = "today" | "zones" | "projects" | "log";

type QuickPlantItem = {
  id: string;
  cropId: string;
  quantity: number;
  unit: string;
  sourceType: "hardened_seedling" | "division" | "nursery_purchase";
};

type WorkAction =
  | "weeded"
  | "sowed"
  | "planted"
  | "watered"
  | "checked"
  | "harvested"
  | "moved"
  | "observed"
  | "maintained";

type FieldLogEntry = {
  id: string;
  createdAt: string;
  date: string;
  title: string;
  detail: string;
  actions: WorkAction[];
  areaIds: AtlasAreaId[];
  objectIds: string[];
  note?: string;
  source: "quick_log" | "task" | "planting_claim";
};


type ProjectStep = {
  id: string;
  title: string;
  done: boolean;
  blocked?: boolean;
};

type AtlasProject = {
  id: string;
  title: string;
  areaId: AtlasAreaId;
  purpose: string;
  steps: ProjectStep[];
};

type ProjectStepTemplate = {
  id: string;
  title: string;
  blocked?: boolean;
};

type AtlasProjectTemplate = {
  id: string;
  title: string;
  areaId: AtlasAreaId;
  purpose: string;
  steps: ProjectStepTemplate[];
};

function fieldRowsClaimedCount(claims: PlantingClaim[]) {
  const objectIds = new Set<string>();
  let looseFullBedCount = 0;

  claims
    .filter((claim) => claim.areaId === "field_rows")
    .forEach((claim) => {
      if (claim.objectId) {
        objectIds.add(claim.objectId);
        return;
      }

      if (claim.unit === "full_bed") {
        looseFullBedCount += claim.unitCount;
      }
    });

  return objectIds.size + looseFullBedCount;
}

function textHasAny(text: string, words: string[]) {
  const cleanText = text.toLowerCase();
  return words.some((word) => cleanText.includes(word.toLowerCase()));
}

function taskText(task: AtlasTask) {
  return [task.title, task.unlockText, task.packet, task.objectId]
    .filter(Boolean)
    .join(" ");
}

function logText(entry: FieldLogEntry) {
  return [entry.title, entry.detail, entry.note, entry.objectIds.join(" ")]
    .filter(Boolean)
    .join(" ");
}

function hasDoneTaskOrLog(
  areaId: AtlasAreaId,
  words: string[],
  tasks: AtlasTask[],
  fieldLog: FieldLogEntry[],
) {
  const matchingDoneTask = tasks.some(
    (task) =>
      task.areaId === areaId &&
      task.status === "done" &&
      textHasAny(taskText(task), words),
  );

  const matchingLog = fieldLog.some(
    (entry) =>
      entry.areaIds.includes(areaId) &&
      textHasAny(logText(entry), words),
  );

  return matchingDoneTask || matchingLog;
}

function deriveProject(template: AtlasProjectTemplate, data: {
  tasks: AtlasTask[];
  fieldLog: FieldLogEntry[];
  claims: PlantingClaim[];
}): AtlasProject {
  const claimedFieldRows = fieldRowsClaimedCount(data.claims);

  if (template.id === "field-rows-become-plantable") {
    return {
      ...template,
      steps: template.steps.map((step) => {
        let done = false;

        if (step.id === "string") {
          done = hasDoneTaskOrLog(
            "field_rows",
            ["string", "mark", "start"],
            data.tasks,
            data.fieldLog,
          );
        }

        if (step.id === "first-seven") {
          done = claimedFieldRows >= 7;
        }

        if (step.id === "walkways") {
          done = hasDoneTaskOrLog(
            "field_rows",
            ["walkway", "walkways", "grass", "pasture"],
            data.tasks,
            data.fieldLog,
          );
        }

        if (step.id === "remaining") {
          done = claimedFieldRows >= 20;
        }

        if (step.id === "germination") {
          done = hasDoneTaskOrLog(
            "field_rows",
            ["germination", "germinated", "gap", "gaps"],
            data.tasks,
            data.fieldLog,
          );
        }

        return {
          ...step,
          done,
        };
      }),
    };
  }

  return {
    ...template,
    steps: template.steps.map((step) => ({
      ...step,
      done: false,
    })),
  };
}

const projectTemplates: AtlasProjectTemplate[] = [
  {
    id: "field-rows-become-plantable",
    title: "Field Rows Become Plantable",
    areaId: "field_rows",
    purpose: "Turn the best production area into a living field with readable beds.",
    steps: [
      { id: "string", title: "String and start Field Rows" },
      { id: "first-seven", title: "Claim first 7 planted rows" },
      { id: "walkways", title: "Sow grass in walkways" },
      { id: "remaining", title: "Finish rows 8–20" },
      { id: "germination", title: "Check germination and fill gaps" },
    ],
  },
  {
    id: "main-garden-potager",
    title: "Main Garden Potager Setup",
    areaId: "main_garden",
    purpose: "Make the future hospitality courtyard readable before it is perfect.",
    steps: [
      { id: "paths", title: "Confirm main path shape" },
      { id: "stones", title: "Place or make stepping stones" },
      { id: "herbs", title: "Plant chives and basil" },
      { id: "food", title: "Plant cucumbers and okra" },
      { id: "trials", title: "Trial creeping thyme and Snow in Summer pockets" },
    ],
  },
  {
    id: "curve-garden-arches",
    title: "Curve Garden Arch Completion",
    areaId: "curve_garden",
    purpose: "Finish the planted curve as an intentional entry-feeling garden.",
    steps: [
      { id: "weed-one", title: "Weed arch set 1" },
      { id: "weed-two", title: "Weed arch set 2" },
      { id: "weed-three", title: "Weed arch set 3" },
      { id: "plant-vines", title: "Plant arch crops" },
      { id: "presentable", title: "Mark curve as presentable" },
    ],
  },
  {
    id: "barn-beds-suppression",
    title: "Barn Beds Suppression Pass",
    areaId: "barn_beds",
    purpose: "Use cheap bold seed and repeated attention instead of wasting perennials.",
    steps: [
      { id: "wait-spray", title: "Let sprayed Bermuda die back" },
      { id: "clean", title: "Flatten or clear dead material" },
      { id: "sunflowers", title: "Sow tight black oil sunflower rows" },
      { id: "monitor", title: "Monitor Bermuda regrowth" },
    ],
  },
];

function upsertBedRecordContent(
  records: BedRecord[],
  objectId: string,
  zoneId: string,
  content: BedContent,
) {
  const now = new Date().toISOString();
  const existing = records.find((record) => record.objectId === objectId);

  if (!existing) {
    return [
      ...records,
      {
        id: `bed_record_${objectId}`,
        zoneId,
        objectId,
        createdAt: now,
        updatedAt: now,
        contents: [content],
        observations: [],
      },
    ];
  }

  return records.map((record) =>
    record.objectId === objectId
      ? {
          ...record,
          updatedAt: now,
          contents: [...record.contents, content],
        }
      : record,
  );
}

const TASK_STATE_KEY = "atlas-main-task-state-v1";
const FIELD_LOG_KEY = "atlas-main-field-log-v1";
const PLANTING_CLAIMS_KEY = "atlas-main-planting-claims-v1";
const CUSTOM_TASKS_KEY = "atlas-main-custom-tasks-v1";
const BED_RECORDS_KEY = "atlas-main-bed-records-v1";

const todayIso = () => new Date().toISOString().slice(0, 10);

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(key, JSON.stringify(value));
}

function taskActionToWorkAction(actionType: AtlasActionType): WorkAction {
  if (actionType === "direct_sow" || actionType === "transplant") return "planted";
  if (actionType === "water_check") return "watered";
  if (actionType === "field_check") return "checked";
  if (actionType === "move") return "moved";
  if (actionType === "path") return "maintained";
  if (actionType === "observe") return "observed";
  return "maintained";
}

function mergeTask(task: AtlasTask, stored: AtlasTaskStateMap): AtlasTask {
  return {
    ...task,
    status: stored[task.id]?.status ?? task.status,
  };
}

function sortTasks(tasks: AtlasTask[]) {
  return [...tasks].sort((a, b) => a.date.localeCompare(b.date));
}

const taskActionOptions: { value: AtlasActionType; label: string }[] = [
  { value: "field_check", label: "Check" },
  { value: "direct_sow", label: "Direct sow" },
  { value: "transplant", label: "Plant / transplant" },
  { value: "water_check", label: "Water check" },
  { value: "move", label: "Move / carry / relocate" },
  { value: "pot_up", label: "Pot up" },
  { value: "path", label: "Path / structure" },
  { value: "record", label: "Record / note" },
  { value: "observe", label: "Observe" },
  { value: "handoff", label: "Handoff" },
];

const quickActions: WorkAction[] = [
  "weeded",
  "sowed",
  "planted",
  "watered",
  "checked",
  "harvested",
  "moved",
  "observed",
  "maintained",
];

export default function AtlasHomePage() {
  const [activeFarm, setActiveFarm] = useState("Elm Farm");
  const [dashboardZones, setDashboardZones] = useState<AtlasDashboardZone[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

const [supabaseLogSaving, setSupabaseLogSaving] = useState(false);
const [supabaseLogMessage, setSupabaseLogMessage] = useState<string | null>(null);

  const [today] = useState(todayIso());
  const [selectedAreaId, setSelectedAreaId] = useState<AtlasAreaId>("field_rows");
  const [tab, setTab] = useState<TaskTab>("today");

const [showInventoryDrawer, setShowInventoryDrawer] = useState(false);
const [inventoryAreaId, setInventoryAreaId] = useState<AtlasAreaId>("field_rows");

const [showOperationsDrawer, setShowOperationsDrawer] = useState(false);
const [operationsAreaId, setOperationsAreaId] = useState<AtlasAreaId>("field_rows");

  const [taskState, setTaskState] = useState<AtlasTaskStateMap>({});
  const [localClaims, setLocalClaims] = useState<PlantingClaim[]>([]);
  const [fieldLog, setFieldLog] = useState<FieldLogEntry[]>([]);
const [showLedger, setShowLedger] = useState(false);
const [focusedLocalTaskId, setFocusedLocalTaskId] = useState<string | null>(null);

const [quickStep, setQuickStep] = useState<1 | 2 | 3 | 4>(1);

const [localBedRecords, setLocalBedRecords] = useState<BedRecord[]>([]);

  const [showQuickLog, setShowQuickLog] = useState(false);
  const [showPlantingClaim, setShowPlantingClaim] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);

  const [customTasks, setCustomTasks] = useState<AtlasTask[]>([]);
  const [customTaskTitle, setCustomTaskTitle] = useState("");
  const [customTaskAreaId, setCustomTaskAreaId] = useState<AtlasAreaId>("field_rows");
  const [customTaskObjectId, setCustomTaskObjectId] = useState("");
  const [customTaskDate, setCustomTaskDate] = useState(today);
  const [customTaskActionType, setCustomTaskActionType] =
    useState<AtlasActionType>("field_check");
  const [customTaskUnlockText, setCustomTaskUnlockText] = useState("");

const [quickPlantCropId, setQuickPlantCropId] = useState("chives");
const [quickPlantQuantity, setQuickPlantQuantity] = useState(2);
const [quickPlantUnit, setQuickPlantUnit] = useState("clumps");

const [quickPlantSourceType, setQuickPlantSourceType] = useState<
  "hardened_seedling" | "division" | "nursery_purchase"
>("division");

const [quickPlantItems, setQuickPlantItems] = useState<QuickPlantItem[]>([]);

const [selectedTaskCardId, setSelectedTaskCardId] = useState<string | null>(null);
const [showTaskCardDrawer, setShowTaskCardDrawer] = useState(false);

const [openHeroTaskId, setOpenHeroTaskId] = useState<string | null>(null);
const [focusedProjectStep, setFocusedProjectStep] =
  useState<AtlasProjectCard["steps"][number] | null>(null);

const [selectedTaskCard, setSelectedTaskCard] = useState<AtlasTaskCard | null>(
  null,
);
const [taskCardLoading, setTaskCardLoading] = useState(false);
const [taskCardError, setTaskCardError] = useState<string | null>(null);

const [projectCards, setProjectCards] = useState<AtlasProjectCard[]>([]);
const [projectsLoading, setProjectsLoading] = useState(true);
const [projectsError, setProjectsError] = useState<string | null>(null);
const [showProjectsDrawer, setShowProjectsDrawer] = useState(false);
const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);

const [taskResultSaving, setTaskResultSaving] = useState<AtlasTaskResult | null>(
  null,
);
const [taskResultMessage, setTaskResultMessage] = useState<string | null>(null);

  const [quickSelectedActions, setQuickSelectedActions] = useState<WorkAction[]>(["weeded"]);
  const [quickSelectedAreas, setQuickSelectedAreas] = useState<AtlasAreaId[]>(["field_rows"]);
  const [quickSelectedObjects, setQuickSelectedObjects] = useState<string[]>([]);
  const [quickNote, setQuickNote] = useState("");

  const [claimAreaId, setClaimAreaId] = useState<AtlasAreaId>("field_rows");
  const [claimObjectId, setClaimObjectId] = useState("field_row_1");
  const [claimCropId, setClaimCropId] = useState<CropProfileId>("black_oil_sunflower");
  const [claimUnitCount, setClaimUnitCount] = useState(1);
  const [claimDate, setClaimDate] = useState(today);
  const [claimNote, setClaimNote] = useState("");

  useEffect(() => {
    setTaskState(loadJson<AtlasTaskStateMap>(TASK_STATE_KEY, {}));
    setLocalClaims(loadJson<PlantingClaim[]>(PLANTING_CLAIMS_KEY, []));
    setFieldLog(loadJson<FieldLogEntry[]>(FIELD_LOG_KEY, []));
    setLocalBedRecords(loadJson<BedRecord[]>(BED_RECORDS_KEY, bedRecords));
    setCustomTasks(loadJson<AtlasTask[]>(CUSTOM_TASKS_KEY, []));
  }, []);


async function handleTaskResult(result: AtlasTaskResult) {
  if (!selectedTaskCard) return;

  try {
    setTaskResultSaving(result);
    setTaskResultMessage(null);

    await saveAtlasTaskResult({
      taskId: selectedTaskCard.task_id,
      result,
      createdBy: "lex",
    });

    setTaskResultMessage(
      result === "done"
        ? "Task completed."
        : result === "partial"
          ? "Progress logged."
          : result === "blocked"
            ? "Task blocked."
            : "Supply follow-up created.",
    );

    await reloadProjects();
    await reloadDashboard();

    const refreshed = await fetchAtlasTaskCards(selectedTaskCard.task_id);
    setSelectedTaskCard(refreshed.taskCards[0] ?? null);
  } catch (error) {
    setTaskResultMessage(
      error instanceof Error ? error.message : "Failed to save task result.",
    );
  } finally {
    setTaskResultSaving(null);
  }
}

async function reloadProjects() {
  try {
    setProjectsLoading(true);
    setProjectsError(null);

    const response = await fetchAtlasProjects();
    const projects = response.projects ?? [];

    setProjectCards(projects);

    if (!selectedProjectKey && projects.length > 0) {
      setSelectedProjectKey(projects[0].project_key);
    }
  } catch (error) {
    setProjectsError(
      error instanceof Error ? error.message : "Failed to load Atlas projects.",
    );
  } finally {
    setProjectsLoading(false);
  }
}

   async function reloadDashboard() {
    try {
      setDashboardLoading(true);
      setDashboardError(null);

      const dashboard = await fetchAtlasDashboard();
      setDashboardZones(dashboard.zones ?? []);
    } catch (error) {
      setDashboardError(
        error instanceof Error
          ? error.message
          : "Failed to load Atlas dashboard.",
      );
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        setDashboardLoading(true);
        setDashboardError(null);

        const dashboard = await fetchAtlasDashboard();

        if (!isMounted) return;

        setDashboardZones(dashboard.zones ?? []);
      } catch (error) {
        if (!isMounted) return;

        setDashboardError(
          error instanceof Error
            ? error.message
            : "Failed to load Atlas dashboard.",
        );
      } finally {
        if (isMounted) {
          setDashboardLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

useEffect(() => {
  let isMounted = true;

  async function loadProjects() {
    try {
      setProjectsLoading(true);
      setProjectsError(null);

      const response = await fetchAtlasProjects();
      const projects = response.projects ?? [];

      if (!isMounted) return;

      setProjectCards(projects);

      if (projects.length > 0) {
        setSelectedProjectKey((current) => current ?? projects[0].project_key);
      }
    } catch (error) {
      if (!isMounted) return;

      setProjectsError(
        error instanceof Error
          ? error.message
          : "Failed to load Atlas projects.",
      );
    } finally {
      if (isMounted) {
        setProjectsLoading(false);
      }
    }
  }

  loadProjects();

  return () => {
    isMounted = false;
  };
}, []);

useEffect(() => {
  if (!selectedTaskCardId || !showTaskCardDrawer) return;

  const taskCardId = selectedTaskCardId;
  let isMounted = true;

  async function loadTaskCard() {
    try {
      setTaskCardLoading(true);
      setTaskCardError(null);

      const response = await fetchAtlasTaskCards(taskCardId);
      const taskCard = response.taskCards[0] ?? null;

      if (!isMounted) return;

      setSelectedTaskCard(taskCard);
    } catch (error) {
      if (!isMounted) return;

      setTaskCardError(
        error instanceof Error
          ? error.message
          : "Failed to load Atlas task card.",
      );
    } finally {
      if (isMounted) {
        setTaskCardLoading(false);
      }
    }
  }

  void loadTaskCard();

  return () => {
    isMounted = false;
  };
}, [selectedTaskCardId, showTaskCardDrawer]);


const selectedProject = useMemo(() => {
  return (
    projectCards.find((project) => project.project_key === selectedProjectKey) ??
    projectCards[0] ??
    null
  );
}, [projectCards, selectedProjectKey]);

  const dashboardZoneByKey = useMemo(() => {
    return new Map(dashboardZones.map((zone) => [zone.zone_key, zone]));
  }, [dashboardZones]);

  const selectedDashboardZone = dashboardZoneByKey.get(selectedAreaId);

  async function handleSupabaseObservedTest() {
    try {
      setSupabaseLogSaving(true);
      setSupabaseLogMessage(null);

      const areaLabel = getAtlasAreaLabel(selectedAreaId);

      await createAtlasFieldLog({
        actionTypes: ["observed"],
        summarySentence: `${todayIso()} · I observed ${areaLabel} from the Atlas app.`,
        note: "Created from the Atlas mobile UI test button.",
        createdBy: "lex",
        zoneKeys: [selectedAreaId],
      });

      setSupabaseLogMessage(`Saved observation for ${areaLabel}.`);
      await reloadDashboard();
    } catch (error) {
      setSupabaseLogMessage(
        error instanceof Error
          ? error.message
          : "Failed to save Supabase field log.",
      );
    } finally {
      setSupabaseLogSaving(false);
    }
  }

  const allClaims = useMemo(
    () => [...plantingClaims, ...localClaims],
    [localClaims],
  );

  const tasks = useMemo(
    () =>
      [...atlasTasksJuneJuly2026, ...customTasks].map((task) =>
        mergeTask(task, taskState),
      ),
    [customTasks, taskState],
  );

const selectedAreaTasks = useMemo(
  () => sortTasks(tasks.filter((task) => task.areaId === selectedAreaId)),
  [tasks, selectedAreaId],
);

const selectedAreaOpenTasks = useMemo(
  () => selectedAreaTasks.filter((task) => task.status === "open"),
  [selectedAreaTasks],
);

const selectedAreaOverdueTasks = useMemo(
  () => selectedAreaOpenTasks.filter((task) => task.date < today),
  [selectedAreaOpenTasks, today],
);

const selectedAreaTodayTasks = useMemo(
  () => selectedAreaOpenTasks.filter((task) => task.date === today),
  [selectedAreaOpenTasks, today],
);

const selectedAreaNextTasks = useMemo(
  () => selectedAreaOpenTasks.filter((task) => task.date > today),
  [selectedAreaOpenTasks, today],
);

const openTasks = useMemo(
  () => sortTasks(tasks.filter((task) => task.status === "open")),
  [tasks],
);

const overdueTasks = useMemo(
  () => openTasks.filter((task) => task.date < today),
  [openTasks, today],
);

const todayTasks = useMemo(
  () => openTasks.filter((task) => task.date === today),
  [openTasks, today],
);

const nextTasks = useMemo(
  () => openTasks.filter((task) => task.date > today),
  [openTasks, today],
);

const heroPrimaryTask =
  selectedAreaOverdueTasks[0] ??
  selectedAreaTodayTasks[0] ??
  selectedAreaNextTasks[0] ??
  overdueTasks[0] ??
  todayTasks[0] ??
  nextTasks[0] ??
  openTasks[0] ??
  null;

const heroWatchTask =
  selectedAreaTodayTasks.find((task) => task.id !== heroPrimaryTask?.id) ??
  selectedAreaNextTasks.find((task) => task.id !== heroPrimaryTask?.id) ??
  todayTasks.find((task) => task.id !== heroPrimaryTask?.id) ??
  nextTasks.find((task) => task.id !== heroPrimaryTask?.id) ??
  null;

const openHeroTask = tasks.find((task) => task.id === openHeroTaskId) ?? null;

const taskDeck = useMemo(() => {
  const seen = new Set<string>();

  return [
    ...selectedAreaOverdueTasks,
    ...selectedAreaTodayTasks,
    ...selectedAreaNextTasks,
    ...overdueTasks,
    ...todayTasks,
    ...nextTasks,
    ...openTasks,
  ].filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return task.status === "open";
  });
}, [
  selectedAreaOverdueTasks,
  selectedAreaTodayTasks,
  selectedAreaNextTasks,
  overdueTasks,
  todayTasks,
  nextTasks,
  openTasks,
]);

const focusedLocalTask =
  tasks.find((task) => task.id === focusedLocalTaskId) ?? null;

const focusedTaskIndex = focusedLocalTask
  ? taskDeck.findIndex((task) => task.id === focusedLocalTask.id)
  : -1;

const previousFocusedTask =
  focusedTaskIndex > 0 ? taskDeck[focusedTaskIndex - 1] : null;

const nextFocusedTask =
  focusedTaskIndex >= 0 && focusedTaskIndex < taskDeck.length - 1
    ? taskDeck[focusedTaskIndex + 1]
    : null;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;

  const selectedInventory = useMemo(
    () => getAreaInventorySummary(selectedAreaId, allClaims),
    [selectedAreaId, allClaims],
  );

  const selectedObjectSummary = useMemo(
    () => getAreaObjectStateSummary(selectedAreaId, allClaims, tasks, today),
    [selectedAreaId, allClaims, tasks, today],
  );

const inventoryDrawerInventory = useMemo(
  () => getAreaInventorySummary(inventoryAreaId, allClaims),
  [inventoryAreaId, allClaims],
);

const inventoryDrawerSummary = useMemo(
  () => getAreaObjectStateSummary(inventoryAreaId, allClaims, tasks, today),
  [inventoryAreaId, allClaims, tasks, today],
);

const operationsAreaTasks = useMemo(
  () => sortTasks(tasks.filter((task) => task.areaId === operationsAreaId)),
  [tasks, operationsAreaId],
);

const operationsOpenTasks = operationsAreaTasks.filter(
  (task) => task.status === "open",
);

const operationsOverdueTasks = operationsOpenTasks.filter(
  (task) => task.date < today,
);

const selectedAreaBedRecords = localBedRecords.filter(
  (record) => record.zoneId === selectedAreaId,
);

  const quickObjects = useMemo(() => {
    return quickSelectedAreas.flatMap((areaId) => getTaskObjectsForArea(areaId));
  }, [quickSelectedAreas]);

  const claimObjects = useMemo(
    () => getPlantingObjectsForArea(claimAreaId),
    [claimAreaId],
  );

  const customTaskObjects = useMemo(
    () => getTaskObjectsForArea(customTaskAreaId),
    [customTaskAreaId],
  );

  const claimPreview = useMemo(() => {
    const previewClaim: PlantingClaim = {
      id: "preview",
      areaId: claimAreaId,
      objectId: claimObjectId || undefined,
      cropId: claimCropId,
      plantedDate: claimDate,
      unit: "full_bed",
      unitCount: claimUnitCount,
      notes: claimNote,
    };

    return deriveClaim(previewClaim, today);
  }, [claimAreaId, claimObjectId, claimCropId, claimDate, claimUnitCount, claimNote, today]);

  const projects = useMemo(
    () =>
      projectTemplates.map((project) =>
        deriveProject(project, {
          tasks,
          fieldLog,
          claims: allClaims,
        }),
      ),
    [tasks, fieldLog, allClaims],
  );

  const selectedProjectCards = projects.filter(
    (project) => project.areaId === selectedAreaId,
  );

  function updateTaskStatus(task: AtlasTask, status: AtlasTaskStatus) {
    const nextState: AtlasTaskStateMap = {
      ...taskState,
      [task.id]: {
        status,
        updatedAt: new Date().toISOString(),
      },
    };

    setTaskState(nextState);
    saveJson(TASK_STATE_KEY, nextState);

    const logEntry: FieldLogEntry = {
      id: makeId("task"),
      createdAt: new Date().toISOString(),
      date: today,
      title:
        status === "done"
          ? `Completed: ${task.title}`
          : status === "blocked"
            ? `Blocked: ${task.title}`
            : status === "skipped"
              ? `Skipped: ${task.title}`
              : `Updated: ${task.title}`,
      detail: `${getAtlasAreaLabel(task.areaId)} · ${prettyDate(task.date)}`,
      actions: [taskActionToWorkAction(task.actionType)],
      areaIds: [task.areaId],
      objectIds: task.objectId ? [task.objectId] : [],
      source: "task",
    };

    const nextLog = [logEntry, ...fieldLog].slice(0, 50);
    setFieldLog(nextLog);
    saveJson(FIELD_LOG_KEY, nextLog);
  }

  function toggleQuickAction(action: WorkAction) {
    setQuickSelectedActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  }

  function toggleQuickArea(areaId: AtlasAreaId) {
    setQuickSelectedAreas((current) => {
      const next = current.includes(areaId)
        ? current.filter((item) => item !== areaId)
        : [...current, areaId];

      const nextAreaSet = new Set(next);
      setQuickSelectedObjects((objects) =>
        objects.filter((objectId) =>
          quickObjects.some((object) => object.id === objectId && nextAreaSet.has(object.areaId)),
        ),
      );

      return next;
    });
  }

function actionLabel(action: WorkAction) {
  if (action === "weeded") return "Weeded";
  if (action === "sowed") return "Sowed";
  if (action === "planted") return "Planted";
  if (action === "watered") return "Watered";
  if (action === "checked") return "Checked";
  if (action === "harvested") return "Harvested";
  if (action === "moved") return "Moved";
  if (action === "observed") return "Observed";
  if (action === "maintained") return "Maintained";

  return action;
}

function makeQuickLogSentence(
  date: string,
  actions: WorkAction[],
  areaIds: AtlasAreaId[],
  objectIds: string[],
  note: string,
) {
  const actionText = actions.length
    ? actions.map((action) => actionLabel(action).toLowerCase()).join(" + ")
    : "did work in";

  const areaText = areaIds.length
    ? areaIds.map(getAtlasAreaLabel).join(" + ")
    : "unselected";

  const objectText = objectIds.length
    ? objectIds.map(getGrowingObjectLabel).join(" + ")
    : "no specific beds selected";

  const noteText = note.trim()
    ? ` and noted: “${note.trim()}”`
    : "";

  return `${prettyDate(date)} · I ${actionText} the ${areaText} area(s), touching ${objectText}${noteText}.`;
}


function shortObjectLabel(objectId: string) {
  const label = getGrowingObjectLabel(objectId) ?? objectId;

  return label
    .replace("Field Row ", "FR")
    .replace("Main Garden ", "MG ")
    .replace("Entry Billboard ", "EB ");
}

  function toggleQuickObject(objectId: string) {
    setQuickSelectedObjects((current) =>
      current.includes(objectId)
        ? current.filter((item) => item !== objectId)
        : [...current, objectId],
    );
  }

function addQuickPlantItem() {
  const item: QuickPlantItem = {
    id: makeId("quick_plant"),
    cropId: quickPlantCropId,
    quantity: quickPlantQuantity,
    unit: quickPlantUnit,
    sourceType: quickPlantSourceType,
  };

  setQuickPlantItems((current) => [...current, item]);
}

function removeQuickPlantItem(itemId: string) {
  setQuickPlantItems((current) => current.filter((item) => item.id !== itemId));
}

  async function saveQuickLog() {
    if (quickSelectedActions.length === 0 || quickSelectedAreas.length === 0) return;

    const actionText = quickSelectedActions.map(actionLabel).join(" + ");
    const areaText = quickSelectedAreas.map(getAtlasAreaLabel).join(" + ");
    const objectText =
      quickSelectedObjects.length > 0
        ? quickSelectedObjects.map(getGrowingObjectLabel).join(" · ")
        : "whole selected area";

    const entry: FieldLogEntry = {
      id: makeId("work"),
      createdAt: new Date().toISOString(),
      date: today,
      title: `${actionText} · ${quickSelectedObjects.length || quickSelectedAreas.length} touched`,
      detail: `${areaText} · ${objectText}`,
      actions: quickSelectedActions,
      areaIds: quickSelectedAreas,
      objectIds: quickSelectedObjects,
      note: quickNote.trim() || undefined,
      source: "quick_log",
    };

    let nextBedRecords = localBedRecords;

    const shouldCreateBedContent =
      quickSelectedActions.includes("planted") ||
      quickSelectedActions.includes("sowed");

    if (shouldCreateBedContent && quickSelectedObjects.length > 0) {
      quickSelectedObjects.forEach((objectId) => {
        const zoneId =
          quickObjects.find((object) => object.id === objectId)?.areaId ??
          quickSelectedAreas[0];

        const plantItemsToSave =
          quickPlantItems.length > 0
            ? quickPlantItems
            : [
                {
                  id: makeId("quick_plant"),
                  cropId: quickPlantCropId,
                  quantity: quickPlantQuantity,
                  unit: quickPlantUnit,
                  sourceType: quickPlantSourceType,
                },
              ];

        plantItemsToSave.forEach((plantItem) => {
          const content: BedContent = {
            id: makeId("bed_content"),
            type: "herb",
            sourceType: plantItem.sourceType,
            cropId: plantItem.cropId,
            plantedDate: today,
            quantity: plantItem.quantity,
            unit: plantItem.unit,
            status: "planted",
            notes: quickNote.trim() || undefined,
          };

          nextBedRecords = upsertBedRecordContent(
            nextBedRecords,
            objectId,
            zoneId,
            content,
          );
        });
      });

      setLocalBedRecords(nextBedRecords);
      saveJson(BED_RECORDS_KEY, nextBedRecords);
    }

    const nextLog = [entry, ...fieldLog].slice(0, 50);
    setFieldLog(nextLog);
    saveJson(FIELD_LOG_KEY, nextLog);

    try {
      setSupabaseLogSaving(true);
      setSupabaseLogMessage(null);

      await createAtlasFieldLog({
        actionTypes: quickSelectedActions,
summarySentence: `${today} · I ${actionText} in ${areaText}, touching ${objectText}${
  quickNote.trim() ? ` · ${quickNote.trim()}` : ""
}.`,
        note: quickNote.trim() || undefined,
        createdBy: "lex",
        zoneKeys: quickSelectedAreas,
        objectKeys: quickSelectedObjects,
      });

      setSupabaseLogMessage(`Saved Quick Log for ${areaText}.`);
      await reloadDashboard();
    } catch (error) {
      setSupabaseLogMessage(
        error instanceof Error
          ? error.message
          : "Saved locally, but Supabase Quick Log failed.",
      );
    } finally {
      setSupabaseLogSaving(false);
    }

    setShowQuickLog(false);
    setQuickSelectedObjects([]);
    setQuickNote("");
    setQuickPlantItems([]);
  }
function saveCustomTask() {
  const cleanTitle = customTaskTitle.trim();

  if (!cleanTitle) return;

  const selectedObjectLabel = customTaskObjectId
    ? getGrowingObjectLabel(customTaskObjectId)
    : "whole zone";

  const newTask: AtlasTask = {
    id: makeId("custom_task"),
    date: customTaskDate,
    title: cleanTitle,
    areaId: customTaskAreaId,
    objectId: customTaskObjectId || undefined,
    actionType: customTaskActionType,
    instructions:
      customTaskUnlockText.trim() ||
      `${cleanTitle}. This was added from the field task button.`,
    unlockText:
      customTaskUnlockText.trim() ||
      "This keeps real field work visible instead of relying on memory.",
    status: "open",
  };

  const nextTasks = [newTask, ...customTasks];
  setCustomTasks(nextTasks);
  saveJson(CUSTOM_TASKS_KEY, nextTasks);

  setSelectedAreaId(customTaskAreaId);
  setTab("today");
  setShowAddTask(false);

  setCustomTaskTitle("");
  setCustomTaskObjectId("");
  setCustomTaskDate(today);
  setCustomTaskActionType("field_check");
  setCustomTaskUnlockText("");

  const entry: FieldLogEntry = {
    id: makeId("task_added"),
    createdAt: new Date().toISOString(),
    date: today,
    title: `Added task: ${cleanTitle}`,
    detail: `${getAtlasAreaLabel(customTaskAreaId)} · ${selectedObjectLabel} · ${prettyDate(customTaskDate)}`,
    actions: [taskActionToWorkAction(customTaskActionType)],
    areaIds: [customTaskAreaId],
    objectIds: customTaskObjectId ? [customTaskObjectId] : [],
    source: "task",
  };

  const nextLog = [entry, ...fieldLog].slice(0, 50);
  setFieldLog(nextLog);
  saveJson(FIELD_LOG_KEY, nextLog);
}



function scrollToAtlasForm(id: string) {
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 50);
}

  function savePlantingClaim() {
    const newClaim: PlantingClaim = {
      id: makeId("claim"),
      areaId: claimAreaId,
      objectId: claimObjectId || undefined,
      cropId: claimCropId,
      plantedDate: claimDate,
      unit: "full_bed",
      unitCount: claimUnitCount,
      notes: claimNote.trim() || undefined,
    };

    const nextClaims = [newClaim, ...localClaims];
    setLocalClaims(nextClaims);
    saveJson(PLANTING_CLAIMS_KEY, nextClaims);

    const derived = deriveClaim(newClaim, today);
    const entry: FieldLogEntry = {
      id: makeId("claim_log"),
      createdAt: new Date().toISOString(),
      date: today,
      title: `Claimed planting: ${derived.crop.label}`,
      detail: `${getAtlasAreaLabel(claimAreaId)} · ${derived.objectLabel ?? "area"} · ${derived.revenueLabel}`,
      actions: ["planted"],
      areaIds: [claimAreaId],
      objectIds: claimObjectId ? [claimObjectId] : [],
      note: claimNote.trim() || undefined,
      source: "planting_claim",
    };



    const nextLog = [entry, ...fieldLog].slice(0, 50);
    setFieldLog(nextLog);
    saveJson(FIELD_LOG_KEY, nextLog);

    setSelectedAreaId(claimAreaId);
    setShowPlantingClaim(false);
    setClaimNote("");
  }

  function setClaimArea(nextAreaId: AtlasAreaId) {
    setClaimAreaId(nextAreaId);
    setClaimObjectId(getDefaultGrowingObjectForArea(nextAreaId)?.id ?? "");
  }



function openLocalTaskCard(task: AtlasTask) {
  setFocusedLocalTaskId(task.id);
  setSelectedAreaId(task.areaId);
  setOpenHeroTaskId(null);

  setFocusedProjectStep(null);
  setShowTaskCardDrawer(false);
  setSelectedTaskCardId(null);
  setSelectedTaskCard(null);
  setTaskCardError(null);
}

function closeLocalTaskCard() {
  setFocusedLocalTaskId(null);
}

function moveLocalTaskFocus(nextTask: AtlasTask | null) {
  if (!nextTask) return;

  setFocusedLocalTaskId(nextTask.id);
  setSelectedAreaId(nextTask.areaId);
}

function openSupabaseTaskCard(taskId: string | null) {
  if (!taskId) return;

  setSelectedTaskCardId(taskId);
  setShowTaskCardDrawer(true);

  setFocusedLocalTaskId(null);
  setFocusedProjectStep(null);
  setTaskCardError(null);
  setTaskResultMessage(null);
}

function openProjectStepCard(step: AtlasProjectCard["steps"][number]) {
  if (step.task_id) {
    openSupabaseTaskCard(step.task_id);
    return;
  }

  setFocusedProjectStep(step);
  setFocusedLocalTaskId(null);
  setShowTaskCardDrawer(false);
  setSelectedTaskCardId(null);
  setSelectedTaskCard(null);
  setTaskCardError(null);
  setTaskResultMessage(null);
}

function closeSupabaseTaskCard() {
  setShowTaskCardDrawer(false);
  setSelectedTaskCardId(null);
  setSelectedTaskCard(null);
  setTaskCardError(null);
  setTaskResultMessage(null);
}

function closeAnyTaskFocus() {
  setFocusedLocalTaskId(null);
  setFocusedProjectStep(null);
  closeSupabaseTaskCard();
}

  function ProjectCard({ project }: { project: AtlasProject }) {
    const complete = project.steps.filter((step) => step.done).length;
    const total = project.steps.length;
    const percent = Math.round((complete / total) * 100);
    const nextStep = project.steps.find((step) => !step.done && !step.blocked);
    const blockedStep = project.steps.find((step) => step.blocked);

    return (
      <article className="atlas-task-row">
        <div className="atlas-task-row-head">
          <div>
            <span className="atlas-soft-label">{getAtlasAreaLabel(project.areaId)}</span>
            <strong>{project.title}</strong>
            <small>{project.purpose}</small>
          </div>
          <span className="atlas-primary-status">{percent}%</span>
        </div>

        <div className="atlas-zone-mini-stats">
          <span>{complete}/{total} done</span>
          <span>{nextStep ? `next: ${nextStep.title}` : "complete"}</span>
          {blockedStep ? <span>blocked: {blockedStep.title}</span> : null}
        </div>

<div className="atlas-inventory-grid">
  {selectedAreaBedRecords.length === 0 ? (
    <div className="atlas-empty">No bed contents remembered yet.</div>
  ) : (
    selectedAreaBedRecords.map((record) => (
      <div key={record.id} className="atlas-inventory-row">
        <span>{getGrowingObjectLabel(record.objectId)}</span>
        <strong>
          {record.contents
            .map((content) => `${content.cropId} · ${content.quantity ?? ""} ${content.unit ?? ""}`)
            .join(" · ")}
        </strong>
      </div>
    ))
  )}
</div>

        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {project.steps.map((step) => (
            <div
              key={step.id}
              style={{
                border: "1px solid #e3dacd",
                borderRadius: 14,
                padding: "8px 9px",
                background: step.done ? "#f7fcf9" : step.blocked ? "#fff0d5" : "#fffdf8",
                fontSize: 12,
                fontWeight: 850,
                color: "#303243",
              }}
            >
              {step.done ? "✓ " : step.blocked ? "! " : "□ "}
              {step.title}
            </div>
          ))}
        </div>
      </article>
    );
  }

function statusClass(status: AtlasTaskStatus) {
  if (status === "done") return "zone-task-row-done";
  if (status === "blocked") return "zone-task-row-blocked";
  if (status === "skipped") return "zone-task-row-skipped";

  return "";
}

  function TaskCard({ task }: { task: AtlasTask }) {
    return (
      <article className={`atlas-task-row atlas-task-row-playable ${statusClass(task.status)}`}>
        <button
          type="button"
          className="atlas-task-row-main"
          onClick={() => openLocalTaskCard(task)}
        >
          <div className="atlas-task-row-head">
            <div>
              <span className="atlas-soft-label">{prettyDate(task.date)}</span>
              <strong>{task.title}</strong>
              <small>
                {getAtlasAreaLabel(task.areaId)} · {task.unlockText}
              </small>
            </div>

            <span className="atlas-primary-status">{task.status}</span>
          </div>

          <div className="atlas-cue-row compact">
            <span className="atlas-cue">
              {task.actionType.replaceAll("_", " ")}
            </span>

            {task.objectId ? (
              <span className="atlas-cue">
                {getGrowingObjectLabel(task.objectId)}
              </span>
            ) : null}

            {task.packet ? (
              <span className="atlas-cue">{task.packet}</span>
            ) : null}
          </div>
        </button>

        <div className="atlas-icon-actions">
          <button
            className="atlas-icon-tap"
            onClick={() => updateTaskStatus(task, "done")}
            aria-label="Mark done"
          >
            ✓
          </button>

          <button
            className="atlas-icon-tap"
            onClick={() => updateTaskStatus(task, "blocked")}
            aria-label="Mark blocked"
          >
            ×
          </button>

          <button
            className="atlas-icon-tap"
            onClick={() => updateTaskStatus(task, "skipped")}
            aria-label="Skip"
          >
            ↱
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="atlas-phone-shell">
      <section className="atlas-phone">
        <header className="atlas-phone-top with-weather">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">← Atlas</span>
            <span className="atlas-phone-title">{activeFarm}</span>
          </div>

          <div className="atlas-weather-center">cloudy · 61°</div>

<div className="atlas-action-stack">
  <button
    className="atlas-top-action atlas-top-action-task"
    onClick={() => {
      setShowAddTask(true);
      setShowQuickLog(false);
      setShowPlantingClaim(false);
      scrollToAtlasForm("atlas-add-task-form");
    }}
    aria-label="Add task or project"
    title="Add task or project"
  >
    <span className="atlas-top-action-icon">+</span>
  </button>

  <button
    className="atlas-top-action atlas-top-action-planting"
    onClick={() => {
      setQuickSelectedActions(["planted"]);
      setShowQuickLog(true);
      setShowPlantingClaim(false);
      setShowAddTask(false);
      setQuickStep(1);
      scrollToAtlasForm("atlas-quick-log-form");
    }}
    aria-label="Log planting"
    title="Log planting"
  >
    <span className="atlas-top-action-icon">+</span>
  </button>
</div>
        </header>

        <div className="atlas-phone-body">
<section className="atlas-hero-compact atlas-hero-restored">
  <div className="atlas-zone-hero">
    <div className="atlas-zone-hero-mainline">
      <div className="atlas-zone-title-block">
        <span
          className="atlas-phone-kicker"
          style={{ color: "rgba(255,255,255,.72)" }}
        >
          Today
        </span>

        <label className="atlas-zone-name-row atlas-zone-name-row-working">
          <h1 className="atlas-zone-name">{getAtlasAreaLabel(selectedAreaId)}</h1>

          <select
            className="atlas-zone-name-select-working"
            value={selectedAreaId}
            onChange={(event) => {
              setSelectedAreaId(event.target.value as AtlasAreaId);
              setOpenHeroTaskId(null);
            }}
            aria-label="Select zone"
          >
            {atlasAreas2026.map((area) => (
              <option key={area.id} value={area.id}>
                {getAtlasAreaLabel(area.id)}
              </option>
            ))}
          </select>

          <span className="atlas-zone-dropdown-mark">⌄</span>
        </label>
      </div>

      <button className="atlas-soft-date">{prettyDate(today)}</button>
    </div>

    <div className="atlas-hero-grid">
      {heroPrimaryTask ? (
        <button
          type="button"
          className={`atlas-hero-tile atlas-hero-tile-button ${
            heroPrimaryTask.date < today ? "atlas-hero-tile-overdue" : ""
          }`}
          onClick={() => {
            setSelectedAreaId(heroPrimaryTask.areaId);
            setOpenHeroTaskId(
              openHeroTaskId === heroPrimaryTask.id ? null : heroPrimaryTask.id,
            );
          }}
        >
          <span className="atlas-soft-label">
            {heroPrimaryTask.date < today ? "Overdue" : "Do"}
          </span>

          <strong>{heroPrimaryTask.title}</strong>

          <em>
            {prettyDate(heroPrimaryTask.date)} ·{" "}
            {getAtlasAreaLabel(heroPrimaryTask.areaId)}
          </em>
        </button>
      ) : (
        <div className="atlas-hero-tile">
          <span className="atlas-soft-label">Clear</span>
          <strong>No open task</strong>
          <em>Use Quick Log to claim field work.</em>
        </div>
      )}

      {heroWatchTask ? (
        <button
          type="button"
          className="atlas-hero-tile atlas-hero-tile-button"
          onClick={() => {
            setSelectedAreaId(heroWatchTask.areaId);
            setOpenHeroTaskId(
              openHeroTaskId === heroWatchTask.id ? null : heroWatchTask.id,
            );
          }}
        >
          <span className="atlas-soft-label">Watch</span>

          <strong>{heroWatchTask.title}</strong>

          <em>
            {prettyDate(heroWatchTask.date)} ·{" "}
            {getAtlasAreaLabel(heroWatchTask.areaId)}
          </em>
        </button>
      ) : (
        <div className="atlas-hero-tile">
          <span className="atlas-soft-label">Watch</span>
          <strong>Nothing queued</strong>
          <em>This zone has no second task queued.</em>
        </div>
      )}

      {openHeroTask ? (
        <div className="atlas-hero-detail atlas-hero-task-peek">
          <div className="atlas-hero-detail-title">{openHeroTask.title}</div>

          <div className="atlas-cue-row compact">
            <span className="atlas-cue">
              {openHeroTask.actionType.replaceAll("_", " ")}
            </span>

            {openHeroTask.objectId ? (
              <span className="atlas-cue">
                {getGrowingObjectLabel(openHeroTask.objectId)}
              </span>
            ) : null}

            {openHeroTask.packet ? (
              <span className="atlas-cue">{openHeroTask.packet}</span>
            ) : null}
          </div>

          <p>{openHeroTask.unlockText}</p>

          <div className="atlas-hero-icon-actions">
            <button
              type="button"
              className="atlas-hero-icon-tap"
              onClick={() => updateTaskStatus(openHeroTask, "done")}
              aria-label="Mark done"
            >
              ✓
            </button>

            <button
              type="button"
              className="atlas-hero-icon-tap"
              onClick={() => updateTaskStatus(openHeroTask, "blocked")}
              aria-label="Mark blocked"
            >
              ×
            </button>

            <button
              type="button"
              className="atlas-hero-icon-tap"
              onClick={() => updateTaskStatus(openHeroTask, "skipped")}
              aria-label="Skip"
            >
              ↱
            </button>

            <button
              type="button"
              className="atlas-hero-go-in-button"
              onClick={() => openLocalTaskCard(openHeroTask)}
            >
              Go in
            </button>

            <button
              type="button"
              className="atlas-hero-close"
              onClick={() => setOpenHeroTaskId(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <div className="atlas-hero-stats">
        <div className="atlas-hero-stat">
          <span>Open</span>
          <strong>{selectedAreaOpenTasks.length}</strong>
        </div>

        <div className="atlas-hero-stat">
          <span>Done</span>
          <strong>
            {
              selectedAreaTasks.filter((task) => task.status === "done")
                .length
            }
          </strong>
        </div>

        <div className="atlas-hero-stat">
          <span>Block</span>
          <strong>
            {
              selectedAreaTasks.filter((task) => task.status === "blocked")
                .length
            }
          </strong>
        </div>
      </div>
    </div>
  </div>
</section>


{showAddTask ? (
  <section className="atlas-soft-card" id="atlas-add-task-form">
    <div className="atlas-soft-head">
      <div>
        <span className="atlas-soft-label">Add Task</span>
        <h2 className="atlas-soft-heading">Set a Goal</h2>
      </div>
      <button className="atlas-soft-badge" onClick={() => setShowAddTask(false)}>
        Close
      </button>
    </div>

    <div className="atlas-add-form" style={{ marginTop: 12 }}>
      <label>
        <span className="atlas-soft-label">Task</span>
        <input
          value={customTaskTitle}
          onChange={(event) => setCustomTaskTitle(event.target.value)}
          placeholder="Example: Weed Curve Arch Set 1"
        />
      </label>

      <label>
        <span className="atlas-soft-label">Zone</span>
        <select
          value={customTaskAreaId}
          onChange={(event) => {
            const nextAreaId = event.target.value as AtlasAreaId;
            setCustomTaskAreaId(nextAreaId);
            setCustomTaskObjectId("");
          }}
        >
          {atlasAreas2026.map((area) => (
            <option key={area.id} value={area.id}>
              {getAtlasAreaLabel(area.id)}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="atlas-soft-label">Object / bed</span>
        <select
          value={customTaskObjectId}
          onChange={(event) => setCustomTaskObjectId(event.target.value)}
        >
          <option value="">Whole zone / not specific</option>
          {customTaskObjects.map((object) => (
            <option key={object.id} value={object.id}>
              {object.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="atlas-soft-label">Kind of work</span>
        <select
          value={customTaskActionType}
          onChange={(event) =>
            setCustomTaskActionType(event.target.value as AtlasActionType)
          }
        >
          {taskActionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="atlas-soft-label">Date</span>
        <input
          type="date"
          value={customTaskDate}
          onChange={(event) => setCustomTaskDate(event.target.value)}
        />
      </label>

      <label>
        <span className="atlas-soft-label">Unlock / why it matters</span>
        <textarea
          value={customTaskUnlockText}
          onChange={(event) => setCustomTaskUnlockText(event.target.value)}
          placeholder="Example: Keeps the arch readable before weeds swallow the structure."
        />
      </label>
    </div>

    <button
      className="atlas-zone-action accent"
      style={{ marginTop: 12, width: "100%", border: 0 }}
      onClick={saveCustomTask}
    >
      Save task
    </button>
  </section>
) : null}

{showQuickLog ? (
  <section className="atlas-soft-card atlas-wizard-card" id="atlas-quick-log-form">
    <div className="atlas-soft-head">
      <div>
        <span className="atlas-soft-label">Investigation</span>
        <h2 className="atlas-soft-heading">Farm Log</h2>
      </div>
      <button className="atlas-soft-badge" onClick={() => setShowQuickLog(false)}>
        Close
      </button>
    </div>

    <div className="atlas-builder-receipt">
      <span className="atlas-soft-label">Field claim</span>

      <div className="atlas-builder-sentence">
        <span>{prettyDate(today)} · I</span>

        <button className="atlas-builder-slot" onClick={() => setQuickStep(1)}>
          {quickSelectedActions.length
            ? quickSelectedActions.map(actionLabel).join(" + ")
            : "choose action"}
        </button>

        <span>in</span>

        <button className="atlas-builder-slot" onClick={() => setQuickStep(2)}>
          {quickSelectedAreas.length
            ? quickSelectedAreas.map(getAtlasAreaLabel).join(" + ")
            : "choose zone"}
        </button>

        {quickSelectedActions.includes("planted") ||
quickSelectedActions.includes("sowed") ? (
  <>
    <span>from</span>
    <button className="atlas-builder-slot" onClick={() => setQuickStep(4)}>
      {quickPlantSourceType.replaceAll("_", " ")}
    </button>
  </>
) : null}

<span>touching</span>

        <button className="atlas-builder-slot" onClick={() => setQuickStep(3)}>
          {quickSelectedObjects.length
  ? quickSelectedObjects.slice(0, 4).map(shortObjectLabel).join(" + ") +
    (quickSelectedObjects.length > 4 ? ` + ${quickSelectedObjects.length - 4} more` : "")
  : "choose beds"}
        </button>
      </div>
    </div>

    <div className="atlas-wizard-progress">
      {[1, 2, 3, 4].map((step) => (
        <button
          key={step}
          className={`atlas-wizard-dot ${quickStep === step ? "active" : ""}`}
          onClick={() => setQuickStep(step as 1 | 2 | 3 | 4)}
        >
          {step}
        </button>
      ))}
    </div>

<div className="atlas-step-summary-stack">
  <div className="atlas-step-summary">
    <span>Step 1 · Action</span>
    <div className="atlas-selected-pill-tray compact">
      {quickSelectedActions.length ? (
        quickSelectedActions.map((action) => (
          <button
            key={action}
            className="atlas-selected-pill"
            onClick={() => toggleQuickAction(action)}
          >
            {actionLabel(action)} <b>×</b>
          </button>
        ))
      ) : (
        <button className="atlas-builder-slot" onClick={() => setQuickStep(1)}>
          choose action
        </button>
      )}
    </div>
  </div>

  {quickStep >= 2 ? (
    <div className="atlas-step-summary">
      <span>Step 2 · Zone</span>
      <div className="atlas-selected-pill-tray compact">
        {quickSelectedAreas.length ? (
          quickSelectedAreas.map((areaId) => (
            <button
              key={areaId}
              className="atlas-selected-pill"
              onClick={() => toggleQuickArea(areaId)}
            >
              {getAtlasAreaLabel(areaId)} <b>×</b>
            </button>
          ))
        ) : (
          <button className="atlas-builder-slot" onClick={() => setQuickStep(2)}>
            choose zone
          </button>
        )}
      </div>
    </div>
  ) : null}

  {quickStep >= 3 ? (
    <div className="atlas-step-summary">
      <span>Step 3 · Objects</span>
      <div className="atlas-selected-pill-tray compact">
        {quickSelectedObjects.length ? (
          quickSelectedObjects.map((objectId) => (
            <button
              key={objectId}
              className="atlas-selected-pill"
              onClick={() => toggleQuickObject(objectId)}
            >
              {shortObjectLabel(objectId)} <b>×</b>
            </button>
          ))
        ) : (
          <button className="atlas-builder-slot" onClick={() => setQuickStep(3)}>
            choose beds
          </button>
        )}
      </div>
    </div>
  ) : null}

  {quickStep >= 4 &&
  (quickSelectedActions.includes("planted") ||
    quickSelectedActions.includes("sowed")) ? (
    <div className="atlas-step-summary">
      <span>Step 4 · Planting</span>
      <div className="atlas-selected-pill-tray compact">
        {quickPlantItems.length ? (
          quickPlantItems.map((item) => (
            <button
              key={item.id}
              className="atlas-selected-pill"
              onClick={() => removeQuickPlantItem(item.id)}
            >
              {item.quantity} {item.unit} {item.cropId.replaceAll("_", " ")} <b>×</b>
            </button>
          ))
        ) : (
          <button className="atlas-builder-slot" onClick={() => setQuickStep(4)}>
            {quickPlantQuantity} {quickPlantUnit}{" "}
            {quickPlantCropId.replaceAll("_", " ")}
          </button>
        )}
      </div>
    </div>
  ) : null}
</div>

    {quickStep === 1 ? (
      <div className="atlas-wizard-step">
        <span className="atlas-soft-label">Step 1 · What did you do?</span>

        <div className="atlas-choice-grid">
          {quickActions.map((action) => (
            <button
              key={action}
              className={`atlas-choice-pill ${
                quickSelectedActions.includes(action) ? "selected" : ""
              }`}
              onClick={() => toggleQuickAction(action)}
            >
              {actionLabel(action)}
            </button>
          ))}
        </div>

        <div className="atlas-wizard-nav">
          <button className="atlas-next-button" onClick={() => setQuickStep(2)}>
            Next: choose zones
          </button>
        </div>
      </div>
    ) : null}

    {quickStep === 2 ? (
      <div className="atlas-wizard-step">
        <span className="atlas-soft-label">Step 2 · Where?</span>

        <div className="atlas-choice-grid">
          {atlasAreas2026.map((area) => (
            <button
              key={area.id}
              className={`atlas-choice-pill ${
                quickSelectedAreas.includes(area.id) ? "selected" : ""
              }`}
              onClick={() => toggleQuickArea(area.id)}
            >
              {getAtlasAreaLabel(area.id)}
            </button>
          ))}
        </div>

        <div className="atlas-wizard-nav two">
          <button className="atlas-back-button" onClick={() => setQuickStep(1)}>
            Back
          </button>
          <button className="atlas-next-button" onClick={() => setQuickStep(3)}>
            Next: choose beds
          </button>
        </div>
      </div>
    ) : null}

    {quickStep === 3 ? (
      <div className="atlas-wizard-step">
        <span className="atlas-soft-label">Step 3 · What did you touch?</span>


        <div className="atlas-object-pill-grid">
          {quickObjects.length === 0 ? (
            <div className="atlas-empty">Choose at least one zone first.</div>
          ) : (
            quickObjects.map((object) => (
              <button
                key={object.id}
                className={`atlas-object-pill ${
                  quickSelectedObjects.includes(object.id) ? "selected" : ""
                }`}
                onClick={() => toggleQuickObject(object.id)}
              >
                {object.label}
              </button>
            ))
          )}
        </div>

        <div className="atlas-wizard-nav two">
          <button className="atlas-back-button" onClick={() => setQuickStep(2)}>
            Back
          </button>
          <button className="atlas-next-button" onClick={() => setQuickStep(4)}>
            Next: note + save
          </button>
        </div>
      </div>
    ) : null}

{quickStep === 4 ? (
  <div className="atlas-wizard-step">
    {(quickSelectedActions.includes("planted") ||
      quickSelectedActions.includes("sowed")) ? (
      <div style={{ display: "grid", gap: 10 }}>
        <span className="atlas-soft-label">Step 4 · What did you add?</span>

<div className="atlas-choice-grid">
  <button
    className={`atlas-choice-pill ${
      quickPlantSourceType === "hardened_seedling" ? "selected" : ""
    }`}
    onClick={() => setQuickPlantSourceType("hardened_seedling")}
  >
    Hardened seedling
  </button>

  <button
    className={`atlas-choice-pill ${
      quickPlantSourceType === "division" ? "selected" : ""
    }`}
    onClick={() => setQuickPlantSourceType("division")}
  >
    Division
  </button>

  <button
    className={`atlas-choice-pill ${
      quickPlantSourceType === "nursery_purchase" ? "selected" : ""
    }`}
    onClick={() => setQuickPlantSourceType("nursery_purchase")}
  >
    Nursery purchase
  </button>
</div>

        <div className="atlas-choice-grid">
          <button
            className={`atlas-choice-pill ${quickPlantCropId === "chives" ? "selected" : ""}`}
            onClick={() => {
              setQuickPlantCropId("chives");
              setQuickPlantUnit("clumps");
            }}
          >
            Chives
          </button>
          <button
            className={`atlas-choice-pill ${quickPlantCropId === "black_oil_sunflower" ? "selected" : ""}`}
            onClick={() => {
              setQuickPlantCropId("black_oil_sunflower");
              setQuickPlantUnit("seeds");
            }}
          >
            Black Oil Sunflower
          </button>
          <button
            className={`atlas-choice-pill ${quickPlantCropId === "california_giant_zinnia" ? "selected" : ""}`}
            onClick={() => {
              setQuickPlantCropId("california_giant_zinnia");
              setQuickPlantUnit("seeds");
            }}
          >
            Zinnia
          </button>
        </div>

        <label className="atlas-note-field">
          <span className="atlas-soft-label">Amount</span>
          <input
            type="number"
            min={1}
            value={quickPlantQuantity}
            onChange={(event) => setQuickPlantQuantity(Number(event.target.value))}
          />
        </label>

        <label className="atlas-note-field">
          <span className="atlas-soft-label">Unit</span>
          <input
            value={quickPlantUnit}
            onChange={(event) => setQuickPlantUnit(event.target.value)}
          />
        </label>
      </div>
    ) : null}

    <label className="atlas-note-field" style={{ marginTop: 12 }}>
      <span className="atlas-soft-label">Note</span>
      <textarea
        value={quickNote}
        onChange={(event) => setQuickNote(event.target.value)}
        placeholder="What changed? What problem should become a task?"
      />
    </label>

    <div className="atlas-wizard-nav two">
      <button className="atlas-back-button" onClick={() => setQuickStep(3)}>
        Back
      </button>
      <button className="atlas-next-button save" onClick={saveQuickLog}>
        Save field log
      </button>
    </div>
  </div>
) : null}
  </section>
) : null}


          {showPlantingClaim ? (
            <section className="atlas-soft-card" id="atlas-claim-planting-form">
              <div className="atlas-soft-head">
                <div>
                  <span className="atlas-soft-label">Claim Planting</span>
                  <h2 className="atlas-soft-heading">Inventory-style claim</h2>
                </div>
                <button className="atlas-soft-badge" onClick={() => setShowPlantingClaim(false)}>
                  Close
                </button>
              </div>

              <div className="atlas-add-form" style={{ marginTop: 12 }}>
                <label>
                  <span className="atlas-soft-label">Area</span>
                  <select
                    value={claimAreaId}
                    onChange={(event) => setClaimArea(event.target.value as AtlasAreaId)}
                  >
                    {atlasAreas2026.map((area) => (
                      <option key={area.id} value={area.id}>
                        {getAtlasAreaLabel(area.id)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Object / bed</span>
                  <select
                    value={claimObjectId}
                    onChange={(event) => setClaimObjectId(event.target.value)}
                  >
                    <option value="">Whole area / custom patch</option>
                    {claimObjects.map((object) => (
                      <option key={object.id} value={object.id}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Crop</span>
                  <select
                    value={claimCropId}
                    onChange={(event) => setClaimCropId(event.target.value as CropProfileId)}
                  >
                    {cropProfiles.map((crop) => (
                      <option key={crop.id} value={crop.id}>
                        {crop.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Full beds / units</span>
                  <input
                    type="number"
                    min={1}
                    value={claimUnitCount}
                    onChange={(event) => setClaimUnitCount(Number(event.target.value))}
                  />
                </label>

                <label>
                  <span className="atlas-soft-label">Date</span>
                  <input
                    type="date"
                    value={claimDate}
                    onChange={(event) => setClaimDate(event.target.value)}
                  />
                </label>



                <label>
                  <span className="atlas-soft-label">Note</span>
                  <textarea
                    value={claimNote}
                    onChange={(event) => setClaimNote(event.target.value)}
                    placeholder="Optional planting note"
                  />
                </label>
              </div>

              <div className="atlas-inventory-grid">
                <div className="atlas-inventory-row">
                  <span>Preview</span>
                  <strong>
                    {claimPreview.crop.label} · {claimPreview.objectLabel ?? "custom"} · {claimPreview.sizeLabel}
                  </strong>
                </div>
                <div className="atlas-inventory-row">
                  <span>Plants / harvest</span>
                  <strong>
                    {claimPreview.estimatedPlants} plants · {claimPreview.harvestCountdownLabel}
                  </strong>
                </div>
                <div className="atlas-inventory-row money">
                  <span>Potential</span>
                  <strong>{claimPreview.revenueLabel}</strong>
                </div>
              </div>

              <button
                className="atlas-zone-action accent"
                style={{ marginTop: 12, width: "100%", border: 0 }}
                onClick={savePlantingClaim}
              >
                Save claim
              </button>
            </section>
          ) : null}
{dashboardError ? (
  <section className="atlas-soft-card">
    <div className="atlas-soft-head">
      <div>
        <span className="atlas-soft-label">Connection</span>
        <h2 className="atlas-soft-heading">Atlas could not sync</h2>
      </div>
      <span className="atlas-soft-badge">Error</span>
    </div>

    <div className="atlas-empty" style={{ marginTop: 10 }}>
      {dashboardError}
    </div>
  </section>
) : null}


<section className="atlas-soft-card atlas-closed-drawer-card">
  <button
    type="button"
    className="atlas-soft-head atlas-drawer-trigger"
    onClick={() => setShowProjectsDrawer((current) => !current)}
  >
    <div>
      <span className="atlas-soft-label">Goal Chains</span>
      <h2 className="atlas-soft-heading">Projects</h2>
    </div>

    <span className="atlas-soft-badge">
      {projectsLoading
        ? "Loading"
        : showProjectsDrawer
          ? "Close"
          : selectedProject
            ? `${selectedProject.done_step_count ?? 0}/${
                selectedProject.step_count ?? 0
              } steps`
            : `${projectCards.length} active`}
    </span>
  </button>

  {projectsError ? (
    <div className="atlas-empty" style={{ marginTop: 10 }}>
      {projectsError}
    </div>
  ) : showProjectsDrawer ? (
    <div className="atlas-open-drawer-body">
      <label className="atlas-compact-select-label">
        <span className="atlas-soft-label">Selected project</span>
        <select
          value={selectedProject?.project_key ?? ""}
          onChange={(event) => setSelectedProjectKey(event.target.value)}
        >
          {projectCards.map((project) => (
            <option key={project.project_key} value={project.project_key}>
              {project.project_title}
            </option>
          ))}
        </select>
      </label>

      {selectedProject ? (
        <div className="atlas-drawer-detail atlas-project-focus-panel">
          <div className="atlas-soft-head">
            <div>
              <span className="atlas-soft-label">
                {selectedProject.target_window_label ?? "Project"}
              </span>

              <h3 className="atlas-soft-heading">
                {selectedProject.project_title}
              </h3>
            </div>

            <button
              type="button"
              className="atlas-soft-badge"
              onClick={() => setShowProjectsDrawer(false)}
              style={{ border: 0, cursor: "pointer" }}
            >
              ×
            </button>
          </div>

          <div className="atlas-zone-mini-stats" style={{ marginTop: 12 }}>
            <span>{selectedProject.zone_label ?? "Whole farm"}</span>
            <span>
              {selectedProject.done_step_count ?? 0}/
              {selectedProject.step_count ?? 0} steps
            </span>
            <span>{selectedProject.open_task_count ?? 0} open tasks</span>
            <span>
              Next due:{" "}
              {selectedProject.next_due_date
                ? prettyDate(selectedProject.next_due_date)
                : "none"}
            </span>
          </div>

          {selectedProject.goal_label ? (
            <p className="atlas-project-focus-note">
              {selectedProject.goal_label}
            </p>
          ) : null}

          {selectedProject.success_definition ? (
            <p className="atlas-project-focus-note">
              {selectedProject.success_definition}
            </p>
          ) : null}


<div className="atlas-project-step-stack">
  {selectedProject.steps
    .slice()
    .sort((a, b) => a.step_order - b.step_order)
    .map((step) => {
      const isSelected =
        (step.task_id &&
          selectedTaskCardId === step.task_id &&
          showTaskCardDrawer) ||
        focusedProjectStep?.step_id === step.step_id;

      return (
        <button
          key={step.step_id}
          type="button"
          className={`atlas-project-step-card ${isSelected ? "active" : ""}`}
          onClick={() => openProjectStepCard(step)}
        >
          <div className="atlas-project-step-header">
            <span className="atlas-soft-label">Step {step.step_order}</span>

            <div className="atlas-project-step-pills">
              {step.task_due_date ? (
                <span>{prettyDate(step.task_due_date)}</span>
              ) : null}

              {step.task_priority ? <span>{step.task_priority}</span> : null}

              {step.task_status ? (
                <span>{step.task_status}</span>
              ) : (
                <span>{step.step_status ?? "step"}</span>
              )}
            </div>
          </div>

          <strong>{step.task_title ?? step.step_title}</strong>

          {step.unlock_text ? (
            <p>{step.unlock_text}</p>
          ) : step.step_note ? (
            <p>{step.step_note}</p>
          ) : null}

          <span className="atlas-go-in-hint">
            {step.task_id ? "Tap to open task card" : "Tap to open project step"}
          </span>
        </button>
      );
    })}
</div>
        </div>
      ) : (
        <div className="atlas-empty">No project loaded yet.</div>
      )}
    </div>
  ) : selectedProject ? (
    <div className="atlas-closed-drawer-summary">
      <span>{selectedProject.project_title}</span>
      <span>
        {selectedProject.done_step_count ?? 0}/
        {selectedProject.step_count ?? 0} steps
      </span>
      <span>{selectedProject.open_task_count ?? 0} open</span>
    </div>
  ) : null}
</section>





<section className="atlas-soft-card atlas-closed-drawer-card">
  <button
    type="button"
    className="atlas-soft-head atlas-drawer-trigger"
    onClick={() => setShowInventoryDrawer((current) => !current)}
  >
    <div>
      <span className="atlas-soft-label">Inventory</span>
      <h2 className="atlas-soft-heading">Inventory Zones</h2>
    </div>

    <span className="atlas-soft-badge">
      {showInventoryDrawer ? "Close" : getAtlasAreaLabel(inventoryAreaId)}
    </span>
  </button>

  {showInventoryDrawer ? (
    <div className="atlas-open-drawer-body">
      <label className="atlas-compact-select-label">
        <span className="atlas-soft-label">Selected zone</span>
        <select
          value={inventoryAreaId}
          onChange={(event) =>
            setInventoryAreaId(event.target.value as AtlasAreaId)
          }
        >
          {atlasAreas2026.map((area) => (
            <option key={area.id} value={area.id}>
              {getAtlasAreaLabel(area.id)}
            </option>
          ))}
        </select>
      </label>

      <div className="atlas-drawer-detail">
        <div className="atlas-soft-head">
          <div>
            <span className="atlas-soft-label">Open View</span>
            <h3 className="atlas-soft-heading">
              {getAtlasAreaLabel(inventoryAreaId)}
            </h3>
          </div>

          <button
            type="button"
            className="atlas-soft-badge"
            onClick={() => setShowInventoryDrawer(false)}
            style={{ border: 0, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div className="atlas-zone-mini-stats" style={{ marginTop: 12 }}>
          <span>
            {inventoryDrawerSummary.claimedPlantingObjectCount}/
            {inventoryDrawerSummary.plantingObjectCount} claimed
          </span>
          <span>{inventoryDrawerSummary.openPlantingObjectCount} open</span>
          <span>next open: {inventoryDrawerSummary.nextOpenObjectLabel}</span>
          <span>crops: {inventoryDrawerSummary.activeCropsLabel}</span>
          <span>next task: {inventoryDrawerSummary.nextTaskDateLabel}</span>
          <span>{inventoryDrawerSummary.overdueTaskCount} overdue</span>
          <span>{inventoryDrawerInventory.revenueLabel}</span>
        </div>
      </div>
    </div>
  ) : (
    <div className="atlas-closed-drawer-summary">
      <span>{getAtlasAreaLabel(inventoryAreaId)}</span>
      <span>
        {inventoryDrawerSummary.claimedPlantingObjectCount}/
        {inventoryDrawerSummary.plantingObjectCount} claimed
      </span>
      <span>{inventoryDrawerSummary.openPlantingObjectCount} open</span>
    </div>
  )}
</section>




<section className="atlas-soft-card atlas-closed-drawer-card">
  <button
    type="button"
    className="atlas-soft-head atlas-drawer-trigger"
    onClick={() => setShowOperationsDrawer((current) => !current)}
  >
    <div>
      <span className="atlas-soft-label">Growing Zone</span>
      <h2 className="atlas-soft-heading">Operations</h2>
    </div>

    <span className="atlas-soft-badge">
      {showOperationsDrawer ? "Close" : `${operationsOpenTasks.length} open`}
    </span>
  </button>

  {showOperationsDrawer ? (
    <div className="atlas-open-drawer-body">
      <label className="atlas-compact-select-label">
        <span className="atlas-soft-label">Selected zone</span>
        <select
          value={operationsAreaId}
          onChange={(event) =>
            setOperationsAreaId(event.target.value as AtlasAreaId)
          }
        >
          {atlasAreas2026.map((area) => (
            <option key={area.id} value={area.id}>
              {getAtlasAreaLabel(area.id)}
            </option>
          ))}
        </select>
      </label>

      <div className="atlas-drawer-detail">
        <div className="atlas-soft-head">
          <div>
            <span className="atlas-soft-label">Open Work</span>
            <h3 className="atlas-soft-heading">
              {getAtlasAreaLabel(operationsAreaId)}
            </h3>
          </div>

          <button
            type="button"
            className="atlas-soft-badge"
            onClick={() => setShowOperationsDrawer(false)}
            style={{ border: 0, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div className="atlas-task-list" style={{ marginTop: 10 }}>
          {operationsOverdueTasks.length > 0
            ? operationsOverdueTasks
                .slice(0, 4)
                .map((task) => <TaskCard key={task.id} task={task} />)
            : operationsOpenTasks
                .slice(0, 4)
                .map((task) => <TaskCard key={task.id} task={task} />)}

          {operationsOpenTasks.length === 0 ? (
            <div className="atlas-empty">No open work in this zone.</div>
          ) : null}
        </div>
      </div>
    </div>
  ) : (
    <div className="atlas-closed-drawer-summary">
      <span>{getAtlasAreaLabel(operationsAreaId)}</span>
      <span>{operationsOpenTasks.length} open</span>
      <span>{operationsOverdueTasks.length} overdue</span>
    </div>
  )}
</section>



          {tab === "zones" ? (
            <section className="atlas-soft-card">
              <div className="atlas-soft-head">
                <div>
                  <span className="atlas-soft-label">Zones</span>
                  <h2 className="atlas-soft-heading">Tap in</h2>
                </div>
              </div>

              <div className="atlas-zone-list">
                {atlasAreas2026.map((area) => {
                  const summary = getAreaObjectStateSummary(area.id, allClaims, tasks, today);
                  const inventory = getAreaInventorySummary(area.id, allClaims);

                  return (
                    <button
                      key={area.id}
                      className={`atlas-zone-row ${selectedAreaId === area.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedAreaId(area.id);
                        setTab("today");
                      }}
                    >
                      <div>
                        <span>{summary.overdueTaskCount > 0 ? "Needs attention" : "Zone"}</span>
                        <strong>{getAtlasAreaLabel(area.id)}</strong>
                        <small>
                          {summary.nextTaskLabel} · crops: {inventory.cropsLabel}
                        </small>
                      </div>
                      <div className="atlas-zone-row-counts">
                        <b>
                          {dashboardZoneByKey.get(area.id)?.object_count ??
                            summary.plantingObjectCount}
                        </b>
                        <em>objects</em>
                        {summary.overdueTaskCount > 0 ? (
                          <i>{summary.overdueTaskCount} late</i>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {tab === "projects" ? (
            <section className="atlas-soft-card">
              <div className="atlas-soft-head">
                <div>
                  <span className="atlas-soft-label">Projects</span>
                  <h2 className="atlas-soft-heading">Progress chains</h2>
                </div>
              </div>

              <div className="atlas-task-list" style={{ marginTop: 10 }}>
               {(selectedProjectCards.length ? selectedProjectCards : projects).map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </section>
          ) : null}



<section className="atlas-soft-card">
  <button
    type="button"
    className="atlas-soft-head"
    onClick={() => setShowLedger((current) => !current)}
    style={{
      width: "100%",
      border: 0,
      background: "transparent",
      padding: 0,
      textAlign: "left",
      cursor: "pointer",
    }}
  >
    <div>
      <span className="atlas-soft-label">Field + Garden</span>
      <h2 className="atlas-soft-heading">Ledger</h2>
    </div>

    <span className="atlas-soft-badge">
      {showLedger ? "Close" : `${fieldLog.length} logs`}
    </span>
  </button>

  {showLedger ? (
    <div className="atlas-field-log-list" style={{ marginTop: 12 }}>
      {fieldLog.length === 0 ? (
        <div className="atlas-empty">
          No local field logs yet. Use the green + to claim what you touched.
        </div>
      ) : (
        fieldLog.slice(0, 8).map((entry) => (
          <article key={entry.id} className="atlas-field-log-item">
            <div className="atlas-field-log-main">
              <strong>{entry.title}</strong>
              <span>{entry.detail}</span>
              {entry.note ? <span>{entry.note}</span> : null}
            </div>

            <div className="atlas-field-log-meta">
              <span>{prettyDate(entry.date)}</span>
              {entry.actions.map((action) => (
                <span key={action}>{actionLabel(action)}</span>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  ) : fieldLog.length > 0 ? (
    <div className="atlas-zone-mini-stats" style={{ marginTop: 12 }}>
      <span>Latest: {prettyDate(fieldLog[0].date)}</span>
      <span>{fieldLog[0].title}</span>
    </div>
  ) : null}
</section>

        </div>
      </section>


{focusedLocalTask ? (
  <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
    <div className="atlas-task-focus-phone">
      <div className="atlas-task-focus-topbar">
        <div>
          <span className="atlas-phone-kicker">Atlas task</span>
          <strong>{getAtlasAreaLabel(focusedLocalTask.areaId)}</strong>
        </div>

        <button type="button" onClick={closeLocalTaskCard}>
          Close
        </button>
      </div>

      <div className="atlas-task-focus-body">
        <section className="atlas-task-focus-purple">
          <div className="atlas-task-focus-kicker">
            <span>{prettyDate(focusedLocalTask.date)}</span>
            <span>{getAtlasAreaLabel(focusedLocalTask.areaId)}</span>
            <span>{focusedLocalTask.status}</span>
          </div>

          <h2>{focusedLocalTask.title}</h2>

          <p>{focusedLocalTask.unlockText}</p>
        </section>

        <section className="atlas-task-focus-section">
          <span className="atlas-soft-label">Where</span>

          <div className="atlas-zone-mini-stats">
            <span>{getAtlasAreaLabel(focusedLocalTask.areaId)}</span>

            {focusedLocalTask.objectId ? (
              <span>{getGrowingObjectLabel(focusedLocalTask.objectId)}</span>
            ) : (
              <span>Whole zone</span>
            )}

            <span>{focusedLocalTask.actionType.replaceAll("_", " ")}</span>

            {focusedLocalTask.packet ? (
              <span>{focusedLocalTask.packet}</span>
            ) : null}
          </div>
        </section>

        {focusedLocalTask.instructions ? (
          <section className="atlas-task-focus-section">
            <span className="atlas-soft-label">How to play it</span>
            <p>{focusedLocalTask.instructions}</p>
          </section>
        ) : null}

        <section className="atlas-task-focus-section">
          <span className="atlas-soft-label">How I played this card</span>

          <div className="atlas-task-play-actions">
            <button
              type="button"
              aria-label="Done"
              onClick={() => {
                updateTaskStatus(focusedLocalTask, "done");
                closeLocalTaskCard();
              }}
            >
              ✓
            </button>

            <button
              type="button"
              aria-label="Progress"
              onClick={() => {
                updateTaskStatus(focusedLocalTask, "open");
                closeLocalTaskCard();
              }}
            >
              ↗
            </button>

            <button
              type="button"
              aria-label="Blocked"
              onClick={() => {
                updateTaskStatus(focusedLocalTask, "blocked");
                closeLocalTaskCard();
              }}
            >
              ×
            </button>

            <button
              type="button"
              aria-label="Add field note"
              onClick={() => {
                setQuickSelectedActions([
                  taskActionToWorkAction(focusedLocalTask.actionType),
                ]);
                setQuickSelectedAreas([focusedLocalTask.areaId]);
                setQuickSelectedObjects(
                  focusedLocalTask.objectId ? [focusedLocalTask.objectId] : [],
                );
                setQuickStep(4);
                setShowQuickLog(true);
                closeLocalTaskCard();

                window.setTimeout(() => {
                  document
                    .getElementById("atlas-quick-log-form")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }}
            >
              +
            </button>
          </div>
        </section>

        <div className="atlas-task-focus-nav">
          <button
            type="button"
            disabled={!previousFocusedTask}
            onClick={() => moveLocalTaskFocus(previousFocusedTask)}
          >
            ← Previous
          </button>

          <button
            type="button"
            disabled={!nextFocusedTask}
            onClick={() => moveLocalTaskFocus(nextFocusedTask)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  </section>
) : null}

{showTaskCardDrawer ? (
  <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
    <div className="atlas-task-focus-phone">
      <div className="atlas-task-focus-topbar">
        <div>
          <span className="atlas-phone-kicker">Project task</span>
          <strong>{selectedTaskCard?.zone_label ?? "Atlas"}</strong>
        </div>

        <button type="button" onClick={closeSupabaseTaskCard}>
          Close
        </button>
      </div>

      <div className="atlas-task-focus-body">
        {taskCardLoading ? (
          <div className="atlas-empty">Loading task card...</div>
        ) : taskCardError ? (
          <div className="atlas-empty">{taskCardError}</div>
        ) : selectedTaskCard ? (
          <>
            <section className="atlas-task-focus-purple">
              <div className="atlas-task-focus-kicker">
                <span>{selectedTaskCard.zone_label ?? "Whole farm"}</span>
                <span>{selectedTaskCard.priority}</span>
                <span>{selectedTaskCard.status}</span>

                {selectedTaskCard.due_date ? (
                  <span>Due {prettyDate(selectedTaskCard.due_date)}</span>
                ) : null}
              </div>

              <h2>{selectedTaskCard.title}</h2>

              {selectedTaskCard.unlock_text ? (
                <p>{selectedTaskCard.unlock_text}</p>
              ) : null}
            </section>

            {selectedTaskCard.objects.length > 0 ? (
              <section className="atlas-task-focus-section">
                <span className="atlas-soft-label">Where</span>

                <div className="atlas-zone-mini-stats">
                  {selectedTaskCard.objects.map((object) => (
                    <span key={object.object_id}>{object.object_label}</span>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedTaskCard.resource_requirements.length > 0 ? (
              <section className="atlas-task-focus-section">
                <span className="atlas-soft-label">Bring Outside</span>

                <div className="atlas-zone-mini-stats">
                  {selectedTaskCard.resource_requirements
                    .filter((requirement) => requirement.resource_label)
                    .map((requirement) => (
                      <span key={requirement.requirement_id}>
                        {requirement.resource_label}
                      </span>
                    ))}
                </div>
              </section>
            ) : null}

            <section className="atlas-task-focus-section">
              <span className="atlas-soft-label">How I played this card</span>

              <div className="atlas-task-play-actions">
                <button
                  type="button"
                  onClick={() => void handleTaskResult("done")}
                  disabled={taskResultSaving !== null}
                >
                  {taskResultSaving === "done" ? "…" : "✓"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleTaskResult("partial")}
                  disabled={taskResultSaving !== null}
                >
                  {taskResultSaving === "partial" ? "…" : "↗"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleTaskResult("blocked")}
                  disabled={taskResultSaving !== null}
                >
                  {taskResultSaving === "blocked" ? "…" : "×"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleTaskResult("needs_supplies")}
                  disabled={taskResultSaving !== null}
                >
                  {taskResultSaving === "needs_supplies" ? "…" : "+"}
                </button>
              </div>

              {taskResultMessage ? (
                <p className="atlas-task-result-message">
                  {taskResultMessage}
                </p>
              ) : null}
            </section>

            {selectedTaskCard.task_logs.length > 0 ? (
              <section className="atlas-task-focus-section">
                <span className="atlas-soft-label">Progress Log</span>

                <div className="atlas-field-log-list">
                  {selectedTaskCard.task_logs.slice(0, 4).map((log) => (
                    <article key={log.field_log_id} className="atlas-field-log-item">
                      <div className="atlas-field-log-main">
                        <strong>{prettyDate(log.log_date)}</strong>
                        <span>{log.summary_sentence}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="atlas-empty">No task card loaded.</div>
        )}
      </div>
    </div>
  </section>
) : null}

{focusedProjectStep ? (
  <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
    <div className="atlas-task-focus-phone">
      <div className="atlas-task-focus-topbar">
        <div>
          <span className="atlas-phone-kicker">Project step</span>
          <strong>Atlas</strong>
        </div>

        <button type="button" onClick={() => setFocusedProjectStep(null)}>
          Close
        </button>
      </div>

      <div className="atlas-task-focus-body">
        <section className="atlas-task-focus-purple">
          <div className="atlas-task-focus-kicker">
            <span>Step {focusedProjectStep.step_order}</span>

            {focusedProjectStep.task_due_date ? (
              <span>{prettyDate(focusedProjectStep.task_due_date)}</span>
            ) : null}

            <span>{focusedProjectStep.step_status ?? "step"}</span>
          </div>

          <h2>{focusedProjectStep.step_title}</h2>

          {focusedProjectStep.unlock_text ? (
            <p>{focusedProjectStep.unlock_text}</p>
          ) : focusedProjectStep.step_note ? (
            <p>{focusedProjectStep.step_note}</p>
          ) : (
            <p>This project step exists, but it is not linked to a full task card yet.</p>
          )}
        </section>

        <section className="atlas-task-focus-section">
          <span className="atlas-soft-label">Why this opened differently</span>
          <p>
            This step is part of the project chain, but it does not have a linked
            Supabase task record yet. It can still be viewed here without feeling
            broken.
          </p>
        </section>
      </div>
    </div>
  </section>
) : null}

    </main>
  );
}