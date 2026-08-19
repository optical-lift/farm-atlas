create or replace function atlas.worker_day_choreography_api_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
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
    'plannedStartAt',p.planned_start_at,'plannedDurationMinutes',p.planned_duration_minutes
  ) order by case p.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,p.sort_order,p.task_id),'[]'::jsonb)
  into v_placements
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=p_day and p.state='placed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,'taskId',p.task_id,'serviceDate',p.service_date,'dayWindow',p.day_window,
    'sortOrder',p.sort_order,'placementSource',p.placement_source,'placementReason',p.placement_reason,'state',p.state,
    'plannedStartAt',p.planned_start_at,'plannedDurationMinutes',p.planned_duration_minutes
  ) order by p.updated_at desc,p.task_id),'[]'::jsonb)
  into v_placement_overrides
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cueId',c.id,
    'serviceDate',c.service_date,
    'cueKind',c.cue_kind,
    'anchorKind',case when projection.morning_recovery then 'first_open' else c.anchor_kind end,
    'anchorTaskId',c.anchor_task_id,
    'scheduledAt',c.scheduled_at,
    'title',case
      when projection.morning_recovery then 'Charge the mower batteries'
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryTitle',''),c.title)
      else c.title
    end,
    'body',case
      when projection.morning_recovery then 'You’re mowing today. Charge the mower batteries so they’re ready when you get to the mowing job.'
      when c.cue_kind='briefing' and nullif(c.payload->>'dynamicProjectId','') is not null
        then atlas.event_day_briefing_body_v1((c.payload->>'dynamicProjectId')::uuid,c.membership_id,p_day)
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryPrompt',''),c.body)
      else c.body
    end,
    'payload',case
      when projection.morning_recovery then c.payload || jsonb_build_object(
        'morningRecovery',true,
        'originServiceDate',c.service_date,
        'promotedForServiceDate',p_day,
        'dismissible',false,
        'prompt','You’re mowing today. Charge the mower batteries so they’re ready when you get to the mowing job.'
      )
      else c.payload
    end,
    'status',case
      when projection.morning_recovery then 'available'
      when c.service_date<p_day and c.status not in ('resolved','dismissed') then 'stale'
      else c.status
    end,
    'recoveryPolicy',c.recovery_policy,
    'availableFrom',c.available_from,
    'expiresAt',c.expires_at,
    'response',c.response,
    'resolvedAt',c.resolved_at
  ) order by
    case when projection.morning_recovery then 0 else case c.anchor_kind when 'first_open' then 0 when 'before_task' then 1 when 'after_task' then 2 else 3 end end,
    c.service_date,coalesce(c.scheduled_at,c.available_from,c.created_at),c.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues c
  cross join lateral (
    select (
      c.service_date < p_day
      and c.status not in ('resolved','dismissed')
      and c.recovery_policy in ('refresh','persist','block')
      and c.result_contract->>'kind'='resource_recharge_confirmation_v1'
      and exists (
        select 1
        from atlas.resource_operational_state ros
        where ros.resource_id::text=c.result_contract->>'resourceId'
          and ros.readiness_state='needs_charge'
      )
      and exists (
        select 1
        from atlas.worker_day_task_placements placement
        join atlas.tasks task on task.id=placement.task_id
        cross join lateral (select atlas.task_execution_readiness_v1(task.id) as readiness) execution
        where placement.farm_id=p_farm_id
          and placement.membership_id=p_membership_id
          and placement.service_date=p_day
          and placement.state='placed'
          and task.status not in ('done','archived','cancelled')
          and task.task_type='mowing'
          and coalesce(task.metadata->'required_resource_keys','[]'::jsonb) ? 'battery_push_mower_battery_set'
          and coalesce((execution.readiness->>'prerequisitesReady')::boolean,false)=true
          and coalesce((execution.readiness->>'destinationReady')::boolean,false)=true
          and coalesce((execution.readiness->>'seedReady')::boolean,false)=true
      )
    ) as morning_recovery
  ) projection
  where c.farm_id=p_farm_id
    and c.membership_id=p_membership_id
    and c.status<>'dismissed'
    and (c.service_date=p_day or (c.service_date<p_day and c.status<>'resolved' and c.recovery_policy in ('refresh','persist','block') and (c.available_from is null or c.available_from<=now())));

  return jsonb_build_object('contractVersion','worker_day_choreography_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,'placements',v_placements,'placementOverrides',v_placement_overrides,'cues',v_cues);
end;
$function$;
