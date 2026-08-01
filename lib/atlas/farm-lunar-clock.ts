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

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function classifyLunarTask(task: AtlasLunarTaskInput): AtlasLunarActionFamily | null {
  const joined = [
    task.title,
    task.actionKey,
    task.taskType,
    metadataText(task.metadata, "display_action"),
    metadataText(task.metadata, "display_subject"),
    metadataText(task.metadata, "crop_family"),
    metadataText(task.metadata, "plant_part"),
  ].filter(Boolean).join(" ").toLowerCase();

  const belowground = /\b(root|bulb|tulip|garlic|onion|iris|rhizome|tuber|corm|dahlia|carrot|beet|radish|turnip|potato)\b/.test(joined);
  const harvest = /\b(harvest|dig|lift|pull|cut)\b/.test(joined);
  if (harvest && belowground) return "belowground_harvest";
  if (harvest) return "aboveground_harvest";
  if (/\b(weed|cultivat|prune|thin|mow|pest|clear|cleanup|clean up|remove|deadhead)\b/.test(joined)) {
    return "maintenance";
  }
  if (/\b(sow|seed|plant|transplant|divide|pot up|pot-up|set out)\b/.test(joined)) {
    return belowground ? "belowground_planting" : "aboveground_planting";
  }
  return null;
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
      detail: "Traditional almanac practice treats this Moon sign as better for weeding, cultivating, pruning, pest work, and general farm work than for sowing.",
      favoredFamilies: ["maintenance"],
      favoredActions: ["weed", "cultivate", "prune", "manage pests"],
    };
  }

  if (clock.direction === "waxing") {
    const signDetail = fruitful
      ? `, strengthened by fruitful ${clock.sign}`
      : `; ${clock.sign} is treated as moderately productive`;
    return {
      profileKey: "elm_almanac_v1",
      traditional: true,
      strength: fruitful ? "strong" : "moderate",
      headline: fruitful ? "Strong aboveground planting window" : "Aboveground planting window",
      detail: `${clock.phase} traditionally favors annual flowers and crops that grow or bear above ground${signDetail}.`,
      favoredFamilies: ["aboveground_planting", "aboveground_harvest"],
      favoredActions: ["sow annual flowers", "transplant aboveground crops", "harvest flowers and fruit"],
    };
  }

  if (clock.direction === "waning") {
    const lateWaning = phase.includes("last quarter") || phase.includes("waning crescent");
    const signDetail = fruitful ? `; fruitful ${clock.sign} strengthens planting work` : "";
    return {
      profileKey: "elm_almanac_v1",
      traditional: true,
      strength: fruitful ? "strong" : lateWaning ? "work_window" : "moderate",
      headline: lateWaning ? "Roots, bulbs, and clearing work" : "Roots, bulbs, and perennial work",
      detail: `${clock.phase} traditionally favors belowground crops, bulbs, divisions, and root-establishing work${lateWaning ? ", with the late waning period also used for weeding and pruning" : ""}${signDetail}.`,
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
      detail: "The traditional calendar is turning from aboveground planting toward roots, bulbs, divisions, and belowground work after the Full Moon peak.",
      favoredFamilies: ["belowground_planting", "belowground_harvest"],
      favoredActions: ["prepare bulb and root work", "divide perennials", "finish time-sensitive aboveground planting"],
    };
  }

  return {
    profileKey: "elm_almanac_v1",
    traditional: true,
    strength: fruitful ? "strong" : "moderate",
    headline: "New-Moon planting turn",
    detail: "The traditional calendar is opening a waxing period for annual flowers and other aboveground crops, while field readiness and weather remain the controlling conditions.",
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
  const signBoost = planting && clock.signQuality === "fruitful";
  const signCaution = planting && clock.signQuality === "barren";
  const maintenanceBoost = family === "maintenance" && clock.signQuality === "barren";

  const fit: AtlasLunarFit = phaseFavored && (signBoost || maintenanceBoost)
    ? "favored"
    : phaseFavored
      ? "favored"
      : signCaution
        ? "caution"
        : "neutral";
  const reason = fit === "favored"
    ? `${clock.phase} and ${clock.sign} align with this traditional work family.`
    : fit === "caution"
      ? `${clock.sign} is traditionally used for clearing work; keep the crop and weather window ahead of the lunar preference.`
      : "The lunar window is neutral for this task; agronomic timing and field conditions remain primary.";

  return {
    taskId: task.id,
    title: task.title,
    dueDate: task.dueDate ?? null,
    family,
    fit,
    reason,
  };
}
