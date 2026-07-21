create or replace view atlas.v_transition_integrity
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  (select count(*)
     from atlas.growing_objects go
    where go.farm_id = f.id
      and not exists (
        select 1 from atlas.object_state os where os.object_id = go.id
      )) as objects_without_state,
  (select count(*)
     from atlas.planting_claims pc
    where pc.farm_id = f.id
      and pc.status <> 'archived'
      and not exists (
        select 1
        from atlas.planting_claim_objects pco
        where pco.planting_claim_id = pc.id
      )) as planting_claims_without_object_link,
  (select count(*)
     from atlas.tasks t
    where t.farm_id = f.id
      and t.status in ('open', 'blocked')
      and t.visibility_scope = 'assigned_worker'
      and t.assigned_membership_id is null) as assigned_worker_tasks_without_membership,
  (select count(*)
     from atlas.identity_review_queue rq
    where rq.farm_id = f.id
      and rq.status = 'open') as open_identity_reviews,
  (
    (case when has_table_privilege('anon', 'atlas.production_plans', 'INSERT') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.production_plans', 'UPDATE') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.production_plans', 'DELETE') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.production_successions', 'INSERT') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.production_successions', 'UPDATE') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.production_successions', 'DELETE') then 1 else 0 end)
  ) as anonymous_production_write_grants,
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')) as anonymous_definer_functions,
  (
    (case when has_table_privilege('anon', 'atlas.v_dashboard_zones', 'SELECT') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.v_project_cards', 'SELECT') then 1 else 0 end) +
    (case when has_table_privilege('anon', 'atlas.v_resource_summary', 'SELECT') then 1 else 0 end)
  ) as anonymous_legacy_view_reads
from atlas.farms f;

revoke all privileges on table atlas.v_transition_integrity from anon, authenticated;
grant select on table atlas.v_transition_integrity to service_role;
