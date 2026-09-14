export type EmployeeWorkJournalEntryState =
  | "assigned"
  | "active"
  | "reported_complete"
  | "complete";

export type EmployeeWorkJournalInstitution = {
  organizationId: string;
  organizationName?: string;
  operatingUnitId?: string;
  operatingUnitName?: string;
  employeeSeatId?: string;
  positionId?: string;
  positionTitle?: string;
};

export type EmployeeWorkJournalDeliveryItemInput = {
  id: string;
  key: string;
  title: string;
  details?: string[];
  completed: boolean;
  institutionallyCompleted: boolean;
  reportedCompleted: boolean;
  active: boolean;
  plannedDate: string;
  originalPlannedDate: string;
  carried: boolean;
  resultContractKey: string | null;
  acceptanceMode: string | null;
  timeLabel?: string | null;
};

export type EmployeeWorkJournalReportedInput = {
  id: string;
  key: string;
  title: string;
  effectiveAt: string;
};

export type EmployeeWorkJournalEntry = {
  id: string;
  key: string;
  title: string;
  displayTitle: string;
  guidance: string[];
  state: EmployeeWorkJournalEntryState;
  plannedDate: string;
  originalPlannedDate: string;
  carried: boolean;
  timeLabel: string | null;
  completion: {
    institutionallyComplete: boolean;
    workerReportedComplete: boolean;
    resultContractKey: string | null;
    acceptanceMode: string | null;
  };
  source: {
    kind: "institutional_work_delivery";
    id: string;
  };
};

export type EmployeeWorkJournalReportedEntry = {
  id: string;
  key: string;
  title: string;
  effectiveAt: string;
  source: {
    kind: "employee_report";
    id: string;
  };
};

export type EmployeeWorkJournalDayShape = {
  totalAssigned: number;
  completedAssigned: number;
  remainingAssigned: number;
  activeAssigned: number;
  carriedAssigned: number;
  timedCommitments: number;
  workerReported: number;
  summaryLine: string;
};

export type EmployeeWorkJournalDay = {
  kind: "employee_work_journal_day";
  date: string;
  dateLabel: string;
  timeZone: string;
  institution: EmployeeWorkJournalInstitution;
  entries: EmployeeWorkJournalEntry[];
  reportedEntries: EmployeeWorkJournalReportedEntry[];
  shape: EmployeeWorkJournalDayShape;
};

export type BuildEmployeeWorkJournalDayInput = {
  date: string;
  timeZone: string;
  institution: EmployeeWorkJournalInstitution;
  items: EmployeeWorkJournalDeliveryItemInput[];
  reported?: EmployeeWorkJournalReportedInput[];
};

function journalEntryState(
  item: EmployeeWorkJournalDeliveryItemInput,
): EmployeeWorkJournalEntryState {
  if (item.institutionallyCompleted) return "complete";
  if (item.reportedCompleted) return "reported_complete";
  if (item.active) return "active";
  return "assigned";
}

function formatJournalDate(dateString: string, timeZone: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  const localNoonUtc = new Date(Date.UTC(year, month - 1, day, 12));

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(localNoonUtc);
}

function formatLocalTime(localTime: string) {
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return localTime;
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDuplicateTime(title: string, localTime: string | null) {
  if (!localTime) return title;

  const [hour24, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return title;

  const hour12 = hour24 % 12 || 12;
  const meridiem = hour24 < 12 ? "a(?:\\.?m\\.?)?" : "p(?:\\.?m\\.?)?";
  const minutePattern = minute === 0 ? "(?::00)?" : `:${String(minute).padStart(2, "0")}`;
  const timePattern = `${escapeRegExp(String(hour12))}${minutePattern}\\s*${meridiem}`;
  const trailingTime = new RegExp(
    `(?:\\s*(?:-|–|—|·|@)\\s*|\\s+at\\s+)${timePattern}\\s*$`,
    "i",
  );

  const cleaned = title.replace(trailingTime, "").trim();
  return cleaned || title;
}

const GUIDANCE_FILLER_TOKENS = new Set([
  "a",
  "an",
  "and",
  "after",
  "at",
  "before",
  "by",
  "during",
  "for",
  "friday",
  "in",
  "later",
  "monday",
  "next",
  "of",
  "on",
  "or",
  "round",
  "saturday",
  "sunday",
  "task",
  "then",
  "the",
  "this",
  "thursday",
  "today",
  "tomorrow",
  "tuesday",
  "wednesday",
  "while",
  "with",
  "work",
]);

function contentTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !GUIDANCE_FILLER_TOKENS.has(token));
}

