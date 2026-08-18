create or replace function atlas.worker_weekly_capacity_management_state_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_week_start date;
  v_week_end date;
  v_conflict jsonb;
  v_occ atlas.planned_work_occurrences%rowtype;
  v_task atlas.tasks%rowtype;
  v_meta jsonb:='{}'::jsonb;
begin
  v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_conflict->>'weekStart')::date;
  v_week_end:=(v_conflict->>'weekEnd')::date;

  select * into v_occ
  from atlas.planned_work_occurrences pwo
  where pwo.farm_id=p_farm_id
    and pwo.source_kind='worker_weekly_capacity_management'
    and pwo.source_id=p_membership_id
    and pwo.occurrence_key='worker-weekly-capacity:'||p_membership_id::text||':'||v_week_start::text
    and pwo.state in ('planned','eligible','releasing','released')
  order by pwo.created_at desc limit 1;
  if v_occ.id is not null then
    v_meta:=coalesce(v_occ.task_payload#>'{metadata}','{}'::jsonb)||coalesce(v_occ.metadata,'{}'::jsonb);
    return jsonb_build_object(
      'contractVersion','worker_weekly_capacity_management_state_v1',
      'farmId',p_farm_id,'membershipId',p_membership_id,'weekStart',v_week_start,'weekEnd',v_week_end,
      'pathExists',true,'pathKind','planned_work_occurrence','occurrenceId',v_occ.id,'pathState',v_occ.state,
      'ownershipConsequenceUnresolved',coalesce((v_meta->>'ownership_consequence_unresolved')::boolean,false),
      'ownerDecisionRequired',v_meta->>'owner_decision_required','consequence',v_meta->>'ownership_consequence',
      'managementNote',v_meta->>'management_note','metadata',v_meta
    );
  end if;

  select * into v_task
  from atlas.tasks t
  where t.farm_id=p_farm_id and t.generated_from='worker_weekly_capacity_management'
    and t.generated_from_id=p_membership_id and t.status in ('open','blocked')
    and t.metadata->>'week_start'=v_week_start::text
  order by t.created_at desc limit 1;
  if v_task.id is not null then
    v_meta:=coalesce(v_task.metadata,'{}'::jsonb);
    return jsonb_build_object(
      'contractVersion','worker_weekly_capacity_management_state_v1',
      'farmId',p_farm_id,'membershipId',p_membership_id,'weekStart',v_week_start,'weekEnd',v_week_end,
      'pathExists',true,'pathKind','management_task','taskId',v_task.id,'pathState',v_task.status,
      'ownershipConsequenceUnresolved',coalesce((v_meta->>'ownership_consequence_unresolved')::boolean,false),
      'ownerDecisionRequired',v_meta->>'owner_decision_required','consequence',v_meta->>'ownership_consequence',
      'managementNote',v_meta->>'management_note','metadata',v_meta
    );
  end if;

  return jsonb_build_object(
    'contractVersion','worker_weekly_capacity_management_state_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'weekStart',v_week_start,'weekEnd',v_week_end,
    'pathExists',false,'ownershipConsequenceUnresolved',false
  );
end;
$$;
revoke all on function atlas.worker_weekly_capacity_management_state_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_capacity_management_state_v1(uuid,uuid,date) to service_role;

create or replace function atlas.ensure_worker_weekly_capacity_management_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_conflict jsonb;
  v_state text;
  v_week_start date;
  v_week_end date;
  v_timezone text:='UTC';
  v_today date;
  v_due date;
  v_path jsonb;
  v_task atlas.tasks%rowtype;
begin
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='P0002';
  end if;
  select coalesce(nullif(f.metadata->>'timezone',''),'UTC') into v_timezone from atlas.farms f where f.id=p_farm_id;
  v_today:=(now() at time zone v_timezone)::date;
  v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,p_anchor_day);
  v_state:=v_conflict->>'state';
  v_week_start:=(v_conflict->>'weekStart')::date;
  v_week_end:=(v_conflict->>'weekEnd')::date;

  if v_state='feasible' then
    update atlas.tasks t set status='archived',updated_at=now(),
      metadata=t.metadata||jsonb_build_object('management_case_state','closed','closed_reason','capacity_feasible','closed_at',now())
    where t.farm_id=p_farm_id and t.generated_from='worker_weekly_capacity_management'
      and t.generated_from_id=p_membership_id and t.status in ('open','blocked') and t.metadata->>'week_start'=v_week_start::text;
    update atlas.planned_work_occurrences pwo set state='cancelled',updated_at=now(),
      metadata=pwo.metadata||jsonb_build_object('management_case_state','closed','closed_reason','capacity_feasible','closed_at',now())
    where pwo.farm_id=p_farm_id and pwo.source_kind='worker_weekly_capacity_management' and pwo.source_id=p_membership_id
      and pwo.occurrence_key='worker-weekly-capacity:'||p_membership_id::text||':'||v_week_start::text
      and pwo.state in ('planned','eligible','releasing','released');
    return jsonb_build_object('contractVersion','worker_weekly_capacity_management_sync_v1','state','contained_feasible','conflict',v_conflict,'mutated',true);
  end if;

  v_path:=atlas.worker_weekly_capacity_management_state_v1(p_farm_id,p_membership_id,v_week_start);
  if coalesce((v_path->>'pathExists')::boolean,false) then
    return jsonb_build_object('contractVersion','worker_weekly_capacity_management_sync_v1','state','management_path_open','conflict',v_conflict,'managementPath',v_path,'mutated',false);
  end if;

  v_due:=greatest(v_week_start,least(v_week_end,v_today));
  insert into atlas.tasks(
    farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,
    action_key,operation_class,work_class,task_series_key,engine_instance_key,visibility_scope
  ) values (
    p_farm_id,
    case when v_state='recovery_required' then 'Resolve Farm Hand recovery-capacity plan — week of '||v_week_start::text
         when v_state in ('capacity_truth_required','capacity_policy_conflict') then 'Repair Farm Hand capacity truth — week of '||v_week_start::text
         else 'Resolve Farm Hand capacity conflict — week of '||v_week_start::text end,
    'capacity_resolution','open','high',v_due,'worker_weekly_capacity_management',p_membership_id,
    case when v_state='recovery_required' then 'Required/protected work does not fit normal planned capacity but fits governed recovery capacity. Farm Operations must decide the lawful recovery/scope plan before optional work consumes that capacity.'
         when v_state in ('capacity_truth_required','capacity_policy_conflict') then 'Farm Operations cannot adjudicate labor claims until the Worker Day capacity anchor is repaired.'
         else 'Required/protected labor claims exceed governed worker capacity. Farm Operations must first reassign, move lawful work, reduce scope, add delegated capacity, or determine that an ownership-level consequence remains unresolved.' end,
    jsonb_build_object(
      'task_style','worker_weekly_capacity_management','repair_owner','farm_operations_management',
      'week_start',v_week_start,'week_end',v_week_end,'membership_id',p_membership_id,
      'capacity_state',v_state,'conflict_class',v_conflict->>'conflictClass','conflict_snapshot',v_conflict,
      'management_case_state','open','ownership_consequence_unresolved',false,'principal_escalation_created',false,
      'resolution_options',jsonb_build_array('move_lawful_work','reassign_delegated_work','reduce_scope','use_governed_recovery_capacity','add_delegated_capacity','identify_ownership_consequence'),
      'display_action','Resolve capacity','display_subject','Farm Hand week of '||v_week_start::text,
      'display_detail','Farm Operations owns this labor-capacity exception first. Principal remains silent unless management explicitly proves an ownership-level consequence remains unresolved.',
      'work_lane','required','commitment_kind','floating','effort_units',1
    ),
    'resolve_capacity','inspect_assess','standard','worker:'||p_membership_id::text||':weekly-capacity-management',
    'worker-weekly-capacity:'||p_membership_id::text||':'||v_week_start::text,'management'
  ) returning * into v_task;

  v_path:=atlas.worker_weekly_capacity_management_state_v1(p_farm_id,p_membership_id,v_week_start);
  return jsonb_build_object('contractVersion','worker_weekly_capacity_management_sync_v1','state','management_path_created','conflict',v_conflict,'taskId',v_task.id,'plannedOccurrenceId',v_task.planned_occurrence_id,'managementPath',v_path,'mutated',true);
end;
$$;
revoke all on function atlas.ensure_worker_weekly_capacity_management_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.ensure_worker_weekly_capacity_management_v1(uuid,uuid,date) to service_role;
