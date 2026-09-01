function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * @param {"done" | "now" | "open" | "waiting"} value
 * @returns {"done" | "now" | "open" | "waiting"}
 */
function lineState(value) {
  return value;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isoDate(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function friendlyDate(value) {
  const dateIso = isoDate(value);
  if (!dateIso) return null;
  const date = new Date(`${dateIso}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}

function presentationLabel(opportunity) {
  const effective = record(opportunity.effectivePresentation);
  const base = record(opportunity.basePresentation);
  return text(effective.label) ?? text(base.label) ?? "Personal rhythm";
}

function firstCommittedMove(daySequence) {
  const sequence = record(daySequence);
  return list(sequence.items).find((candidate) => {
    const item = record(candidate);
    const status = text(item.status)?.toLowerCase() ?? "";
    return item.kind === "committed_task"
      && !["done", "completed", "archived", "skipped", "blocked"].includes(status);
  }) ?? null;
}

function companyLine(row, currentLegacyTaskId) {
  const workItemId = text(row.work_item_id) ?? text(row.workItemId) ?? text(row.allocation_id) ?? "unknown";
  const organization = text(row.organization_name) ?? text(row.organizationName) ?? "Company";
  const unit = text(row.organization_unit_name) ?? text(row.organizationUnitName);
  const executionState = text(row.execution_state) ?? text(row.executionState) ?? "unassessed";
  const executionReason = text(row.execution_reason) ?? text(row.executionReason);
  const legacyTaskId = text(row.legacy_task_id) ?? text(row.legacyTaskId);
  const due = friendlyDate(row.next_target_at ?? row.nextTargetAt ?? row.legacy_task_due_date ?? row.legacyTaskDueDate);
  const instructions = text(row.instructions);
  const isNow = Boolean(currentLegacyTaskId && legacyTaskId === currentLegacyTaskId);
  const waiting = executionState === "waiting" || executionState === "needs_resolution";
  const facts = [
    { label: "Jurisdiction", value: unit ? `${organization} · ${unit}` : organization },
    { label: "Authority", value: "Company Work responsibility allocation" },
    { label: "Responsibility", value: "Allocated to you" },
    { label: "Execution", value: executionState.replaceAll("_", " ") },
    { label: "Visibility", value: "Company responsibility" },
  ];
  if (due) facts.push({ label: "Next target", value: due });
  if (executionReason) facts.push({ label: "Why waiting", value: executionReason.replaceAll("_", " ") });

  return {
    id: `company:${workItemId}`,
    sentence: text(row.title) ?? "Company responsibility",
    state: lineState(isNow ? "now" : waiting ? "waiting" : "open"),
    worksheet: {
      kicker: organization.toUpperCase(),
      facts,
      note: instructions ?? "This remains your company responsibility even when Atlas has not released it into the current day.",
    },
    sourceHref: isNow && legacyTaskId ? "/day" : null,
    executionState,
  };
}

function personalReminderLine(claim) {
  const value = record(claim.value);
  const subject = record(claim.subject);
  const reminderId = text(value.reminderId) ?? text(subject.id) ?? text(claim.claimId) ?? "unknown";
  const label = text(value.label) ?? "Personal reminder";
  const due = friendlyDate(value.dueDate);
  const facts = [
    { label: "Jurisdiction", value: "Personal" },
    { label: "Authority", value: "Person-owned Claim" },
    { label: "Visibility", value: "Private" },
  ];
  if (due) facts.push({ label: "When", value: due });

  return {
    id: `personal:${reminderId}`,
    sentence: label,
    state: lineState("open"),
    worksheet: {
      kicker: "PERSONAL",
      facts,
      note: text(value.note) ?? "Private to you. This is not Company Work and does not create a Clock placement.",
    },
    sourceHref: `/atlas/reminders/${encodeURIComponent(reminderId)}`,
  };
}

function rhythmLine(opportunity, forDate) {
  const localDate = text(opportunity.localDate);
  const projectionState = text(opportunity.projectionState) ?? "projected";
  const state = lineState(projectionState === "satisfied" ? "done" : "open");
  const label = presentationLabel(opportunity);
  const time = text(opportunity.startsAt);
  const facts = [
    { label: "Jurisdiction", value: "Personal" },
    { label: "Authority", value: "Person-owned Rhythm opportunity" },
    { label: "Visibility", value: "Private" },
    { label: "State", value: projectionState },
  ];
  if (localDate) facts.push({ label: "Date", value: friendlyDate(localDate) ?? localDate });
  if (time) {
    const parsed = new Date(time);
    if (!Number.isNaN(parsed.getTime())) {
      facts.push({
        label: "Window starts",
        value: new Intl.DateTimeFormat("en-US", {
          timeZone: text(opportunity.timezone) ?? "America/Chicago",
          hour: "numeric",
          minute: "2-digit",
        }).format(parsed),
      });
    }
  }
  return {
    id: `rhythm:${text(opportunity.opportunityId) ?? `${label}:${localDate ?? forDate}`}`,
    sentence: label,
    state,
    worksheet: {
      kicker: "RHYTHM",
      facts,
      note: "A Rhythm opportunity is person-owned timing truth. It is not a company Task.",
    },
  };
}

export function buildPersonAtlasProjection({
  forDate,
  daySequence = null,
  companyResponsibilities = [],
  currentClaims = [],
  rhythmOpportunities = [],
} = {}) {
  const currentMove = firstCommittedMove(daySequence);
  const currentTaskId = text(record(currentMove).taskId);

  const companyLines = list(companyResponsibilities).map((value) => companyLine(record(value), currentTaskId));
  const currentCompanyLine = companyLines.find((line) => line.state === "now") ?? null;

  const personalLines = list(currentClaims)
    .map(record)
    .filter((claim) => claim.claimType === "personal_reminder")
    .filter((claim) => !["superseded", "expired", "rejected"].includes(text(claim.lifecycleState) ?? ""))
    .filter((claim) => {
      const state = text(record(claim.value).state) ?? "open";
      return !["done", "completed", "dismissed"].includes(state);
    })
    .map(personalReminderLine);

  const rhythmLines = list(rhythmOpportunities)
    .map(record)
    .filter((opportunity) => {
      const state = text(opportunity.projectionState);
      const date = text(opportunity.localDate);
      return state !== "withdrawn" && (!date || date >= forDate);
    })
    .map((opportunity) => rhythmLine(opportunity, forDate));

  let standaloneNow = null;
  if (currentMove && !currentCompanyLine) {
    const item = record(currentMove);
    standaloneNow = {
      id: `now:${text(item.id) ?? text(item.taskId) ?? "current"}`,
      sentence: text(item.title) ?? "Your next move",
      state: lineState("now"),
      worksheet: {
        kicker: "NOW",
        facts: [
          { label: "Authority", value: "Worker Day released execution" },
          { label: "Visibility", value: "Released into your day" },
        ],
        note: text(item.note) ?? "Atlas has released this bounded move into the current day.",
      },
      sourceHref: "/day",
    };
  }

  const readyCompany = companyLines.filter((line) => line.state !== "waiting");
  const waitingCompany = companyLines.filter((line) => line.state === "waiting");
  const sections = [];
  if (standaloneNow) sections.push({ label: "NOW", lines: [standaloneNow] });
  if (readyCompany.length) sections.push({ label: "COMPANY", lines: readyCompany });
  if (personalLines.length) sections.push({ label: "PERSONAL", lines: personalLines });
  if (rhythmLines.length) sections.push({ label: "RHYTHMS", lines: rhythmLines });
  if (waitingCompany.length) sections.push({ label: "WAITING", lines: waitingCompany });

  const sourceLinks = {};
  for (const line of sections.flatMap((section) => section.lines)) {
    if (line.sourceHref) sourceLinks[line.id] = line.sourceHref;
  }

  return {
    contractVersion: "person_atlas_projection_v1",
    forDate,
    sections: sections.map((section) => ({
      label: section.label,
      lines: section.lines.map(({ sourceHref: _sourceHref, executionState: _executionState, ...line }) => line),
    })),
    sourceLinks,
    counts: {
      company: companyLines.length,
      personal: personalLines.length,
      rhythms: rhythmLines.length,
      waitingCompany: waitingCompany.length,
    },
    truthBoundary: {
      companyResponsibilityNeverCapacityFiltered: true,
      workerDaySelectsCurrentExecution: true,
      personalClaimsRemainPrivate: true,
      rhythmsAreNotTasks: true,
    },
  };
}
