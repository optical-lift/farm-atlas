export type AtlasMoonDirection = "waxing" | "waning" | "boundary";
export type AtlasMoonSignQuality = "fruitful" | "productive" | "barren";
export type AtlasLunarActionFamily =
  | "aboveground_planting"
  | "belowground_planting"
  | "maintenance"
  | "aboveground_harvest"
  | "belowground_harvest";
export type AtlasLunarFit = "favored" | "neutral" | "caution";

export type AtlasLunarClock = {
  dateIso: string;
  phase: string;
  illuminationPct: number | null;
  direction: AtlasMoonDirection;
  moonrise: string | null;
  moonset: string | null;
  closestPhase: {
    phase: string;
    dateIso: string | null;
    time: string | null;
  } | null;
  sign: string;
  signSymbol: string;
  signQuality: AtlasMoonSignQuality;
  signBasis: "tropical_local_noon";
  source: "usno" | "calculated_fallback";
};

export type AtlasLunarGuidance = {
  profileKey: "elm_almanac_v1";
  traditional: true;
  strength: "strong" | "moderate" | "work_window";
  headline: string;
  detail: string;
  favoredFamilies: AtlasLunarActionFamily[];
  favoredActions: string[];
};

export type AtlasLunarTaskInput = {
  id: string;
  title: string;
  actionKey?: string | null;
  taskType?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AtlasLunarTaskHint = {
  taskId: string;
  title: string;
  dueDate: string | null;
  family: AtlasLunarActionFamily;
  fit: AtlasLunarFit;
  reason: string;
};

const DAY_MS = 86_400_000;
const SYNODIC_MONTH_DAYS = 29.53058867;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);

const SIGNS = [
  { name: "Aries", symbol: "♈︎", quality: "barren" as const },
  { name: "Taurus", symbol: "♉︎", quality: "productive" as const },
  { name: "Gemini", symbol: "♊︎", quality: "barren" as const },
  { name: "Cancer", symbol: "♋︎", quality: "fruitful" as const },
  { name: "Leo", symbol: "♌︎", quality: "barren" as const },
  { name: "Virgo", symbol: "♍︎", quality: "barren" as const },
  { name: "Libra", symbol: "♎︎", quality: "productive" as const },
  { name: "Scorpio", symbol: "♏︎", quality: "fruitful" as const },
  { name: "Sagittarius", symbol: "♐︎", quality: "barren" as const },
  { name: "Capricorn", symbol: "♑︎", quality: "productive" as const },
  { name: "Aquarius", symbol: "♒︎", quality: "barren" as const },
  { name: "Pisces", symbol: "♓︎", quality: "fruitful" as const },
];

const LUNAR_FAMILIES = new Set<AtlasLunarActionFamily>([
  "aboveground_planting",
  "belowground_planting",
  "maintenance",
  "aboveground_harvest",
  "belowground_harvest",
]);

const FAMILY_LABELS: Record<AtlasLunarActionFamily, string> = {
  aboveground_planting: "Aboveground planting",
  belowground_planting: "Roots + bulbs",
  maintenance: "Maintenance",
  aboveground_harvest: "Flower + fruit harvest",
  belowground_harvest: "Root + bulb harvest",
};

const ACTION_FAMILIES: Record<string, AtlasLunarActionFamily> = {
  sow: "aboveground_planting",
  seed: "aboveground_planting",
  plant: "aboveground_planting",
  transplant: "aboveground_planting",
  pot_up: "aboveground_planting",
  set_out: "aboveground_planting",
  plant_bulbs: "belowground_planting",
  plant_roots: "belowground_planting",
  divide: "belowground_planting",
  harvest: "aboveground_harvest",
  cut_flowers: "aboveground_harvest",
  dig: "belowground_harvest",
  lift: "belowground_harvest",
  pull_roots: "belowground_harvest",
  weed: "maintenance",
  weeding: "maintenance",
  cultivate: "maintenance",
  cultivation: "maintenance",
  prune: "maintenance",
  pruning: "maintenance",
  thin: "maintenance",
  thinning: "maintenance",
  mow: "maintenance",
  mowing: "maintenance",
  spray: "maintenance",
  respray: "maintenance",
  manage_pests: "maintenance",
  pest_control: "maintenance",
  clear: "maintenance",
  cleanup: "maintenance",
  clean_up: "maintenance",
  remove: "maintenance",
  deadhead: "maintenance",
  cut_back: "maintenance",
  tree_removal: "maintenance",
  maintenance: "maintenance",
};

