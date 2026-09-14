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

function buildSummaryLine(shape: Omit<EmployeeWorkJournalDayShape, "summaryLine">) {
  const remaining = `${shape.remainingAssigned} ${shape.remainingAssigned === 1 ? "entry" : "entries"} remaining`;
  const timed = shape.timedCommitments
    ? `${shape.timedCommitments} timed ${shape.timedCommitments === 1 ? "commitment" : "commitments"}`
    : null;
  const active = shape.activeAssigned ? `${shape.activeAssigned} in progress` : null;

  return [remaining, timed, active].filter(Boolean).join(" · ");
}

export function buildEmployeeWorkJournalDay(
  input: BuildEmployeeWorkJournalDayInput,
): EmployeeWorkJournalDay {
  const entries: EmployeeWorkJournalEntry[] = input.items.map((item) => ({
    id: item.id,
    key: item.key,
    title: item.title,
    guidance: [...new Set(item.details ?? [])],
    state: journalEntryState(item),
    plannedDate: item.plannedDate,
    originalPlannedDate: item.originalPlannedDate,
    carried: item.carried,
    timeLabel: item.timeLabel ?? null,
    completion: {
      institutionallyComplete: item.institutionallyCompleted,
      workerReportedComplete: item.reportedCompleted,
      resultContractKey: item.resultContractKey,
      acceptanceMode: item.acceptanceMode,
    },
    source: {
      kind: "institutional_work_delivery",
      id: item.id,
    },
  }));

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

  const isExecutionComplete = (entry: EmployeeWorkJournalEntry) =>
    entry.state === "complete" || entry.state === "reported_complete";

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
      summaryLine: buildSummaryLine(shapeBase),
    },
  };
}
