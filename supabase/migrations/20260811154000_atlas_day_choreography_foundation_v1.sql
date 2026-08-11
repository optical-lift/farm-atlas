-- Atlas Day Choreography foundation v1
-- Separates farm-task truth from worker-day placement and from non-task cues.

create table if not exists atlas.worker_day_task_placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  service_date date not null,
  day_window text not null default 'morning' check (day_window in ('morning','afternoon','evening')),
  sort_order numeric(12,3) not null default 10000,
  placement_source text not null default 'atlas' check (placement_source in ('atlas','owner')),
  placement_reason text,
  state text not null default 'placed' check (state in ('placed','returned_to_atlas')),
  owner_actor_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id)
);

create index if not exists worker_day_task_placements_day_idx
  on atlas.worker_day_task_placements (farm_id, membership_id, service_date, day_window, sort_order)
  where state='placed';

create table if not exists atlas.worker_day_task_placement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  placement_id uuid references atlas.worker_day_task_placements(id) on delete set null,
  event_kind text not null check (event_kind in ('atlas_placed','owner_added','owner_rewindowed','owner_rescheduled','owner_reordered','owner_returned_to_atlas')),
  from_service_date date,
  to_service_date date,
  from_day_window text check (from_day_window is null or from_day_window in ('morning','afternoon','evening')),
  to_day_window text check (to_day_window is null or to_day_window in ('morning','afternoon','evening')),
  from_sort_order numeric(12,3),
  to_sort_order numeric(12,3),
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists worker_day_task_placement_events_task_idx
  on atlas.worker_day_task_placement_events (task_id, created_at desc);

create table if not exists atlas.worker_day_cues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  service_date date not null,
  cue_kind text not null check (cue_kind in ('briefing','requirement','observation','somatic','result')),
  anchor_kind text not null check (anchor_kind in ('first_open','before_task','after_task','at_time')),
  anchor_task_id uuid references atlas.tasks(id) on delete cascade,
  scheduled_at timestamptz,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  result_contract jsonb not null default '{}'::jsonb,
  status text not null default 'waiting' check (status in ('waiting','available','unseen','stale','resolved','dismissed')),
  recovery_policy text not null default 'refresh' check (recovery_policy in ('refresh','expire','persist','block')),
  available_from timestamptz,
  expires_at timestamptz,
  response jsonb,
  resolved_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (anchor_kind in ('before_task','after_task') and anchor_task_id is not null)
    or (anchor_kind not in ('before_task','after_task'))
  )
);

create index if not exists worker_day_cues_day_idx
  on atlas.worker_day_cues (farm_id, membership_id, service_date, anchor_kind, created_at)
  where status not in ('resolved','dismissed');

alter table atlas.worker_day_task_placements enable row level security;
alter table atlas.worker_day_task_placement_events enable row level security;
alter table atlas.worker_day_cues enable row level security;

revoke all on atlas.worker_day_task_placements from anon, authenticated;
revoke all on atlas.worker_day_task_placement_events from anon, authenticated;
revoke all on atlas.worker_day_cues from anon, authenticated;
grant select, insert, update, delete on atlas.worker_day_task_placements to service_role;
grant select, insert, update, delete on atlas.worker_day_task_placement_events to service_role;
grant select, insert, update, delete on atlas.worker_day_cues to service_role;

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
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active worker membership required.' using errcode='42501';
  end if;

  select exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.user_id=auth.uid()
  ) or exists (
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

  -- A task with any explicit placement is no longer governed by its old due-date
  -- membership in the worker feed. The requested-day cards are returned above;
  -- these overrides let the feed suppress copies on every other day without
  -- mutating the task's canonical due_date.
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
    'title',c.title,
    'body',c.body,
    'payload',c.payload,
    'status',c.status,
    'recoveryPolicy',c.recovery_policy,
    'availableFrom',c.available_from,
    'expiresAt',c.expires_at,
    'response',c.response,
    'resolvedAt',c.resolved_at
  ) order by
    case c.anchor_kind when 'first_open' then 0 when 'before_task' then 1 when 'after_task' then 2 else 3 end,
    coalesce(c.scheduled_at,c.available_from,c.created_at),c.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues c
  where c.farm_id=p_farm_id
    and c.membership_id=p_membership_id
    and c.service_date=p_day
    and c.status<>'dismissed';

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

create or replace function atlas.worker_day_placed_task_cards_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_allowed boolean:=false;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;

  select exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.user_id=auth.uid()
  ) or exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Worker day access required.' using errcode='42501';
  end if;

  return query
  select card.*
  from atlas.worker_day_task_placements p
  join atlas.tasks task on task.id=p.task_id
  join atlas.v_task_cards card on card.task_id=task.id
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.service_date=p_day
    and p.state='placed'
    and task.status<>'archived'
    and task.assigned_membership_id=p_membership_id
  order by case p.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,p.sort_order,card.created_at;
end;
$$;

grant execute on function atlas.worker_day_placed_task_cards_v1(uuid,uuid,date) to authenticated;

