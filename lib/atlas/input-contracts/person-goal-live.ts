import type { AtlasInputContract } from "@/lib/atlas/input-contract";

export const PERSON_GOAL_INPUT_CONTRACT: AtlasInputContract = {
  id: "person-goal-v1",
  kind: "personal goal",
  title: "What do you want to make true?",
  detail: "Atlas records the end you named. It does not invent the plan, rhythm, task, or Clock placement.",
  source: {
    domain: "journal",
    jurisdiction: "person",
    objectRef: "person-goal-capture",
  },
  fields: [
    {
      primitive: "text",
      id: "goal_text",
      label: "Goal",
      placeholder: "I want to run a 5K.",
      multiline: true,
      rows: 5,
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "goal_text",
      message: "Record the goal you are actually choosing.",
    },
  ],
  resultEventType: "person_goal_reported",
  persistence: "canonical",
  sourceContext: {
    scopeKind: "person",
    authority: "person",
    planAuthorityGranted: false,
    taskAuthorityGranted: false,
    clockAuthorityGranted: false,
  },
};
