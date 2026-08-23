revoke all on function atlas.record_production_establishment_v1(uuid,jsonb,text,date,date,text,text) from public,anon,authenticated;
revoke all on function atlas.configure_production_field_plan_v1(uuid,date,date,numeric,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function atlas.record_production_harvest_readiness_v1(uuid,text,jsonb,date,date,text,text) from public,anon,authenticated;
revoke all on function atlas.ensure_production_care_task_v1(uuid,text) from public,anon,authenticated;
revoke all on function atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text) from public,anon,authenticated;
revoke all on function atlas.refresh_production_harvest_gate_v1(uuid) from public,anon,authenticated;

grant execute on function atlas.record_production_establishment_v1(uuid,jsonb,text,date,date,text,text) to service_role;
grant execute on function atlas.configure_production_field_plan_v1(uuid,date,date,numeric,jsonb,text,text,text) to service_role;
grant execute on function atlas.record_production_harvest_readiness_v1(uuid,text,jsonb,date,date,text,text) to service_role;
grant execute on function atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text) to service_role;
grant execute on function atlas.refresh_production_harvest_gate_v1(uuid) to service_role;
grant execute on function atlas.ensure_production_care_task_v1(uuid,text) to service_role;

revoke all on table atlas.production_field_stands from public,anon,authenticated;
revoke all on table atlas.production_field_care_state from public,anon,authenticated;
revoke all on table atlas.production_field_observations from public,anon,authenticated;
revoke all on table atlas.production_care_policies from public,anon,authenticated;
revoke all on table atlas.production_harvest_rules from public,anon,authenticated;
revoke all on table atlas.production_harvest_gates from public,anon,authenticated;

grant select,insert,update,delete on table atlas.production_field_stands to service_role;
grant select,insert,update,delete on table atlas.production_field_care_state to service_role;
grant select,insert on table atlas.production_field_observations to service_role;
grant select,insert,update,delete on table atlas.production_care_policies to service_role;
grant select,insert,update,delete on table atlas.production_harvest_rules to service_role;
grant select,insert,update,delete on table atlas.production_harvest_gates to service_role;