const TASK_TYPE_FAMILIES: Record<string, AtlasLunarActionFamily> = {
  sowing: "aboveground_planting",
  planting: "aboveground_planting",
  transplanting: "aboveground_planting",
  pot_up: "aboveground_planting",
  bulb_planting: "belowground_planting",
  root_planting: "belowground_planting",
  division: "belowground_planting",
  harvest: "aboveground_harvest",
  flower_harvest: "aboveground_harvest",
  root_harvest: "belowground_harvest",
  bulb_harvest: "belowground_harvest",
  maintenance: "maintenance",
  mowing: "maintenance",
  grounds_mowing: "maintenance",
  weed_control: "maintenance",
  garden_cleanup: "maintenance",
  cleanup: "maintenance",
  bed_prep: "maintenance",
  grounds_tree_work: "maintenance",
  marshall_tree_work: "maintenance",
};

const BELOWGROUND_PARTS = new Set([
  "root",
  "roots",
  "bulb",
  "bulbs",
  "rhizome",
  "rhizomes",
  "tuber",
  "tubers",
  "corm",
  "corms",
]);

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function parseIsoParts(dateIso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) return null;
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
  };
}

function nthSunday(year: number, monthIndex: number, occurrence: number) {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  return firstSunday + ((occurrence - 1) * 7);
}

function usesUsDaylightTimeOn(dateIso: string) {
  const parts = parseIsoParts(dateIso);
  if (!parts) return false;
  if (parts.month < 3 || parts.month > 11) return false;
  if (parts.month > 3 && parts.month < 11) return true;
  if (parts.month === 3) return parts.day >= nthSunday(parts.year, 2, 2);
  return parts.day < nthSunday(parts.year, 10, 1);
}

export function localNoonUtc(
  dateIso: string,
  standardOffsetHours = -6,
  usesUsDaylightTime = true,
) {
  const parts = parseIsoParts(dateIso);
  if (!parts) return new Date(`${dateIso}T12:00:00Z`);
  const daylightAdjustment = usesUsDaylightTime && usesUsDaylightTimeOn(dateIso) ? 1 : 0;
  const localOffsetHours = standardOffsetHours + daylightAdjustment;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12 - localOffsetHours));
}

function julianDay(date: Date) {
  return (date.getTime() / DAY_MS) + 2440587.5;
}

export function tropicalMoonLongitude(date: Date) {
  const d = julianDay(date) - 2451545.0;
  const meanLongitude = normalizeDegrees(218.3164477 + (13.17639648 * d));
  const elongation = normalizeDegrees(297.8501921 + (12.19074912 * d));
  const solarAnomaly = normalizeDegrees(357.5291092 + (0.98560028 * d));
  const lunarAnomaly = normalizeDegrees(134.9633964 + (13.06499295 * d));
  const latitudeArgument = normalizeDegrees(93.2720950 + (13.22935024 * d));

  let longitude = meanLongitude;
  longitude += 6.289 * Math.sin(radians(lunarAnomaly));
  longitude += 1.274 * Math.sin(radians((2 * elongation) - lunarAnomaly));
  longitude += 0.658 * Math.sin(radians(2 * elongation));
  longitude += 0.214 * Math.sin(radians(2 * lunarAnomaly));
  longitude -= 0.186 * Math.sin(radians(solarAnomaly));
  longitude -= 0.059 * Math.sin(radians((2 * elongation) - (2 * lunarAnomaly)));
  longitude -= 0.057 * Math.sin(radians((2 * elongation) - solarAnomaly - lunarAnomaly));
  longitude += 0.053 * Math.sin(radians((2 * elongation) + lunarAnomaly));
  longitude += 0.046 * Math.sin(radians((2 * elongation) - solarAnomaly));
  longitude += 0.041 * Math.sin(radians(solarAnomaly - lunarAnomaly));
  longitude -= 0.035 * Math.sin(radians(elongation));
  longitude -= 0.031 * Math.sin(radians(solarAnomaly + lunarAnomaly));
  longitude -= 0.015 * Math.sin(radians((2 * latitudeArgument) - (2 * elongation)));
  longitude += 0.011 * Math.sin(radians((2 * elongation) - (4 * lunarAnomaly)));
  return normalizeDegrees(longitude);
}

