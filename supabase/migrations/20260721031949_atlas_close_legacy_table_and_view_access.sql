drop policy if exists "atlas production plans readable" on atlas.production_plans;
drop policy if exists "atlas production plans writable" on atlas.production_plans;
drop policy if exists "atlas production successions readable" on atlas.production_successions;
drop policy if exists "atlas production successions writable" on atlas.production_successions;

revoke all privileges on table atlas.production_plans from anon;
revoke all privileges on table atlas.production_successions from anon;
revoke insert, update, delete, truncate, references, trigger
  on table atlas.production_plans from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table atlas.production_successions from authenticated;
grant select on table atlas.production_plans to authenticated;
grant select on table atlas.production_successions to authenticated;
grant all privileges on table atlas.production_plans to service_role;
grant all privileges on table atlas.production_successions to service_role;

alter view atlas.v_dashboard_zones set (security_invoker = true);
alter view atlas.v_project_cards set (security_invoker = true);
alter view atlas.v_resource_summary set (security_invoker = true);

revoke all privileges on table atlas.v_dashboard_zones from anon, authenticated;
revoke all privileges on table atlas.v_project_cards from anon, authenticated;
revoke all privileges on table atlas.v_resource_summary from anon, authenticated;
grant select on table atlas.v_dashboard_zones to service_role;
grant select on table atlas.v_project_cards to service_role;
grant select on table atlas.v_resource_summary to service_role;
