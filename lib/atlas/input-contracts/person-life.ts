import type { AtlasInputContract } from "@/lib/atlas/input-contract";

export const PERSON_GOAL_INPUT_CONTRACT: AtlasInputContract = {
  id: "atlas.person.goal.capture.v1",
  kind: "personal atlas",
  title: "Goal",
  detail: "Record the end you want to make true. Atlas will not invent the plan.",
  source: {
    domain: "journal",
    jurisdiction: "person-private",
    objectRef: "person:goal",
    claimRef: "explicit-person-goal",
  },
  fields: [
    {
      primitive: "text",
      id: "goal",
      label: "what do you want to make true?",
      placeholder: "I want to run a 5K.",
      multiline: true,
      rows: 4,
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "goal",
      message: "Record the goal you are choosing.",
    },
  ],
  resultEventType: "atlas.person.goal.capture.result.v1",
  persistence: "canonical",
  sourceContext: {
    authority: "person",
    createsRequirements: false,
    createsRhythm: false,
    createsClockPlacement: false,
  },
};

export const PERSON_BODY_OBSERVATION_INPUT_CONTRACT: AtlasInputContract = {
  id: "atlas.person.body-observation.capture.v1",
  kind: "personal atlas",
  title: "Body observation",
  detail: "Record what you noticed. Cause, diagnosis, treatment, and action stay unresolved unless separately established.",
  source: {
    domain: "body",
    jurisdiction: "person-private",
    objectRef: "person:body-observation",
    claimRef: "first-party-condition-observation",
  },
  fields: [
    {
      primitive: "text",
      id: "bodyRegion",
      label: "where did you notice it?",
      placeholder: "left hip",
    },
    {
      primitive: "text",
      id: "observation",
      label: "what did you notice?",
      placeholder: "felt tight afterward",
      multiline: true,
      rows: 4,
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "bodyRegion",
      message: "Record where you noticed the condition.",
    },
    {
      kind: "required_field",
      fieldId: "observation",
      message: "Record what you noticed.",
    },
  ],
  resultEventType: "atlas.person.body-observation.capture.result.v1",
  persistence: "canonical",
  sourceContext: {
    authority: "person_reported_observation",
    causeEstablished: false,
    diagnosisEstablished: false,
    createsClockPlacement: false,
  },
};
