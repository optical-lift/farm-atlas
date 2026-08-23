revoke all on function atlas.create_field_stand_from_transplant_v1() from public,anon,authenticated;
revoke all on function atlas.validate_production_field_stand_v1() from public,anon,authenticated;
revoke all on function atlas.validate_production_field_observation_v1() from public,anon,authenticated;
revoke all on function atlas.validate_production_field_care_state_v1() from public,anon,authenticated;

grant execute on function atlas.create_field_stand_from_transplant_v1() to service_role;

revoke update,delete,truncate on table atlas.production_field_observations from service_role;
grant select,insert on table atlas.production_field_observations to service_role;

alter function atlas.validate_production_field_stand_v1() set search_path=pg_catalog,atlas;
alter function atlas.validate_production_field_observation_v1() set search_path=pg_catalog,atlas;
alter function atlas.validate_production_field_care_state_v1() set search_path=pg_catalog,atlas;