export function tropicalMoonSign(
  dateIso: string,
  standardOffsetHours = -6,
  usesUsDaylightTime = true,
) {
  const longitude = tropicalMoonLongitude(
    localNoonUtc(dateIso, standardOffsetHours, usesUsDaylightTime),
  );
  return SIGNS[Math.floor(longitude / 30) % 12];
}

export function approximateMoon(dateIso: string) {
  const date = localNoonUtc(dateIso);
  const elapsedDays = (date.getTime() - KNOWN_NEW_MOON_UTC) / DAY_MS;
  const ageDays = ((elapsedDays % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  const fraction = ageDays / SYNODIC_MONTH_DAYS;
  const illuminationPct = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100);
  const phase = fraction < 0.03 || fraction >= 0.97
    ? "New Moon"
    : fraction < 0.22
      ? "Waxing Crescent"
      : fraction < 0.28
        ? "First Quarter"
        : fraction < 0.47
          ? "Waxing Gibbous"
          : fraction < 0.53
            ? "Full Moon"
            : fraction < 0.72
              ? "Waning Gibbous"
              : fraction < 0.78
                ? "Last Quarter"
                : "Waning Crescent";
  return { phase, illuminationPct };
}

export function moonDirection(phase: string): AtlasMoonDirection {
  const normalized = phase.toLowerCase();
  if (normalized.includes("new moon") || normalized.includes("full moon")) return "boundary";
  if (normalized.includes("waxing") || normalized.includes("first quarter")) return "waxing";
  if (normalized.includes("waning") || normalized.includes("last quarter") || normalized.includes("third quarter")) return "waning";
  return "boundary";
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeKey(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function explicitLunarFamily(task: AtlasLunarTaskInput) {
  const value = normalizeKey(metadataString(task.metadata, "lunar_family"));
  return LUNAR_FAMILIES.has(value as AtlasLunarActionFamily)
    ? value as AtlasLunarActionFamily
    : null;
}

function isBelowground(task: AtlasLunarTaskInput) {
  const part = normalizeKey(metadataString(task.metadata, "plant_part"));
  return BELOWGROUND_PARTS.has(part);
}

function withPlantPart(
  family: AtlasLunarActionFamily | null,
  belowground: boolean,
): AtlasLunarActionFamily | null {
  if (!family || !belowground) return family;
  if (family === "aboveground_planting") return "belowground_planting";
  if (family === "aboveground_harvest") return "belowground_harvest";
  return family;
}

export function classifyLunarTask(task: AtlasLunarTaskInput): AtlasLunarActionFamily | null {
  const explicit = explicitLunarFamily(task);
  if (explicit) return explicit;

  const action = normalizeKey(task.actionKey)
    || normalizeKey(metadataString(task.metadata, "display_action"));
  const taskType = normalizeKey(task.taskType);
  const family = ACTION_FAMILIES[action] ?? TASK_TYPE_FAMILIES[taskType] ?? null;
  return withPlantPart(family, isBelowground(task));
}

function displayTitle(task: AtlasLunarTaskInput) {
  const action = metadataString(task.metadata, "display_action");
  const subject = metadataString(task.metadata, "display_subject");
  if (action && subject) {
    const duplicateAction = subject.toLowerCase().startsWith(`${action.toLowerCase()} `);
    return duplicateAction ? subject : `${action} ${subject}`;
  }
  return subject || task.title;
}

function displayContext(task: AtlasLunarTaskInput, family: AtlasLunarActionFamily) {
  const familyLabel = metadataString(task.metadata, "display_family")
    || metadataString(task.metadata, "work_category_label")
    || FAMILY_LABELS[family];
  const location = metadataString(task.metadata, "display_location")
    || metadataString(task.metadata, "location_label")
    || metadataString(task.metadata, "collection_zone");
  return [...new Set([familyLabel, location].filter(Boolean))].join(" · ");
}

export function lunarGuidance(clock: AtlasLunarClock): AtlasLunarGuidance {
  const phase = clock.phase.toLowerCase();
  const barren = clock.signQuality === "barren";
  const fruitful = clock.signQuality === "fruitful";

  if (barren) {
    return {
      profileKey: "elm_almanac_v1",
      traditional: true,
      strength: "work_window",
      headline: `${clock.sign} favors clearing work`,
      detail: `${clock.phase} · ${clock.sign} · maintenance and clearing`,
      favoredFamilies: ["maintenance"],
      favoredActions: ["weed", "cultivate", "prune", "manage pests"],
    };
  }

  if (clock.direction === "waxing") {
    return {
      profileKey: "elm_almanac_v1",
      traditional: true,
      strength: fruitful ? "strong" : "moderate",
      headline: fruitful ? "Strong aboveground planting window" : "Aboveground planting window",
      detail: `${clock.phase} · ${clock.sign} · annual flowers and aboveground crops`,
      favoredFamilies: ["aboveground_planting", "aboveground_harvest"],
      favoredActions: ["sow annual flowers", "transplant aboveground crops", "harvest flowers and fruit"],
    };
  }

  if (clock.direction === "waning") {
    const lateWaning = phase.includes("last quarter") || phase.includes("waning crescent");
    return {
      profileKey: "elm_almanac_v1",
      traditional: true,
      strength: fruitful ? "strong" : lateWaning ? "work_window" : "moderate",
      headline: lateWaning ? "Roots, bulbs, and clearing work" : "Roots, bulbs, and perennial work",
      detail: `${clock.phase} · ${clock.sign} · roots, bulbs, and divisions${lateWaning ? " · weeding and pruning" : ""}`,
      favoredFamilies: lateWaning
        ? ["belowground_planting", "belowground_harvest", "maintenance"]
        : ["belowground_planting", "belowground_harvest"],
      favoredActions: lateWaning
        ? ["plant bulbs and roots", "divide perennials", "weed and prune"]
        : ["plant bulbs and roots", "divide perennials", "harvest roots for storage"],
    };
  }

  if (phase.includes("full moon")) {
    return {
      profileKey: "elm_almanac_v1",
      traditional: true,
      strength: fruitful ? "strong" : "moderate",
      headline: "Full-Moon turning point",
      detail: `${clock.phase} · ${clock.sign} · turning toward roots, bulbs, and divisions`,
      favoredFamilies: ["belowground_planting", "belowground_harvest"],
      favoredActions: ["prepare bulb and root work", "divide perennials", "finish time-sensitive aboveground planting"],
    };
  }

  return {
    profileKey: "elm_almanac_v1",
    traditional: true,
    strength: fruitful ? "strong" : "moderate",
    headline: "New-Moon planting turn",
    detail: `${clock.phase} · ${clock.sign} · opening aboveground planting work`,
    favoredFamilies: ["aboveground_planting"],
    favoredActions: ["sow annual flowers", "plant aboveground crops", "begin new successions"],
  };
}

export function lunarTaskHint(task: AtlasLunarTaskInput, clock: AtlasLunarClock): AtlasLunarTaskHint | null {
  const family = classifyLunarTask(task);
  if (!family) return null;
  const guidance = lunarGuidance(clock);
  const phaseFavored = guidance.favoredFamilies.includes(family);
  const planting = family === "aboveground_planting" || family === "belowground_planting";
  const signCaution = planting && clock.signQuality === "barren";

  const fit: AtlasLunarFit = phaseFavored
    ? "favored"
    : signCaution
      ? "caution"
      : "neutral";

  return {
    taskId: task.id,
    title: displayTitle(task),
    dueDate: task.dueDate ?? null,
    family,
    fit,
    reason: displayContext(task, family),
  };
}
