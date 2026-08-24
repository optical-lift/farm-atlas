create or replace function atlas.worker_task_effective_placement_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_definition atlas.work_definitions%rowtype;
  v_definition_placement jsonb := '{}'::jsonb;
  v_window text;
  v_order numeric;
  v_anchor text;
  v_source text;
begin
  if p_farm_id is null or p_membership_id is null or p_task_id is null or p_service_date is null then
    raise exception 'Farm, membership, task, and service date are required.' using errcode='22023';
  end if;

  select * into v_task
  from atlas.tasks t
  where t.id=p_task_id
    and t.farm_id=p_farm_id;
  if v_task.id is null then
    raise exception 'Task was not found on this farm.' using errcode='P0002';
  end if;

  select * into v_placement
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.task_id=p_task_id
    and p.service_date=p_service_date
    and p.state='placed'
  order by p.updated_at desc,p.created_at desc
  limit 1;

  if v_placement.id is not null then
    return jsonb_strip_nulls(jsonb_build_object(
      'contractVersion','worker_task_effective_placement_v1',
      'taskId',p_task_id,
      'serviceDate',p_service_date,
      'dayWindow',v_placement.day_window,
      'sortOrder',v_placement.sort_order,
      'plannedStartAt',v_placement.planned_start_at,
      'plannedDurationMinutes',v_placement.planned_duration_minutes,
      'source','manual_occurrence_placement',
      'placementId',v_placement.id,
      'placementSource',v_placement.placement_source,
      'placementReason',v_placement.placement_reason
    ));
  end if;

  if v_task.planned_occurrence_id is not null then
    select d.* into v_definition
    from atlas.planned_work_occurrences o
    join atlas.work_definitions d on d.id=o.work_definition_id
    where o.id=v_task.planned_occurrence_id
      and o.farm_id=p_farm_id
      and d.farm_id=p_farm_id
      and d.active=true
    limit 1;
  end if;

  if v_definition.id is not null
     and jsonb_typeof(v_definition.metadata->'dayPlacement')='object' then
    v_definition_placement:=v_definition.metadata->'dayPlacement';
    v_window:=lower(nullif(v_definition_placement->>'window',''));
    v_anchor:=lower(nullif(v_definition_placement->>'anchor',''));
    begin
      v_order:=nullif(v_definition_placement->>'order','')::numeric;
    exception when invalid_text_representation then
      v_order:=null;
    end;
    if v_window not in ('morning','afternoon','evening') then
      v_window:=case
        when v_anchor in ('top','morning','upper','first') then 'morning'
        when v_anchor in ('evening','lower','bottom','last','last_thing') then 'evening'
        else 'afternoon'
      end;
    end if;
    if v_order is null then
      v_order:=atlas.worker_task_order_v1(v_task.action_key,v_task.task_type,
        coalesce(v_task.metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'day_window',v_window,
          'work_order_anchor',v_anchor
        )));
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'contractVersion','worker_task_effective_placement_v1',
      'taskId',p_task_id,
      'serviceDate',p_service_date,
      'dayWindow',v_window,
      'sortOrder',v_order,
      'source','work_definition',
      'workDefinitionId',v_definition.id,
      'workDefinitionStableKey',v_definition.stable_key,
      'anchor',v_anchor
    ));
  end if;

  v_window:=atlas.worker_task_day_window_v1(v_task.action_key,v_task.task_type,v_task.metadata);
  v_order:=atlas.worker_task_order_v1(v_task.action_key,v_task.task_type,v_task.metadata);
  v_source:=case
    when v_task.metadata ? 'day_work_order'
      or v_task.metadata ? 'work_order'
      or v_task.metadata ? 'day_order_override'
      or v_task.metadata ? 'run_sheet_order'
      or v_task.metadata ? 'day_window'
      or v_task.metadata ? 'work_window_key'
      or v_task.metadata ? 'daypart'
      or v_task.metadata ? 'work_order_anchor'
    then 'task_metadata'
    else 'operational_fallback'
  end;

  return jsonb_build_object(
    'contractVersion','worker_task_effective_placement_v1',
    'taskId',p_task_id,
    'serviceDate',p_service_date,
    'dayWindow',v_window,
    'sortOrder',v_order,
    'source',v_source
  );
end;
$function$;

