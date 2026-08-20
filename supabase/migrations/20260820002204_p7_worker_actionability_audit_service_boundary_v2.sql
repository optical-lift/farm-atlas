-- P7 correction: continuity audit must not bypass the authenticated Worker Day reader.
-- Audit the underlying placement + execution-warrant evidence instead.
do $p7_fix$
declare
  v_def text;
  v_start integer;
  v_finish integer;
  v_replacement text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='requirement_continuity_audit_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_as_of_date date';

  if v_def is null then raise exception 'requirement_continuity_audit_v1 definition not found'; end if;

  v_start:=strpos(v_def,'worker_card_packets as materialized (');
  v_finish:=strpos(v_def,'duplicate_acquisition_groups as materialized (');
  if v_start=0 or v_finish=0 or v_finish<=v_start then
    raise exception 'P7 worker audit CTE boundary not found';
  end if;

  v_replacement:=$replacement$worker_card_packets as materialized (
    select fm.id as membership_id,
           jsonb_build_object(
             'task_id',t.id,
             'title',t.title,
             'status',t.status,
             'placement_id',p.id,
             'service_date',p.service_date,
             'execution_readiness',atlas.task_execution_readiness_v1(t.id)
           ) as card
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    join atlas.farm_memberships fm
      on fm.id=p.membership_id and fm.farm_id=p.farm_id and fm.active=true and fm.role='farm_hand'
    where p.farm_id=p_farm_id and p.service_date=v_day and p.state='placed'
      and t.status='open'
      and t.assigned_membership_id=fm.id
      and coalesce(t.visibility_scope,'')<>'system_internal'
  ), $replacement$;

  v_def:=substr(v_def,1,v_start-1)||v_replacement||substr(v_def,v_finish);
  v_def:=replace(v_def,
    '-- 7. A rendered Worker Day operational card claims work while execution readiness says no action is available.',
    '-- 7. Worker Day carries an open farm-hand placement while execution readiness says no action is available.');
  v_def:=replace(v_def,
    '''meaning'', ''Worker Day rendered an operational card that is not executable for the assigned worker.''',
    '''meaning'', ''Worker Day contains an open farm-hand placement that cannot produce an available action; it must not surface as executable Work.''');
  execute v_def;
end
$p7_fix$;

comment on function atlas.requirement_continuity_audit_v1(uuid,date) is
'P7 Requirement → Truth Acquisition → Execution continuity auditor. Worker actionability is audited from service-safe placement + execution-warrant evidence rather than bypassing authenticated Worker Day readers.';