create or replace function atlas.owner_apply_worker_day_edits_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_edits jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_edit jsonb;
  v_kind text;
  v_task_id uuid;
  v_service_date date;
  v_day_window text;
  v_sort_order numeric(12,3);
  v_task atlas.tasks%rowtype;
  v_existing atlas.worker_day_task_placements%rowtype;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_event_kind text;
  v_results jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active target membership required.' using errcode='42501';
  end if;
  if jsonb_typeof(coalesce(p_edits,'[]'::jsonb))<>'array' then
    raise exception 'Edits must be an array.' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_edits,'[]'::jsonb))>100 then
    raise exception 'Too many day edits.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|day_choreography_v1',0));

  for v_edit in select value from jsonb_array_elements(coalesce(p_edits,'[]'::jsonb)) loop
    v_kind:=nullif(v_edit->>'kind','');
    begin
      v_task_id:=nullif(v_edit->>'taskId','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Every day edit needs a valid task id.' using errcode='22023';
    end;
    if v_kind not in ('place','rewindow','reschedule','reorder','return_to_atlas') or v_task_id is null then
      raise exception 'Unsupported day edit.' using errcode='22023';
    end if;

    select * into v_task from atlas.tasks t
    where t.id=v_task_id and t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id;
    if v_task.id is null then
      raise exception 'The selected task is not assigned to this worker.' using errcode='55000';
    end if;

    select * into v_existing from atlas.worker_day_task_placements p where p.task_id=v_task_id;

    if v_kind='return_to_atlas' then
      if v_existing.id is null then
        insert into atlas.worker_day_task_placements(
          organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,
          placement_source,placement_reason,state,owner_actor_user_id
        ) values (
          v_task.organization_id,p_farm_id,p_membership_id,v_task_id,coalesce(v_task.due_date,current_date),'morning',10000,
          'owner','Returned to Atlas by Owner.','returned_to_atlas',auth.uid()
        ) returning * into v_placement;
      else
        update atlas.worker_day_task_placements p
        set state='returned_to_atlas',placement_source='owner',placement_reason='Returned to Atlas by Owner.',owner_actor_user_id=auth.uid(),updated_at=now()
        where p.id=v_existing.id returning * into v_placement;
      end if;
      v_event_kind:='owner_returned_to_atlas';
    else
      begin
        v_service_date:=nullif(v_edit->>'serviceDate','')::date;
      exception when others then
        raise exception 'A valid service date is required.' using errcode='22023';
      end;
      v_day_window:=coalesce(nullif(v_edit->>'dayWindow',''),v_existing.day_window,'morning');
      if v_service_date is null or v_day_window not in ('morning','afternoon','evening') then
        raise exception 'A valid service date and day window are required.' using errcode='22023';
      end if;
      begin
        v_sort_order:=coalesce(nullif(v_edit->>'sortOrder','')::numeric,v_existing.sort_order,10000);
      exception when invalid_text_representation then
        raise exception 'sortOrder must be numeric.' using errcode='22023';
      end;

      if v_existing.id is null then
        insert into atlas.worker_day_task_placements(
          organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,
          placement_source,placement_reason,state,owner_actor_user_id
        ) values (
          v_task.organization_id,p_farm_id,p_membership_id,v_task_id,v_service_date,v_day_window,v_sort_order,
          'owner','Placed by Owner Day Edit.','placed',auth.uid()
        ) returning * into v_placement;
        v_event_kind:='owner_added';
      else
        update atlas.worker_day_task_placements p
        set service_date=v_service_date,day_window=v_day_window,sort_order=v_sort_order,
            placement_source='owner',placement_reason='Adjusted by Owner Day Edit.',state='placed',
            owner_actor_user_id=auth.uid(),updated_at=now()
        where p.id=v_existing.id returning * into v_placement;
        v_event_kind:=case
          when v_kind='rewindow' then 'owner_rewindowed'
          when v_kind='reschedule' then 'owner_rescheduled'
          when v_kind='reorder' then 'owner_reordered'
          else 'owner_added'
        end;
      end if;
    end if;

    insert into atlas.worker_day_task_placement_events(
      organization_id,farm_id,membership_id,task_id,placement_id,event_kind,
      from_service_date,to_service_date,from_day_window,to_day_window,from_sort_order,to_sort_order,
      actor_user_id,metadata
    ) values (
      v_task.organization_id,p_farm_id,p_membership_id,v_task_id,v_placement.id,v_event_kind,
      v_existing.service_date,case when v_placement.state='placed' then v_placement.service_date else null end,
      v_existing.day_window,case when v_placement.state='placed' then v_placement.day_window else null end,
      v_existing.sort_order,case when v_placement.state='placed' then v_placement.sort_order else null end,
      auth.uid(),jsonb_build_object('editKind',v_kind)
    );

    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'taskId',v_task_id,
      'editKind',v_kind,
      'state',v_placement.state,
      'serviceDate',case when v_placement.state='placed' then v_placement.service_date else null end,
      'dayWindow',case when v_placement.state='placed' then v_placement.day_window else null end,
      'sortOrder',case when v_placement.state='placed' then v_placement.sort_order else null end
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','owner_worker_day_edit_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'results',v_results
  );
end;
$$;

grant execute on function atlas.owner_apply_worker_day_edits_api_v1(uuid,uuid,jsonb) to authenticated;
