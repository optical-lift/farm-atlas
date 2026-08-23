alter table atlas.worker_day_task_placements
  add column if not exists planned_start_at timestamptz;

comment on column atlas.worker_day_task_placements.planned_start_at is
  'Optional exact execution start for this worker-day placement. This is choreography truth and never changes the task due date.';

alter table atlas.worker_day_task_placement_events
  drop constraint if exists worker_day_task_placement_events_event_kind_check;

alter table atlas.worker_day_task_placement_events
  add constraint worker_day_task_placement_events_event_kind_check
  check (event_kind = any (array[
    'atlas_placed'::text,
    'owner_added'::text,
    'owner_rewindowed'::text,
    'owner_rescheduled'::text,
    'owner_reordered'::text,
    'owner_returned_to_atlas'::text,
    'owner_timed'::text,
    'owner_time_removed'::text
  ]));

create or replace function atlas.worker_day_choreography_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_allowed boolean:=false;
  v_placements jsonb:='[]'::jsonb;
  v_placement_overrides jsonb:='[]'::jsonb;
  v_cues jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if p_day is null then raise exception 'A worker day is required.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true) then raise exception 'Active worker membership required.' using errcode='42501'; end if;

  select exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.user_id=auth.uid())
    or exists(select 1 from atlas.farm_memberships fm where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()) into v_allowed;
  if not v_allowed then raise exception 'Worker day access required.' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,'taskId',p.task_id,'serviceDate',p.service_date,'dayWindow',p.day_window,
    'sortOrder',p.sort_order,'placementSource',p.placement_source,'placementReason',p.placement_reason,'state',p.state,
    'plannedStartAt',p.planned_start_at
  ) order by case p.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,p.sort_order,p.task_id),'[]'::jsonb)
  into v_placements
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=p_day and p.state='placed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,'taskId',p.task_id,'serviceDate',p.service_date,'dayWindow',p.day_window,
    'sortOrder',p.sort_order,'placementSource',p.placement_source,'placementReason',p.placement_reason,'state',p.state,
    'plannedStartAt',p.planned_start_at
  ) order by p.updated_at desc,p.task_id),'[]'::jsonb)
  into v_placement_overrides
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cueId',c.id,
    'serviceDate',c.service_date,
    'cueKind',c.cue_kind,
    'anchorKind',c.anchor_kind,
    'anchorTaskId',c.anchor_task_id,
    'scheduledAt',c.scheduled_at,
    'title',case when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryTitle',''),c.title) else c.title end,
    'body',case
      when c.cue_kind='briefing' and nullif(c.payload->>'dynamicProjectId','') is not null
        then atlas.event_day_briefing_body_v1((c.payload->>'dynamicProjectId')::uuid,c.membership_id,p_day)
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryPrompt',''),c.body)
      else c.body
    end,
    'payload',c.payload,
    'status',case when c.service_date<p_day and c.status not in ('resolved','dismissed') then 'stale' else c.status end,
    'recoveryPolicy',c.recovery_policy,
    'availableFrom',c.available_from,
    'expiresAt',c.expires_at,
    'response',c.response,
    'resolvedAt',c.resolved_at
  ) order by case c.anchor_kind when 'first_open' then 0 when 'before_task' then 1 when 'after_task' then 2 else 3 end,c.service_date,coalesce(c.scheduled_at,c.available_from,c.created_at),c.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues c
  where c.farm_id=p_farm_id
    and c.membership_id=p_membership_id
    and c.status<>'dismissed'
    and (c.service_date=p_day or (c.service_date<p_day and c.status<>'resolved' and c.recovery_policy in ('refresh','persist','block') and (c.available_from is null or c.available_from<=now())));

  return jsonb_build_object('contractVersion','worker_day_choreography_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,'placements',v_placements,'placementOverrides',v_placement_overrides,'cues',v_cues);
end;
$function$;

create or replace function atlas.owner_set_worker_day_task_time_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_day date,
  p_local_time text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.worker_day_task_placements%rowtype;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_plan jsonb;
  v_plan_item jsonb;
  v_local_time time without time zone;
  v_planned_start_at timestamptz;
  v_day_window text;
  v_sort_order numeric(12,3);
  v_event_kind text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null or p_task_id is null then
    raise exception 'A task and service date are required.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id and task.farm_id=p_farm_id and task.assigned_membership_id=p_membership_id;
  if v_task.id is null then
    raise exception 'The selected task is not assigned to this worker.' using errcode='55000';
  end if;

  if nullif(trim(coalesce(p_local_time,'')),'') is not null then
    begin
      v_local_time:=trim(p_local_time)::time without time zone;
    exception when others then
      raise exception 'Clock time must be a valid Elm Farm local time.' using errcode='22023';
    end;
    v_planned_start_at := (p_day::timestamp + v_local_time) at time zone 'America/Chicago';
    v_day_window := case
      when v_local_time < time '12:00' then 'morning'
      when v_local_time < time '17:00' then 'afternoon'
      else 'evening'
    end;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|day_choreography_v1',0));

  select * into v_existing
  from atlas.worker_day_task_placements placement
  where placement.task_id=p_task_id;

  if v_planned_start_at is null then
    if v_existing.id is null then
      return jsonb_build_object(
        'contractVersion','worker_day_task_time_v1',
        'farmId',p_farm_id,
        'membershipId',p_membership_id,
        'taskId',p_task_id,
        'serviceDate',p_day,
        'plannedStartAt',null,
        'changed',false
      );
    end if;
    if v_existing.state<>'placed' or v_existing.service_date<>p_day then
      raise exception 'This task is not placed on the selected worker day.' using errcode='55000';
    end if;

    update atlas.worker_day_task_placements placement
    set planned_start_at=null,
        placement_source='owner',
        placement_reason='Clock time removed by Owner.',
        owner_actor_user_id=auth.uid(),
        updated_at=now()
    where placement.id=v_existing.id
    returning * into v_placement;
    v_event_kind:='owner_time_removed';
  else
    if v_existing.id is null then
      v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
      select item into v_plan_item
      from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) item
      where item->>'taskId'=p_task_id::text
      limit 1;
      if v_plan_item is null then
        raise exception 'This task is not committed to the selected worker day.' using errcode='55000';
      end if;
      begin
        v_sort_order:=coalesce(nullif(v_plan_item->>'workOrderNumber','')::numeric,10000);
      exception when invalid_text_representation then
        v_sort_order:=10000;
      end;

      insert into atlas.worker_day_task_placements(
        organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,
        placement_source,placement_reason,state,owner_actor_user_id,planned_start_at
      ) values (
        v_task.organization_id,p_farm_id,p_membership_id,p_task_id,p_day,v_day_window,v_sort_order,
        'owner','Timed by Owner Clock.','placed',auth.uid(),v_planned_start_at
      ) returning * into v_placement;
    else
      if v_existing.state<>'placed' or v_existing.service_date<>p_day then
        raise exception 'This task is not placed on the selected worker day.' using errcode='55000';
      end if;
      update atlas.worker_day_task_placements placement
      set planned_start_at=v_planned_start_at,
          day_window=v_day_window,
          placement_source='owner',
          placement_reason='Timed by Owner Clock.',
          owner_actor_user_id=auth.uid(),
          updated_at=now()
      where placement.id=v_existing.id
      returning * into v_placement;
    end if;
    v_event_kind:='owner_timed';
  end if;

  insert into atlas.worker_day_task_placement_events(
    organization_id,farm_id,membership_id,task_id,placement_id,event_kind,
    from_service_date,to_service_date,from_day_window,to_day_window,from_sort_order,to_sort_order,
    actor_user_id,metadata
  ) values (
    v_task.organization_id,p_farm_id,p_membership_id,p_task_id,v_placement.id,v_event_kind,
    v_existing.service_date,v_placement.service_date,
    v_existing.day_window,v_placement.day_window,
    v_existing.sort_order,v_placement.sort_order,
    auth.uid(),jsonb_build_object(
      'source','clock_v1',
      'fromPlannedStartAt',v_existing.planned_start_at,
      'toPlannedStartAt',v_placement.planned_start_at,
      'localTime',case when v_planned_start_at is null then null else to_char(v_local_time,'HH24:MI') end
    )
  );

  return jsonb_build_object(
    'contractVersion','worker_day_task_time_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'taskId',p_task_id,
    'placementId',v_placement.id,
    'serviceDate',v_placement.service_date,
    'dayWindow',v_placement.day_window,
    'sortOrder',v_placement.sort_order,
    'plannedStartAt',v_placement.planned_start_at,
    'changed',true
  );
end;
$function$;

revoke all on function atlas.owner_set_worker_day_task_time_api_v1(uuid,uuid,uuid,date,text) from public;
revoke all on function atlas.owner_set_worker_day_task_time_api_v1(uuid,uuid,uuid,date,text) from anon;
grant execute on function atlas.owner_set_worker_day_task_time_api_v1(uuid,uuid,uuid,date,text) to authenticated;
grant execute on function atlas.owner_set_worker_day_task_time_api_v1(uuid,uuid,uuid,date,text) to service_role;