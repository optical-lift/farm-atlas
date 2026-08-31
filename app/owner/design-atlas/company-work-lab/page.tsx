import CompanyWorkNotebook from "../CompanyWorkNotebook";
import {
  summarizeCompanyWork,
  type CompanyWorkRow,
} from "@/lib/atlas/company-work";

const ORG = "52afd94a-25e8-4532-a3c6-6aeeb2654297";
const MARSHALL = "fixture-membership-marshall";
const ANNA = "fixture-membership-anna";
const KATIE = "fixture-membership-katie";

const ROWS: CompanyWorkRow[] = [
  {
    organization_id: ORG,
    work_item_id: "fixture-work-cut-lumber",
    title: "Cut replacement lumber for the raised bed repair",
    instructions: "Prepare the material required before the repair can become executable.",
    work_state: "open",
    operation_class: "physical_preparation",
    jurisdiction_key: "elm.main_garden",
    source_object_type: "requirement",
    source_object_id: null,
    created_at: "2026-08-30T18:00:00-05:00",
    updated_at: "2026-08-30T18:00:00-05:00",
    responsible_allocation_id: "fixture-allocation-marshall",
    assignee_membership_id: MARSHALL,
    allocated_at: "2026-08-30T18:05:00-05:00",
    time_contract_id: "fixture-time-contract-cut-lumber",
    earliest_lawful_at: null,
    preferred_start_at: null,
    preferred_end_at: null,
    latest_lawful_at: null,
    hard_finish_at: null,
    expected_duration_minutes: 45,
    movement_policy: "movable",
    unresolved_dependency_count: 0,
    open_planning_conflict_id: null,
    open_planning_conflict_kind: null,
    open_planning_conflict_reason: null,
    conflict_required_by: null,
    management_position: "allocated",
  },
  {
    organization_id: ORG,
    work_item_id: "fixture-work-repair-bed",
    title: "Repair the raised bed",
    instructions: "Restore the bed so the planting destination can be prepared.",
    work_state: "open",
    operation_class: "repair",
    jurisdiction_key: "elm.main_garden",
    source_object_type: "requirement",
    source_object_id: null,
    created_at: "2026-08-30T18:02:00-05:00",
    updated_at: "2026-08-30T18:02:00-05:00",
    responsible_allocation_id: "fixture-allocation-anna",
    assignee_membership_id: ANNA,
    allocated_at: "2026-08-30T18:06:00-05:00",
    time_contract_id: "fixture-time-contract-repair-bed",
    earliest_lawful_at: null,
    preferred_start_at: null,
    preferred_end_at: null,
    latest_lawful_at: null,
    hard_finish_at: null,
    expected_duration_minutes: 60,
    movement_policy: "movable",
    unresolved_dependency_count: 1,
    open_planning_conflict_id: null,
    open_planning_conflict_kind: null,
    open_planning_conflict_reason: null,
    conflict_required_by: null,
    management_position: "waiting_dependency",
  },
  {
    organization_id: ORG,
    work_item_id: "fixture-work-prepare-destination",
    title: "Prepare the planting destination",
    instructions: null,
    work_state: "open",
    operation_class: "bed_preparation",
    jurisdiction_key: "elm.main_garden",
    source_object_type: "requirement",
    source_object_id: null,
    created_at: "2026-08-30T18:03:00-05:00",
    updated_at: "2026-08-30T18:03:00-05:00",
    responsible_allocation_id: null,
    assignee_membership_id: null,
    allocated_at: null,
    time_contract_id: "fixture-time-contract-prepare-destination",
    earliest_lawful_at: null,
    preferred_start_at: null,
    preferred_end_at: null,
    latest_lawful_at: null,
    hard_finish_at: null,
    expected_duration_minutes: 40,
    movement_policy: "movable",
    unresolved_dependency_count: 0,
    open_planning_conflict_id: null,
    open_planning_conflict_kind: null,
    open_planning_conflict_reason: null,
    conflict_required_by: null,
    management_position: "unassigned",
  },
  {
    organization_id: ORG,
    work_item_id: "fixture-work-springfield-delivery",
    title: "Deliver the Springfield flower orders",
    instructions: "Fulfill the committed route before the customer boundary.",
    work_state: "open",
    operation_class: "delivery",
    jurisdiction_key: "feast.springfield_distribution",
    source_object_type: "customer_commitment",
    source_object_id: null,
    created_at: "2026-08-30T18:04:00-05:00",
    updated_at: "2026-08-30T18:04:00-05:00",
    responsible_allocation_id: "fixture-allocation-katie",
    assignee_membership_id: KATIE,
    allocated_at: "2026-08-30T18:07:00-05:00",
    time_contract_id: "fixture-time-contract-delivery",
    earliest_lawful_at: "2026-09-04T08:00:00-05:00",
    preferred_start_at: "2026-09-04T09:00:00-05:00",
    preferred_end_at: "2026-09-04T12:00:00-05:00",
    latest_lawful_at: "2026-09-04T13:00:00-05:00",
    hard_finish_at: "2026-09-04T13:00:00-05:00",
    expected_duration_minutes: 240,
    movement_policy: "bounded",
    unresolved_dependency_count: 0,
    open_planning_conflict_id: "fixture-conflict-delivery",
    open_planning_conflict_kind: "hard_boundary_unfit",
    open_planning_conflict_reason: "Only 180 minutes of lawful capacity remain before a 240-minute delivery obligation reaches its hard boundary.",
    conflict_required_by: "2026-09-04T13:00:00-05:00",
    management_position: "planning_conflict",
  },
];

const MEMBERSHIP_LABELS = {
  [MARSHALL]: "Marshall",
  [ANNA]: "Anna",
  [KATIE]: "Katie",
};

export default function CompanyWorkLabPage() {
  return (
    <CompanyWorkNotebook
      organizationName="Elm Farm"
      rows={ROWS}
      summary={summarizeCompanyWork(ROWS)}
      membershipLabels={MEMBERSHIP_LABELS}
      fixtureLabel="Design Atlas fixture only — this page does not read or write live Company Work."
    />
  );
}
