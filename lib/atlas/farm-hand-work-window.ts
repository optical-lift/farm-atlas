import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasUniversalHomeModel, AtlasUniversalMove } from "@/lib/atlas/universal-home";

export const FARM_HAND_OUTDOOR_MORNING_END_HOUR = 11;
export const FARM_HAND_OUTDOOR_EVENING_START_HOUR = 19;

const INDOOR_TERMS = [
  "grow room",
  "kitchen",
  "living room",
  "lounge",
  "bathroom",
  "basement",
  "garage freezer",
  "coffee bar",
  "inside",
  "indoor",
];

const OUTDOOR_TERMS = [
  "field row",
  "field rows",
  "fr1",
  "fr2",
  "fr3",
  "fr4",
  "fr5",
  "fr6",
  "fr7",
  "fr8",
  "fr9",
  "fr10",
  "fr11",
  "fr12",
  "fr13",
  "fr14",
  "fr15",
  "fr16",
  "fr17",
  "fr18",
  "barn bed",
  "bb1",
  "bb2",
  "bb3",
  "bb4",
  "bb5",
  "bb6",
  "bb7",
  "bb8",
  "bb9",
  "berry walk",
  "main garden",
  "entry billboard",
  "curve garden",
  "follow me",
  "lilac haven",
  "hydrangea",
  "labyrinth",
  "crescent moon",
  "u-pick",
  "upick",
  "mailbox",
  "redbud",
  "orchard",
  "garden",
  "mow",
  "weed",
  "harvest",
  "transplant",
  "sow",
  "spray",
  "fishing line",
];

function centralHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(hour);
}

export function atlasFarmHandOutsideWorkIsAvailable(date = new Date()) {
  const hour = centralHour(date);
  return hour < FARM_HAND_OUTDOOR_MORNING_END_HOUR || hour >= FARM_HAND_OUTDOOR_EVENING_START_HOUR;
}

export function atlasTaskIsOutdoor(task: AtlasTaskCard) {
  const explicit = task.metadata?.work_environment ?? task.metadata?.environment ?? task.metadata?.work_location_type;
  if (typeof explicit === "string") {
    const normalized = explicit.trim().toLowerCase();
    if (["indoor", "inside", "covered_indoor"].includes(normalized)) return false;
    if (["outdoor", "outside", "field"].includes(normalized)) return true;
  }

  if (task.metadata?.outdoor === true || task.metadata?.outside === true) return true;
  if (task.metadata?.indoor === true || task.metadata?.inside === true) return false;

  const haystack = [
    task.title,
    task.task_type,
    task.action_key,
    task.work_class,
    task.zone_key,
    task.zone_label,
    ...task.objects.map((object) => `${object.object_key} ${object.object_label} ${object.object_type}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (INDOOR_TERMS.some((term) => haystack.includes(term))) return false;
  return OUTDOOR_TERMS.some((term) => haystack.includes(term));
}

function taskIdFromMove(move: AtlasUniversalMove) {
  if (move.kind !== "farm_task" || !move.key.startsWith("farm-task:")) return null;
  return move.key.split(":").at(-1) ?? null;
}

export function atlasFarmHandMoveIsAvailableNow(
  home: AtlasUniversalHomeModel,
  move: AtlasUniversalMove,
  date = new Date(),
) {
  if (atlasFarmHandOutsideWorkIsAvailable(date)) return true;
  const taskId = taskIdFromMove(move);
  if (!taskId) return true;
  const task = home.farms.flatMap((farm) => farm.taskCards).find((candidate) => candidate.task_id === taskId);
  return task ? !atlasTaskIsOutdoor(task) : true;
}

export function atlasFarmHandAvailableMoves(home: AtlasUniversalHomeModel, date = new Date()) {
  return home.moves.filter((move) => atlasFarmHandMoveIsAvailableNow(home, move, date));
}
