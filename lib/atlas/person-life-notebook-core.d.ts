export type PersonLifeNotebookSubject = { domain?: string; kind?: string; id?: string };

export type PersonLifeNotebookSpec = {
  id: string;
  sourcePrefix: string;
  goalMatch: { patterns: string[]; flags?: string };
  empty: { title: string; body: string };
  heading: { eyebrow: string; intro: string };
  requirement: {
    key: string;
    stepLabel: string;
    statement: string;
    explanation: string;
    acceptLabel: string;
    acceptedFeedback: string;
  };
  rhythm: {
    claimType?: string;
    stepLabel: string;
    statement: string;
    explanation: string;
    acceptLabel: string;
    acceptedFeedback: string;
    sectionTitle: string;
    fallbackPresentationLabel: string;
    acceptedWindowNoun: string;
    defaults: {
      weekdays: number[];
      localStartTime: string;
      windowMinutes: number;
      fallbackTimezone: string;
    };
  };
  evidence: {
    claimType: string;
    metricPath: string[];
    requestValueKey: string;
    targetValue: number;
    unit: string;
    progressHeading: string;
    emptyMetricLabel: string;
    inputLabel: string;
    timeInputLabel: string;
    logLabel: string;
    invalidDraftMessage: string;
    recordedFeedback: string;
    provenanceLabel: string;
  };
  policy: {
    effectKind: string;
    targetKind: string;
    stepLabel: string;
    statement: string;
    explanation: string;
    acceptLabel: string;
    acceptedFeedback: string;
    sectionTitle: string;
    condition: {
      subjectDomain: string;
      subjectKind: string;
      subjectId: string;
      conditionState: string;
      displayLabel: string;
      emptyLabel: string;
      recordLabel: string;
    };
    observationOnlyCopy: string;
    authorizedCopy: string;
    observationOnlyFeedback: string;
    authorizedFeedback: string;
  };
  api: {
    acceptRequirementAction: string;
    acceptRhythmAction: string;
    acceptPolicyAction: string;
    recordEvidenceAction: string;
    recordConditionAction: string;
  };
};

export type PersonLifeNotebookModel = {
  specId: string;
  goal: any | null;
  requirementAccepted: boolean;
  evidenceSubject: PersonLifeNotebookSubject | null;
  policyAccepted: boolean;
  acceptedPlanClaims: any[];
  rhythmAccepted: boolean;
  opportunities: any[];
  evidenceClaims: any[];
  bestMetric: number;
  progressPercent: number;
  satisfiedCount: number;
  matchingCondition: any | null;
};

export function matchesPersonLifeNotebookGoal(definition: any, spec: PersonLifeNotebookSpec): boolean;
export function notebookPolicyMatchesGoal(definition: any, goalDefinitionId: string, spec: PersonLifeNotebookSpec): boolean;
export function projectPersonLifeNotebook(spec: PersonLifeNotebookSpec, state: Record<string, unknown>): PersonLifeNotebookModel;
export function selectPersonLifeNotebook(specs: readonly PersonLifeNotebookSpec[], state: Record<string, unknown>): { spec: PersonLifeNotebookSpec; model: PersonLifeNotebookModel } | null;
