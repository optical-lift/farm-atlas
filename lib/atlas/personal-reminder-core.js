function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : "";
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(value) ? value : "";
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

/**
 * @param {{ reminderId?: string, label?: string, note?: string, dueDate?: string | null, recordedAt?: string }} [input]
 */
export function buildPersonalReminderCapture({ reminderId, label, note = "", dueDate = null, recordedAt } = {}) {
  const id = validId(reminderId);
  const title = cleanText(label, 240);
  const detail = cleanText(note, 2000);
  const due = validDate(dueDate);
  const at = typeof recordedAt === "string" && !Number.isNaN(new Date(recordedAt).getTime()) ? recordedAt : "";

  if (!id) return { ok: false, error: "A valid reminder identity is required." };
  if (!title) return { ok: false, error: "Reminder text is required and must be 240 characters or fewer." };
  if (due === undefined) return { ok: false, error: "Reminder date must use YYYY-MM-DD." };
  if (!at) return { ok: false, error: "A valid capture time is required." };

  const subject = { domain: "personal", kind: "reminder", id };
  const value = { reminderId: id, label: title, note: detail || null, dueDate: due, state: "open" };
  return {
    ok: true,
    value: {
      sourceKey: `person-atlas:personal-reminder:${id}:create`,
      subject,
      evidence: {
        kind: "personal_reminder_intent",
        value,
        observedAt: at,
        provenance: { adapter: "person_atlas_v1", captureAuthority: "person" },
      },
      claim: {
        claimType: "personal_reminder",
        lifecycleState: "accepted",
        value,
        validFrom: at,
        metadata: {
          captureSurface: "person_atlas",
          privacy: "private",
          interpretationAuthority: "person",
        },
      },
    },
  };
}

/**
 * @param {{ reminderId?: string, currentClaimId?: string, currentValue?: Record<string, unknown> | null, completedAt?: string }} [input]
 */
export function buildPersonalReminderCompletionCapture({ reminderId, currentClaimId, currentValue, completedAt } = {}) {
  const id = validId(reminderId);
  const claimId = validUuid(currentClaimId);
  const at = typeof completedAt === "string" && !Number.isNaN(new Date(completedAt).getTime()) ? completedAt : "";
  const prior = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) ? currentValue : {};
  const label = cleanText(prior.label, 240);
  const note = cleanText(prior.note ?? "", 2000);
  const due = validDate(prior.dueDate ?? null);

  if (!id || !claimId || !label || !at || due === undefined) {
    return { ok: false, error: "The current reminder claim is not complete enough to record completion." };
  }

  const subject = { domain: "personal", kind: "reminder", id };
  const value = {
    reminderId: id,
    label,
    note: note || null,
    dueDate: due,
    state: "done",
    completedAt: at,
  };
  return {
    ok: true,
    value: {
      sourceKey: `person-atlas:personal-reminder:${id}:complete:${claimId}`,
      subject,
      evidence: {
        kind: "personal_reminder_completion_report",
        value,
        observedAt: at,
        provenance: { adapter: "person_atlas_v1", captureAuthority: "person" },
      },
      claim: {
        claimType: "personal_reminder",
        lifecycleState: "accepted",
        supersedesClaimId: claimId,
        value,
        validFrom: at,
        metadata: {
          captureSurface: "person_atlas",
          privacy: "private",
          interpretationAuthority: "person",
        },
      },
    },
  };
}
