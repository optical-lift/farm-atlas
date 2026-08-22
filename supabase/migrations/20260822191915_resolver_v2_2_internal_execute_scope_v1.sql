revoke all on function local_intel.refresh_source_class_assignments_v2() from public;
revoke all on function local_intel.refresh_source_class_assignments_v2() from anon;
revoke all on function local_intel.refresh_source_class_assignments_v2() from authenticated;

revoke all on function local_intel.block_source_class_assignment_history_mutation_v1() from public;
revoke all on function local_intel.block_source_class_assignment_history_mutation_v1() from anon;
revoke all on function local_intel.block_source_class_assignment_history_mutation_v1() from authenticated;

revoke all on function local_intel.refresh_entity_resolution_v2_2_review_recommendations() from public;
revoke all on function local_intel.refresh_entity_resolution_v2_2_review_recommendations() from anon;
revoke all on function local_intel.refresh_entity_resolution_v2_2_review_recommendations() from authenticated;

revoke all on table local_intel.source_class_assignment_history from public, anon, authenticated;
revoke all on table local_intel.v_research_source_inventory_governed_v2 from public, anon, authenticated;
revoke all on table local_intel.v_entity_ingestion_identity_review_candidates_v2 from public, anon, authenticated;
revoke all on table local_intel.v_entity_resolution_resolver_v2_2_live_pair_recommendations from public, anon, authenticated;

grant execute on function local_intel.refresh_source_class_assignments_v2() to service_role;
grant execute on function local_intel.block_source_class_assignment_history_mutation_v1() to service_role;
grant execute on function local_intel.refresh_entity_resolution_v2_2_review_recommendations() to service_role;

grant select, insert on table local_intel.source_class_assignment_history to service_role;
grant select on table local_intel.v_research_source_inventory_governed_v2 to service_role;
grant select on table local_intel.v_entity_ingestion_identity_review_candidates_v2 to service_role;
grant select on table local_intel.v_entity_resolution_resolver_v2_2_live_pair_recommendations to service_role;