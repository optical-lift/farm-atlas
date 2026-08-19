import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packets = readFileSync(
  "supabase/migrations/20260818152501_bell_repair_packet_contract_v1.sql",
  "utf8",
);
const sync = readFileSync(
  "supabase/migrations/20260818152954_bell_repair_obligation_sync_and_render_v1.sql",
  "utf8",
);

test("Phase 13 translates divergence into function-owned repair custody instead of worker blame", () => {
  assert.match(packets, /bell_repair_packets_v1/i);
  assert.match(packets, /owningFunction/i);
  assert.match(packets, /recipientFunction/i);
  assert.match(packets, /workerResponsibility/i);
  assert.match(packets, /not_assigned_by_divergence/i);
  assert.match(packets, /A divergence does not establish worker causation/i);
  assert.match(packets, /alertIsRepairRoutingNotBlame',true/i);
  assert.match(packets, /repairOwnerIsFunctionNotPerson',true/i);
  assert.match(packets, /principalEscalationNotCreated',true/i);
});

test("Bell repair packets preserve differentiated repair domains", () => {
  assert.match(packets, /resolve_destination_claim/i);
  assert.match(packets, /resolve_worker_weekly_capacity_conflict/i);
  assert.match(packets, /reconcile_result_to_next_state/i);
  assert.match(packets, /establish_seed_inventory_warrant/i);
  assert.match(packets, /restore_propagation_continuity/i);
  assert.match(packets, /resolve_lawful_next_state/i);
});

test("capacity remains a management repair condition before Principal", () => {
  assert.match(packets, /managementConflictDoesNotCreatePrincipalWorkByItself',true/i);
  assert.match(packets, /estimateIsCapacityClaimNotLaborActual',true/i);
  assert.match(packets, /optionalWorkDisplacedBeforeRequiredWorkDeclaredImpossible',true/i);
  assert.match(packets, /workerBlameNotInferred',true/i);
  assert.match(packets, /principalEscalationNotCreated',true/i);
});

test("one stable repair obligation evolves instead of producing daily Bell noise", () => {
  assert.match(sync, /reality_repair:'\|\|coalesce\(v_packet->>'repairKey'/i);
  assert.match(sync, /v_existing\.fingerprint=coalesce\(v_packet->>'fingerprint'/i);
  assert.match(sync, /v_unchanged:=v_unchanged\+1/i);
  assert.match(sync, /unchangedRepairDoesNotCreateNewBellNoise',true/i);
  assert.match(sync, /materialChangeMayReopenUnreadAttention',true/i);
  assert.match(sync, /resolvedDivergenceLeavesCurrentAttention',true/i);
});

test("materially changed repair truth reopens unread attention and resolved truth leaves current action", () => {
  assert.match(sync, /set read_at=null,acknowledged_at=null/i);
  assert.match(sync, /source_event='repair_resolved'/i);
  assert.match(sync, /importance='normal'/i);
  assert.match(sync, /repairState','resolved'/i);
  assert.match(sync, /source_event='repair_required'/i);
});

test("Bell predicates treat open reality repairs as actionable management attention", () => {
  assert.match(sync, /when event\.source_kind='reality_repair' then event\.source_event='repair_required'/i);
  assert.match(sync, /'repair:'\|\|coalesce\(nullif\(event\.payload->>'repairKey'/i);
  assert.match(sync, /humanActionRequired/i);
  assert.match(sync, /This identifies the function responsible for repair; it does not establish worker fault/i);
  assert.match(sync, /when item\.source_kind = 'reality_repair' then '!'/i);
});

test("repair sync is service-only and does not create Principal work", () => {
  assert.match(sync, /revoke all on function atlas\.sync_bell_repair_events_v1\(uuid,date\) from public,anon,authenticated/i);
  assert.match(sync, /grant execute on function atlas\.sync_bell_repair_events_v1\(uuid,date\) to service_role/i);
  assert.match(sync, /syncDoesNotAssignWorkerBlame',true/i);
  assert.match(sync, /syncDoesNotCreatePrincipalWork',true/i);
});
