import type { AtlasInputContract } from "@/lib/atlas/input-contract";

export const PERSON_BODY_OBSERVATION_INPUT_CONTRACT: AtlasInputContract = {
  id: "person-body-observation-v1",
  kind: "body observation",
  title: "What did you notice?",
  detail: "Record the body region and the observation itself. Cause, diagnosis, consequence, treatment, and scheduling remain unestablished.",
  source: {
    domain: "journal",
    jurisdiction: "person",
    objectRef: "person-body-observation-capture",
  },
  fields: [
    {
      primitive: "text",
      id: "body_region",
      label: "Where did you notice it?",
      placeholder: "left hip",
    },
    {
      primitive: "text",
      id: "observation",
      label: "What did you notice?",
      placeholder: "felt tight afterward",
      multiline: true,
      rows: 5,
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "body_region",
      message: "Record where you noticed it.",
    },
    {
      kind: "required_field",
      fieldId: "observation",
      message: "Record what you actually noticed.",
    },
  ],
  resultEventType: "person_condition_observation_reported",
  persistence: "canonical",
  sourceContext: {
    scopeKind: "person",
    authority: "person_reported_observation",
    causeEstablished: false,
    diagnosisEstablished: false,
    actionEstablished: false,
    clockAuthorityGranted: false,
  },
};
