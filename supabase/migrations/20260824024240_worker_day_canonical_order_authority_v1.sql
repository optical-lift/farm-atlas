create or replace function atlas.worker_task_day_window_v1(p_action_key text, p_task_type text, p_metadata jsonb)
returns text
language sql
immutable
as $function$
  select case
    when lower(coalesce(p_metadata->>'farm_round_parent','false')) in ('true','yes','1')
      or coalesce(p_action_key,'')='farm_round'
      or coalesce(p_task_type,'')='stewardship_round' then 'morning'
    when lower(coalesce(p_metadata->>'work_window_key','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'work_window_key')
    when lower(coalesce(p_metadata->>'daypart','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'daypart')
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('top','morning','upper','first') then 'morning'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('midday','midday_flex','visibility','visibility_prep','anchored','afternoon') then 'afternoon'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('evening','lower','bottom','last','last_thing') then 'evening'
    when lower(coalesce(p_action_key,'')) in ('sow','seed')
      or lower(coalesce(p_task_type,'')) in ('sowing','succession_sowing')
      or lower(coalesce(p_metadata->>'work_rhythm',''))='seed_sowing' then 'evening'
    when lower(coalesce(p_metadata->>'work_route',''))='seed' then 'evening'
    when lower(coalesce(p_action_key,''))='mow'
      or lower(coalesce(p_metadata->>'work_collection_key',''))='mowing' then 'evening'
    when lower(coalesce(p_action_key,'')) in ('plant','transplant')
      or lower(coalesce(p_task_type,''))='transplanting' then 'evening'
    when lower(coalesce(p_action_key,''))='weed'
      or lower(coalesce(p_metadata->>'work_collection_key',''))='weeding' then 'morning'
    when lower(coalesce(p_action_key,''))='harvest'
      or lower(coalesce(p_task_type,''))='postharvest' then 'morning'
    when lower(coalesce(p_action_key,''))='water'
      or lower(coalesce(p_task_type,'')) in ('grow_room_care','germination_check') then 'morning'
    else 'afternoon'
  end;
$function$;

create or replace function atlas.owner_worker_day_plan_choreographed_live_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_plan jsonb;
  v_real jsonb:='[]'::jsonb;
  v_placed jsonb:='[]'::jsonb;
  v_suggestions jsonb:='[]'::jsonb;
  v_committed integer:=0;
  v_automatic integer:=0;
  v_target integer:=420;
begin
  v_plan:=atlas.owner_worker_day_plan_v1(p_farm_id,p_membership_id,p_day);
  if coalesce((v_plan->>'availableWorkerDay')::boolean,false)=false then return v_plan; end if;

  select coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_real
  from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) item
  where not exists (
    select 1
    from atlas.worker_day_task_placements placement
    where placement.farm_id=p_farm_id
      and placement.membership_id=p_membership_id
      and placement.task_id=(item->>'taskId')::uuid
      and (
        placement.state='placed'
        or (placement.state='returned_to_atlas' and placement.service_date=p_day)
      )
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','task:'||task.id::text,
    'kind','real',
    'sourceKind','task',
    'sourceId',task.id,
    'taskId',task.id,
    'title',task.title,
    'status',task.status,
    'expectedActiveMinutes',capacity.expected_active_minutes,
    'dayWindow',placement.day_window,
    'workOrderNumber',placement.sort_order,
    'location',coalesce(nullif(task.metadata->>'display_location',''),nullif(task.metadata->>'collection_zone',''),nullif(task.metadata->>'collection_label','')),
    'automatic',false,
    'requiresOwnerApproval',false,
    'placementSource',placement.placement_source,
    'placementReason',placement.placement_reason
  ) order by placement.sort_order, case placement.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end, task.title,task.id),'[]'::jsonb)
  into v_placed
  from atlas.worker_day_task_placements placement
  join atlas.tasks task on task.id=placement.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.service_date=p_day
    and placement.state='placed'
    and task.assigned_membership_id=p_membership_id
    and task.status = 'open'
    and coalesce(task.visibility_scope,'') <> 'system_internal'
    and atlas.task_temporally_eligible_v1(task.id,p_day)
    and atlas.task_required_resources_available_v1(task.id)
    and task.parent_task_id is null
    and nullif(task.metadata->>'parent_task_id','') is null
    and coalesce((task.metadata->>'is_child_task')::boolean,false)=false;

  v_real:=v_real||v_placed;

  select coalesce(jsonb_agg(item order by
    coalesce(nullif(item->>'workOrderNumber','')::integer,999999),
    case item->>'dayWindow' when 'morning' then 0 when 'afternoon' then 1 when 'evening' then 2 else 3 end,
    coalesce(item->>'title',''),
    coalesce(item->>'taskId',item->>'sourceId','')
  ),'[]'::jsonb)
  into v_real
  from jsonb_array_elements(v_real) item;

  select coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_suggestions
  from jsonb_array_elements(coalesce(v_plan->'suggestions','[]'::jsonb)) item
  where not (
    item->>'sourceKind'='floating_task'
    and exists (
      select 1
      from atlas.worker_day_task_placements placement
      where placement.farm_id=p_farm_id
        and placement.membership_id=p_membership_id
        and placement.task_id=(item->>'sourceId')::uuid
        and placement.state='placed'
    )
  );

  select coalesce(sum(coalesce((item->>'expectedActiveMinutes')::numeric,0)),0)::integer into v_committed
  from jsonb_array_elements(v_real) item;

  v_automatic:=coalesce((v_plan->>'automaticPaidMinutes')::integer,0);
  v_target:=coalesce((v_plan->>'paidTargetMinutes')::integer,420);

  v_plan:=jsonb_set(v_plan,'{realWork}',v_real,true);
  v_plan:=jsonb_set(v_plan,'{suggestions}',v_suggestions,true);
  v_plan:=jsonb_set(v_plan,'{committedPaidMinutes}',to_jsonb(v_committed),true);
  v_plan:=jsonb_set(v_plan,'{remainingPaidMinutes}',to_jsonb(greatest(v_target-v_committed-v_automatic,0)),true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('owner_worker_day_plan_choreographed_v1'::text),true);
  return v_plan;
end;
$function$;