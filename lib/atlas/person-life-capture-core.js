function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function atlasCaptureToken(value, fallback = "unknown") {
  const token = cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return token || fallback;
}

export function buildPersonGoalCapture({ ownerUserId, sourceKey, text }) {
  const owner = cleanText(ownerUserId);
  const key = cleanText(sourceKey);
  const goal = cleanText(text);

  if (!owner || !key || !goal) {
    return { ok: false, error: "A signed-in person, source key, and explicit goal are required." };
  }

  return {
    ok: true,
    value: {
      sourceKey: key,
      signal: {
        contractVersion: "atlas_life_signal_v1",
        scope: { kind: "person", id: owner },
        subject: { domain: "personal", kind: "goal", id: key },
        signalKind: "goal",
        state: {
          explicitUserEnd: goal,
          authorizationState: "self_selected",
          rawLanguage: goal,
        },
        timing: {},
        requirements: [],
        constraints: [],
        ambiguities: [],
        relations: [],
        source: { domain: "journal", kind: "person_goal_capture", id: key },
        epistemic: { factClass: "explicit_goal", interpretationAuthority: "person" },
      },
    },
  };
}

export function buildPersonConditionObservationCapture({
  sourceKey,
  bodyRegion,
  observation,
  observedAt,
}) {
  const key = cleanText(sourceKey);
  const rawRegion = cleanText(bodyRegion);
  const rawObservation = cleanText(observation);
  const at = cleanText(observedAt);

  if (!key || !rawRegion || !rawObservation) {
    return { ok: false, error: "A source key, body region, and observation are required." };
  }

  return {
    ok: true,
    value: {
      subjectDomain: "body",
      subjectKind: "body_region",
      subjectId: atlasCaptureToken(rawRegion, "body_region"),
      conditionState: atlasCaptureToken(rawObservation, "reported_observation"),
      sourceKey: key,
      ...(at ? { observedAt: at } : {}),
      note: rawObservation,
      metadata: {
        rawBodyRegion: rawRegion,
        rawObservation,
        causeEstablished: false,
        diagnosisEstablished: false,
        captureAuthority: "person_reported_observation",
      },
    },
  };
}

export function normalizePersonLifeCaptureInput(body, ownerUserId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Capture payload must be an object." };
  }

  if (body.action === "goal") {
    return buildPersonGoalCapture({
      ownerUserId,
      sourceKey: body.sourceKey,
      text: body.text,
    });
  }

  if (body.action === "condition_observation") {
    return buildPersonConditionObservationCapture({
      sourceKey: body.sourceKey,
      bodyRegion: body.bodyRegion,
      observation: body.observation,
      observedAt: body.observedAt ?? body.recordedAt,
    });
  }

  return { ok: false, error: "Choose an explicit person-life capture type." };
}
