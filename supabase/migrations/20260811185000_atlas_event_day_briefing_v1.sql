-- Event Day first-open briefing v1
-- A briefing is orientation, not work. It is recalculated from the event project
-- and the assigned worker's remaining moves each time Day is read, then expires.

create or replace function atlas.event_day_briefing_body_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date
)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_remaining integer:=0;
  v_lebanon_harvest boolean:=false;
  v_setup boolean:=false;
begin
  select
    count(*)::integer,
    coalesce(bool_or(
      task.task_type='harvest'
      and (
        coalesce(task.metadata->>'departure_label','')='Lebanon'
        or coalesce(task.metadata->>'address','') ilike '%Lebanon%'
        or coalesce(task.metadata->>'location_name','') ilike '%Karianne%'
      )
    ),false),
    coalesce(bool_or(task.task_type='event_setup'),false)
  into v_remaining,v_lebanon_harvest,v_setup
  from atlas.project_task_links link
  join atlas.tasks task on task.id=link.task_id
  where link.project_id=p_project_id
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and coalesce(task.due_date,p_day)<=p_day
    and task.visibility_scope='assigned_worker';

  if v_remaining=0 then
    return 'Everything assigned to you for tonight is already finished.';
  end if;
  if v_lebanon_harvest and v_setup then
    return 'Lebanon harvest this morning. Elm setup afterward. '||v_remaining::text||' moves make tonight ready.';
  end if;
  if v_lebanon_harvest then
    return 'Lebanon harvest is the first move. '||v_remaining::text||' moves remain for tonight.';
  end if;
  if v_setup then
    return 'Elm setup is what remains. '||v_remaining::text||' moves remain for tonight.';
  end if;
  return v_remaining::text||' moves remain for tonight.';
end;
$$;

revoke all on function atlas.event_day_briefing_body_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.event_day_briefing_body_v1(uuid,uuid,date) to service_role;

create or replace function atlas.worker_day_choreography_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_allowed boolean:=false;
  v_placements jsonb:='[]'::jsonb;
  v_placement_overrides jsonb:='[]'::jsonb;
  v_cues jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active worker membership required.' using errcode='42501';
  end if;

  select exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.user_id=auth.uid()
  ) or exists(
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) into v_allowed;
  if not v_allowed then
    raise exception 'Worker day access required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,
    'taskId',p.task_id,
    'serviceDate',p.service_date,
    'dayWindow',p.day_window,
    'sortOrder',p.sort_order,
    'placementSource',p.placement_source,
    'placementReason',p.placement_reason,
    'state',p.state
  ) order by case p.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,p.sort_order,p.task_id),'[]'::jsonb)
  into v_placements
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.service_date=p_day
    and p.state='placed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,
    'taskId',p.task_id,
    'serviceDate',p.service_date,
    'dayWindow',p.day_window,
    'sortOrder',p.sort_order,
    'placementSource',p.placement_source,
    'placementReason',p.placement_reason,
    'state',p.state
  ) order by p.updated_at desc,p.task_id),'[]'::jsonb)
  into v_placement_overrides
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cueId',c.id,
    'serviceDate',c.service_date,
    'cueKind',c.cue_kind,
    'anchorKind',c.anchor_kind,
    'anchorTaskId',c.anchor_task_id,
    'scheduledAt',c.scheduled_at,
    'title',case
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryTitle',''),c.title)
      else c.title
    end,
    'body',case
      when c.cue_kind='briefing' and nullif(c.payload->>'dynamicProjectId','') is not null
        then atlas.event_day_briefing_body_v1((c.payload->>'dynamicProjectId')::uuid,c.membership_id,p_day)
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryPrompt',''),c.body)
      else c.body
    end,
    'payload',c.payload,
    'status',case
      when c.service_date<p_day and c.status not in ('resolved','dismissed') then 'stale'
      else c.status
    end,
    'recoveryPolicy',c.recovery_policy,
    'availableFrom',c.available_from,
    'expiresAt',c.expires_at,
    'response',c.response,
    'resolvedAt',c.resolved_at
  ) order by
    case c.anchor_kind when 'first_open' then 0 when 'before_task' then 1 when 'after_task' then 2 else 3 end,
    c.service_date,
    coalesce(c.scheduled_at,c.available_from,c.created_at),
    c.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues c
  where c.farm_id=p_farm_id
    and c.membership_id=p_membership_id
    and c.status<>'dismissed'
    and (
      c.service_date=p_day
      or (
        c.service_date<p_day
        and c.status<>'resolved'
        and c.recovery_policy in ('refresh','persist','block')
        and (c.available_from is null or c.available_from<=now())
      )
    );

  return jsonb_build_object(
    'contractVersion','worker_day_choreography_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'placements',v_placements,
    'placementOverrides',v_placement_overrides,
    'cues',v_cues
  );
end;
$$;

grant execute on function atlas.worker_day_choreography_api_v1(uuid,uuid,date) to authenticated;

-- First event acceptance specimen: discover the event and the dominant Farm Hand
-- relationship from canonical project/task links rather than hard-coding IDs.
do $$
declare
  v_project atlas.projects%rowtype;
  v_membership_id uuid;
  v_farm_id uuid;
  v_org_id uuid;
  v_expires timestamptz;
begin
  select * into v_project
  from atlas.projects project
  where project.status='active'
    and project.portfolio_type='event'
    and project.target_date='2026-08-13'
    and project.title ilike '%Bloom Bar%'
  order by project.created_at desc
  limit 1;

  if v_project.id is null then
    return;
  end if;

  select task.assigned_membership_id,task.farm_id,task.organization_id
  into v_membership_id,v_farm_id,v_org_id
  from atlas.project_task_links link
  join atlas.tasks task on task.id=link.task_id
  where link.project_id=v_project.id
    and task.assigned_membership_id is not null
    and task.visibility_scope='assigned_worker'
  group by task.assigned_membership_id,task.farm_id,task.organization_id
  order by count(*) desc
  limit 1;

  if v_membership_id is null or v_farm_id is null or v_org_id is null then
    return;
  end if;

  v_expires:=((v_project.target_date+1)::timestamp at time zone 'America/Chicago');

  insert into atlas.worker_day_cues(
    organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
    title,body,payload,result_contract,status,recovery_policy,expires_at,created_by_user_id
  )
  select
    v_org_id,
    v_farm_id,
    v_membership_id,
    v_project.target_date,
    'briefing',
    'first_open',
    null,
    'Tonight at Elm — Bouquet Bar',
    null,
    jsonb_build_object(
      'stableKey','bloom_bar_aug13_first_open_briefing_v1',
      'dynamicProjectId',v_project.id,
      'actionLabel','Start today'
    ),
    '{}'::jsonb,
    'available',
    'expire',
    v_expires,
    null
  where not exists(
    select 1 from atlas.worker_day_cues cue
    where cue.farm_id=v_farm_id
      and cue.membership_id=v_membership_id
      and cue.service_date=v_project.target_date
      and cue.payload->>'stableKey'='bloom_bar_aug13_first_open_briefing_v1'
  );
end;
$$;