function guidanceAddsInformation(title: string, line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const titleTokens = new Set(contentTokens(title));
  const detailTokens = contentTokens(trimmed);
  if (detailTokens.length === 0) return false;

  return detailTokens.some((token) => !titleTokens.has(token));
}

function informativeGuidance(title: string, details: string[] | undefined) {
  return [...new Set((details ?? []).map((line) => line.trim()).filter(Boolean))].filter(
    (line) => guidanceAddsInformation(title, line),
  );
}

function isExecutionComplete(entry: EmployeeWorkJournalEntry) {
  return entry.state === "complete" || entry.state === "reported_complete";
}

function buildSummaryLine(
  shape: Omit<EmployeeWorkJournalDayShape, "summaryLine">,
  entries: EmployeeWorkJournalEntry[],
) {
  if (shape.remainingAssigned === 0) {
    return "Scheduled work complete";
  }

  const remaining = `${shape.remainingAssigned} remaining`;
  const active = entries.find((entry) => entry.state === "active");
  const nextTimed = entries
    .filter((entry) => !isExecutionComplete(entry) && Boolean(entry.timeLabel))
    .sort((left, right) => (left.timeLabel ?? "").localeCompare(right.timeLabel ?? ""))[0];

  const cues: string[] = [];
  if (active) cues.push(`${active.displayTitle} in progress`);
  cues.push(remaining);
  if (nextTimed?.timeLabel) {
    cues.push(`${nextTimed.displayTitle} at ${formatLocalTime(nextTimed.timeLabel)}`);
  }

  return cues.join(" · ");
}

export function buildEmployeeWorkJournalDay(
  input: BuildEmployeeWorkJournalDayInput,
): EmployeeWorkJournalDay {
  const entries: EmployeeWorkJournalEntry[] = input.items.map((item) => {
    const timeLabel = item.timeLabel ?? null;
    const displayTitle = stripDuplicateTime(item.title, timeLabel);
    return {
      id: item.id,
      key: item.key,
      title: item.title,
      displayTitle,
      guidance: informativeGuidance(displayTitle, item.details),
      state: journalEntryState(item),
      plannedDate: item.plannedDate,
      originalPlannedDate: item.originalPlannedDate,
      carried: item.carried,
      timeLabel,
      completion: {
        institutionallyComplete: item.institutionallyCompleted,
        workerReportedComplete: item.reportedCompleted,
        resultContractKey: item.resultContractKey,
        acceptanceMode: item.acceptanceMode,
      },
      source: {
        kind: "institutional_work_delivery" as const,
        id: item.id,
      },
    };
  });

  const reportedEntries: EmployeeWorkJournalReportedEntry[] = (input.reported ?? []).map(
    (item) => ({
      id: item.id,
      key: item.key,
      title: item.title,
      effectiveAt: item.effectiveAt,
      source: {
        kind: "employee_report",
        id: item.id,
      },
    }),
  );

  const shapeBase = {
    totalAssigned: entries.length,
    completedAssigned: entries.filter(isExecutionComplete).length,
    remainingAssigned: entries.filter((entry) => !isExecutionComplete(entry)).length,
    activeAssigned: entries.filter((entry) => entry.state === "active").length,
    carriedAssigned: entries.filter((entry) => entry.carried).length,
    timedCommitments: entries.filter((entry) => Boolean(entry.timeLabel)).length,
    workerReported: reportedEntries.length,
  };

  return {
    kind: "employee_work_journal_day",
    date: input.date,
    dateLabel: formatJournalDate(input.date, input.timeZone),
    timeZone: input.timeZone,
    institution: input.institution,
    entries,
    reportedEntries,
    shape: {
      ...shapeBase,
      summaryLine: buildSummaryLine(shapeBase, entries),
    },
  };
}
