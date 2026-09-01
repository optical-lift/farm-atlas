import { selectPersonLifeNotebook } from "./person-life-notebook-core.js";

export const FIVE_K_PERSON_LIFE_NOTEBOOK = Object.freeze({
  id: "five_k",
  sourcePrefix: "person-life-5k",
  sourceKeys: {
    requirement: "measurement-v1",
    rhythm: "rhythm-v1",
    policy: "right-knee-guardrail-v1",
    evidence: "run",
    condition: "knee",
  },
  goalMatch: {
    patterns: ["\\b5\\s*k\\b", "\\b5\\s*kilomet(?:er|re)s?\\b"],
    flags: "i",
  },
  empty: {
    title: "No active 5K Goal yet.",
    body: "Capture “I want to run a 5K” as a Goal first. Atlas will not manufacture the rest from that sentence.",
  },
  heading: {
    eyebrow: "5K NOTEBOOK",
    intro: "The Goal stays simple. Each extra authority below exists only after you accept it.",
  },
  requirement: {
    key: "complete_5k",
    stepLabel: "01 · measurement",
    statement: "5 km counts as completion.",
    explanation: "This is not inferred from the letters “5K.” It becomes a Goal requirement only when you accept the measurement.",
    acceptLabel: "Accept 5 km measurement",
    acceptedFeedback: "5 km is now an explicitly accepted measurement for this Goal.",
  },
  rhythm: {
    claimType: "goal_rhythm_plan",
    stepLabel: "02 · rhythm",
    statement: "Mon / Wed / Fri · 5:00 PM · 90 min.",
    explanation: "These are opportunity windows, not Tasks and not Principal Clock placements.",
    acceptLabel: "Accept this run rhythm",
    acceptedFeedback: "The Monday / Wednesday / Friday run rhythm is now explicitly accepted.",
    sectionTitle: "Upcoming runs",
    fallbackPresentationLabel: "5K training run",
    acceptedWindowNoun: "run window",
    defaults: {
      weekdays: [1, 3, 5],
      localStartTime: "17:00",
      windowMinutes: 90,
      fallbackTimezone: "America/Chicago",
    },
  },
  evidence: {
    claimType: "run_distance",
    progressReducer: "max_value",
    metricPath: ["distanceKm"],
    inputField: {
      primitive: "quantity",
      id: "distanceKm",
      label: "distance · km",
      unit: "km",
      displayUnit: "km",
      step: 0.01,
      minimum: 0.01,
      startUnset: true,
    },
    targetValue: 5,
    unit: "km",
    progressFractionDigits: 2,
    progressHeading: "5K PROGRESS",
    emptyMetricLabel: "no run distance yet",
    timeInputLabel: "when you ran",
    logLabel: "Log this run",
    invalidDraftMessage: "Enter the distance and the time you actually ran before logging this run.",
    recordedFeedback: "Run Evidence recorded; the same Evidence updated Rhythm satisfaction and reevaluated the Goal.",
    provenanceLabel: "run Evidence",
  },
  policy: {
    effectKind: "rhythm_opportunity_presentation_overlay",
    targetKind: "goal_requirement_next_opportunity",
    stepLabel: "03 · response policy",
    statement: "If I report right-knee aching after mile 2, make the next run recovery-paced.",
    explanation: "The observation never invents this rule. The exact presentation-only response is separately person-authorized.",
    acceptLabel: "Accept this knee response",
    acceptedFeedback: "The knee-response policy is now separately accepted.",
    sectionTitle: "Knee observation flow",
    condition: {
      subjectDomain: "body",
      subjectKind: "body_region",
      subjectId: "right_knee",
      conditionState: "aching_after_mile_2",
      displayLabel: "right knee · aching after mile 2",
      emptyLabel: "No matching right-knee observation is currently recorded.",
      recordLabel: "Record: right knee aching after mile 2",
    },
    observationOnlyCopy: "Without an accepted response policy, this remains observation only.",
    authorizedCopy: "Because the response policy is already accepted, Atlas may evaluate this Evidence against that exact rule and adapt only the next projected run if it matches.",
    observationOnlyFeedback: "The knee observation was recorded without creating a response rule.",
    authorizedFeedback: "The knee observation was recorded. Atlas evaluated only the already-accepted response policy.",
  },
  api: {
    acceptRequirementAction: "accept_five_k_measurement",
    acceptRhythmAction: "accept_five_k_rhythm",
    acceptPolicyAction: "accept_five_k_guardrail",
    recordEvidenceAction: "record_five_k_run",
    recordConditionAction: "record_five_k_knee_observation",
  },
});

export const PERSON_LIFE_NOTEBOOK_CATALOG = Object.freeze([
  FIVE_K_PERSON_LIFE_NOTEBOOK,
]);

export function selectCatalogPersonLifeNotebook(state) {
  return selectPersonLifeNotebook(PERSON_LIFE_NOTEBOOK_CATALOG, state);
}