create or replace function atlas.owner_set_work_definition_day_placement_api_v1(
  p_farm_id uuid,
  p_work_definition_id uuid,
  p_day_window text,
  p_sort_order numeric,
  p_anchor text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_definition atlas.work_definitions%rowtype;
  v_window text:=lower(nullif(trim(coalesce(p_day_window,'')),''));
  v_anchor text:=lower(nullif(trim(coalesce(p_anchor,'')),''));
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if v_window not in ('morning','afternoon','evening') then
    raise exception 'day window must be morning, afternoon, or evening.' using errcode='22023';
  end if;
  if p_sort_order is null then
    raise exception 'A numeric sort order is required.' using errcode='22023';
  end if;
  if v_anchor is not null and v_anchor not in ('top','morning','midday','visibility','evening','bottom') then
    raise exception 'Unsupported placement anchor.' using errcode='22023';
  end if;

  select * into v_definition
  from atlas.work_definitions d
  where d.id=p_work_definition_id and d.farm_id=p_farm_id and d.active=true
  for update;
  if v_definition.id is null then
    raise exception 'Active work definition was not found on this farm.' using errcode='P0002';
  end if;

  update atlas.work_definitions d
  set metadata=coalesce(d.metadata,'{}'::jsonb) || jsonb_build_object(
        'dayPlacement',jsonb_strip_nulls(jsonb_build_object(
          'window',v_window,'order',p_sort_order,'anchor',v_anchor
        )),
        'dayPlacementAuthority','work_definition',
        'dayPlacementReason',coalesce(nullif(trim(coalesce(p_reason,'')),''),'Owner-authored standing Worker Day placement.')
      ),
      updated_at=now()
  where d.id=v_definition.id
  returning * into v_definition;

  return jsonb_build_object(
    'contractVersion','work_definition_day_placement_authoring_v1',
    'farmId',p_farm_id,
    'workDefinitionId',v_definition.id,
    'stableKey',v_definition.stable_key,
    'dayPlacement',v_definition.metadata->'dayPlacement',
    'authority','work_definition'
  );
end;
$function$;

revoke all on function atlas.worker_task_effective_placement_v1(uuid,uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_task_effective_placement_v1(uuid,uuid,uuid,date) to service_role;
revoke all on function atlas.owner_set_work_definition_day_placement_api_v1(uuid,uuid,text,numeric,text,text) from public,anon;
grant execute on function atlas.owner_set_work_definition_day_placement_api_v1(uuid,uuid,text,numeric,text,text) to authenticated,service_role;

create or replace function atlas.worker_day_feed_plan_live_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_capacity jsonb;
  v_target integer := 0;
  v_selection jsonb := '[]'::jsonb;
  v_real jsonb := '[]'::jsonb;
  v_committed integer := 0;
begin
  if p_day is null then raise exception 'A worker day is required.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_day);
  v_target:=case when v_capacity->>'capacityClass'='recovery'
    then greatest(coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0),0)
    else greatest(coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0),0) end;

  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,p_day) then
    return jsonb_build_object('contractVersion','owner_worker_day_feed_plan_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,'availableWorkerDay',false,'paidTargetMinutes',v_target,'committedPaidMinutes',0,'automaticPaidMinutes',0,'remainingPaidMinutes',v_target,'realWork','[]'::jsonb,'automaticWork','[]'::jsonb,'suggestions','[]'::jsonb,'warnings','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId',s.task_id,'presentationState',s.presentation_state,'presentationReason',s.presentation_reason,
    'selectionRank',s.selection_rank,'workLane',s.work_lane,'commitmentKind',s.commitment_kind
  ) order by s.selection_rank,s.task_id),'[]'::jsonb)
  into v_selection
  from atlas.presented_work_selection_rows_live_v1(p_farm_id,p_membership_id,p_day) s;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id','task:'||t.id::text,'kind','real','sourceKind','task','sourceId',t.id,'taskId',t.id,
      'title',t.title,'status',t.status,'expectedActiveMinutes',capacity.expected_active_minutes,
      'dayWindow',resolved.placement->>'dayWindow',
      'workOrderNumber',(resolved.placement->>'sortOrder')::numeric,
      'placementAuthority',resolved.placement->>'source',
      'environment',nullif(t.metadata->>'environment',''),
      'location',coalesce(nullif(t.metadata->>'display_location',''),nullif(t.metadata->>'collection_zone',''),nullif(t.metadata->>'collection_label','')),
      'automatic',false,'requiresOwnerApproval',false,'reason',s.item->>'presentationReason','commitmentKind',s.item->>'commitmentKind'
    ) order by
      case resolved.placement->>'dayWindow' when 'morning' then 0 when 'afternoon' then 1 else 2 end,
      (resolved.placement->>'sortOrder')::numeric,
      coalesce(nullif(s.item->>'selectionRank','')::bigint,9223372036854775807),t.title,t.id
    ),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes),0)::integer
  into v_real,v_committed
  from jsonb_array_elements(v_selection) s(item)
  join atlas.tasks t on t.id=(s.item->>'taskId')::uuid
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
  cross join lateral (select atlas.worker_task_effective_placement_v1(p_farm_id,p_membership_id,t.id,p_day) as placement) resolved
  where s.item->>'presentationState'='presented';

  return jsonb_build_object(
    'contractVersion','owner_worker_day_feed_plan_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'availableWorkerDay',true,'paidTargetMinutes',v_target,'committedPaidMinutes',v_committed,'automaticPaidMinutes',0,
    'remainingPaidMinutes',greatest(v_target-v_committed,0),'realWork',v_real,'automaticWork','[]'::jsonb,
    'suggestions','[]'::jsonb,'warnings','[]'::jsonb,'selectionContractVersion','presented_work_selection_rows_live_v1',
    'placementContractVersion','worker_task_effective_placement_v1'
  );
end;
$function$;