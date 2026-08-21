create or replace function atlas.ensure_farm_round_for_date_v1(p_farm_id uuid,p_membership_id uuid,p_service_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_count integer:=0;
  v_parent_occurrence_id uuid;
  v_parent_task_id uuid;
  v_payload jsonb;
  v_total_effort numeric:=0;
  v_farm atlas.farms%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_owner atlas.farm_memberships%rowtype;
begin
  select * into v_farm from atlas.farms where id=p_farm_id;
  select * into v_member from atlas.farm_memberships where id=p_membership_id and farm_id=p_farm_id and active;
  select * into v_owner from atlas.farm_memberships where farm_id=p_farm_id and active and role='owner' order by created_at limit 1;
  if v_farm.id is null or v_member.id is null then
    return jsonb_build_object('contractVersion','farm_round_grouping_v1','state','membership_missing','serviceDate',p_service_date);
  end if;

  select count(*),coalesce(sum(coalesce(o.effort_units,0)),0)
  into v_count,v_total_effort
  from atlas.planned_work_occurrences o
  join atlas.farm_round_member_series cfg
    on cfg.farm_id=o.farm_id and cfg.active=true
   and cfg.task_series_key=coalesce(o.task_payload->>'task_series_key',o.task_payload->'metadata'->>'task_series_key')
  where o.farm_id=p_farm_id and o.planned_due_date=p_service_date
    and nullif(o.task_payload->>'assigned_membership_id','')::uuid=p_membership_id
    and o.state<>'cancelled';

  if v_count=0 then
    update atlas.farm_round_occurrences set status='cancelled',updated_at=now()
    where farm_id=p_farm_id and service_date=p_service_date and assigned_membership_id=p_membership_id and status='open';
    return jsonb_build_object('contractVersion','farm_round_grouping_v1','state','empty','serviceDate',p_service_date);
  end if;

  v_payload:=jsonb_build_object(
    'farm_id',p_farm_id,'organization_id',v_farm.organization_id,
    'title','Farm Round','task_type','stewardship_round','status','open','priority','high','due_date',p_service_date,
    'action_key','farm_round','work_class','standard','task_scope','farm_operation','origin_kind','generated',
    'visibility_scope','assigned_worker','assigned_membership_id',p_membership_id,'assigned_user_id',v_member.user_id,
    'created_by_user_id',v_owner.user_id,'task_series_key','anna_farm_round_daily',
    'engine_instance_key','farm_round:'||p_membership_id::text||':'||p_service_date::text,
    'metadata',jsonb_build_object(
      'task_key',coalesce(v_member.worker_key,'worker')||'_farm_round_'||replace(p_service_date::text,'-',''),
      'anna_task',v_member.worker_key='anna','assigned_to',coalesce(v_member.worker_key,'Worker'),'assignee_key',v_member.worker_key,
      'executor_worker_key',v_member.worker_key,'executor_membership_id',p_membership_id,'work_route','farm_round','work_rhythm','Stewardship',
      'collection_zone','Farm Round','collection_label','Stewardship','display_action','Farm Round','display_subject',v_farm.name,
      'display_location',v_farm.name,'farm_round_parent',true,'farm_round_contract','farm_round_grouping_v1',
      'structured_result_required',true,'quick_complete_allowed',false,'hide_details',true,'day_order',40,
      'truthBoundary','Parent card groups actual due recurring stewardship rows; members retain their own task identity and history.'
    )
  );

  v_parent_occurrence_id:=atlas.plan_work_occurrence_v1(
    p_farm_id,'farm_round:stewardship:v1','farm_round:stewardship:v1:time_window',
    'farm_round:'||p_membership_id::text||':'||p_service_date::text,
    'Farm Round','stewardship_round',p_service_date,'farm_round',null,'time_window',30,32,v_payload,'{}'::jsonb,
    jsonb_build_object('automatic',true,'source_kind','farm_round'),p_service_date,
    jsonb_build_object('farmRoundContract','farm_round_grouping_v1','serviceDate',p_service_date,'memberCount',v_count)
  );

  update atlas.planned_work_occurrences
  set work_lane='required',commitment_kind='hard_date',effort_units=0,
      miss_consequence=jsonb_build_object('tier',5,'class','recurring_maintenance','reason','The grouped stewardship members remain due until completed.'),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'farmRoundContract','farm_round_grouping_v1','farmRoundParent',true,'memberCount',v_count,'memberEffortUnits',v_total_effort,
        'farmRoundConsequenceSource','grouped_recurring_stewardship'
      ),updated_at=now()
  where id=v_parent_occurrence_id;

  update atlas.planned_work_occurrences o
  set parent_occurrence_id=v_parent_occurrence_id,
      task_payload=jsonb_set(coalesce(o.task_payload,'{}'::jsonb),'{metadata}',
        coalesce(o.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'farm_round_member',true,'farm_round_parent_occurrence_id',v_parent_occurrence_id,
          'farm_round_route_stop_key',cfg.route_stop_key,'farm_round_route_stop_label',cfg.route_stop_label,
          'farm_round_route_order',cfg.route_order,'farm_round_member_order',cfg.member_order,
          'farm_round_display_label',cfg.display_label,'farm_round_display_detail',cfg.display_detail,
          'farm_round_issue_options',cfg.issue_options,'farm_round_contract','farm_round_grouping_v1'
        ),true),
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('farmRoundContract','farm_round_grouping_v1','farmRoundParentOccurrenceId',v_parent_occurrence_id),updated_at=now()
  from atlas.farm_round_member_series cfg
  where o.farm_id=p_farm_id and o.planned_due_date=p_service_date
    and nullif(o.task_payload->>'assigned_membership_id','')::uuid=p_membership_id
    and cfg.farm_id=o.farm_id and cfg.active=true
    and cfg.task_series_key=coalesce(o.task_payload->>'task_series_key',o.task_payload->'metadata'->>'task_series_key')
    and o.state<>'cancelled';

  select released_task_id into v_parent_task_id from atlas.planned_work_occurrences where id=v_parent_occurrence_id;
  insert into atlas.farm_round_occurrences(farm_id,service_date,assigned_membership_id,parent_occurrence_id,parent_task_id,status,metadata)
  values(p_farm_id,p_service_date,p_membership_id,v_parent_occurrence_id,v_parent_task_id,'open',jsonb_build_object('memberCount',v_count,'memberEffortUnits',v_total_effort,'source','farm_round_grouping_v1'))
  on conflict(farm_id,service_date,assigned_membership_id) do update set parent_occurrence_id=excluded.parent_occurrence_id,
    parent_task_id=coalesce(excluded.parent_task_id,atlas.farm_round_occurrences.parent_task_id),status='open',
    metadata=atlas.farm_round_occurrences.metadata||excluded.metadata,updated_at=now();

  return jsonb_build_object('contractVersion','farm_round_grouping_v1','state','grouped','serviceDate',p_service_date,'parentOccurrenceId',v_parent_occurrence_id,'parentTaskId',v_parent_task_id,'memberCount',v_count);
end;
$function$;

do $$
declare v_farm uuid; v_anna uuid; r record;
begin
  select id into v_farm from atlas.farms where stable_key='elm_farm';
  select id into v_anna from atlas.farm_memberships where farm_id=v_farm and active and worker_key='anna' order by created_at limit 1;
  for r in select service_date from atlas.farm_round_occurrences where farm_id=v_farm and assigned_membership_id=v_anna and status='open' order by service_date loop
    perform atlas.ensure_farm_round_for_date_v1(v_farm,v_anna,r.service_date);
  end loop;
end $$;
