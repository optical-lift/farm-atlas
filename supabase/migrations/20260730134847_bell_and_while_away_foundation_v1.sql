-- Build 8: in-app Bell and while-away foundation.
-- Bell entries remain projections of canonical Journal events. These tables store only
-- per-player read/acknowledgement and visit state; they do not duplicate farm events.

create table if not exists atlas.bell_event_receipts (
  journal_event_id uuid not null references atlas.journal_event_index(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (journal_event_id, user_id),
  check (acknowledged_at is null or read_at is not null)
);

comment on table atlas.bell_event_receipts is
  'Per-player read and acknowledgement state for canonical Journal events. The Journal event remains the only event truth.';

create index if not exists bell_event_receipts_user_idx
  on atlas.bell_event_receipts(user_id, acknowledged_at, read_at, updated_at desc);

create table if not exists atlas.bell_visit_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  previous_visited_at timestamptz,
  last_visited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, farm_id)
);

comment on table atlas.bell_visit_state is
  'Per-player farm visit boundary used to prepare While You Were Away without changing or hiding underlying Journal events.';

create index if not exists bell_visit_state_farm_idx
  on atlas.bell_visit_state(farm_id, last_visited_at desc);

alter table atlas.bell_event_receipts enable row level security;
alter table atlas.bell_visit_state enable row level security;

drop policy if exists bell_event_receipts_read_own on atlas.bell_event_receipts;
create policy bell_event_receipts_read_own
  on atlas.bell_event_receipts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists bell_visit_state_read_own on atlas.bell_visit_state;
create policy bell_visit_state_read_own
  on atlas.bell_visit_state for select to authenticated
  using (user_id = auth.uid());

create or replace function atlas.bell_effective_member_v1(
  p_farm_id uuid,
  p_effective_membership_id uuid default null
)
returns table (
  effective_user_id uuid,
  effective_membership_id uuid,
  effective_role text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_member atlas.farm_memberships%rowtype;
begin
  if v_actor_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if p_effective_membership_id is null then
    select membership.* into v_member
    from atlas.farm_memberships membership
    where membership.farm_id = p_farm_id
      and membership.user_id = v_actor_user_id
      and membership.active
    order by case membership.role when 'owner' then 0 when 'manager' then 1 else 2 end,
             membership.created_at
    limit 1;
  else
    if not exists (
      select 1
      from atlas.farm_memberships owner_membership
      where owner_membership.farm_id = p_farm_id
        and owner_membership.user_id = v_actor_user_id
        and owner_membership.role = 'owner'
        and owner_membership.active
    ) then
      raise exception 'Owner membership is required to operate another farm account.' using errcode = '42501';
    end if;

    select membership.* into v_member
    from atlas.farm_memberships membership
    where membership.id = p_effective_membership_id
      and membership.farm_id = p_farm_id
      and membership.active;
  end if;

  if v_member.id is null then
    raise exception 'An active membership is required for this Bell.' using errcode = '42501';
  end if;

  return query select v_member.user_id, v_member.id, v_member.role;
end;
$$;

create or replace function atlas.bell_can_read_event_as_v1(
  p_event_id uuid,
  p_farm_id uuid,
  p_effective_membership_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_event atlas.journal_event_index%rowtype;
  v_user_id uuid;
  v_membership_id uuid;
  v_role text;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id
    and event.farm_id = p_farm_id;

  if v_event.id is null then return false; end if;

  return case v_event.visibility_scope
    when 'owner' then v_role = 'owner'
    when 'management' then v_role in ('owner', 'manager')
    when 'assigned_worker' then v_role in ('owner', 'manager') or v_event.assigned_user_id = v_user_id
    when 'project_shared' then v_role in ('owner', 'manager') or (
      v_event.project_id is not null and exists (
        select 1 from atlas.project_contributors contributor
        where contributor.project_id = v_event.project_id
          and contributor.user_id = v_user_id
          and contributor.active
      )
    )
    when 'system_internal' then v_role = 'owner'
    else true
  end;
end;
$$;

create or replace function atlas.bell_event_is_worthy_v1(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select event.importance in ('attention', 'critical')
      or event.event_kind in (
        'rhythm_warning', 'rhythm_due', 'rhythm_failure',
        'unlock', 'production_change', 'owner_decision',
        'task_result', 'maintenance_result'
      )
    from atlas.journal_event_index event
    where event.id = p_event_id
  ), false);
$$;

create or replace function atlas.bell_event_requires_action_v1(
  p_event_id uuid,
  p_effective_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.journal_event_index%rowtype;
  v_rhythm_state_id uuid;
  v_rhythm_state text;
  v_task_id uuid;
  v_task_status text;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;
  if v_event.id is null then return false; end if;

  if v_event.event_kind in ('rhythm_due', 'rhythm_failure') then
    v_rhythm_state_id := atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'rhythmStateId');
    if v_rhythm_state_id is not null then
      select state into v_rhythm_state
      from atlas.rhythm_state
      where id = v_rhythm_state_id;
      if v_rhythm_state in ('due', 'fallen_out_of_rhythm', 'recovering') then
        return true;
      end if;
    end if;
  end if;

  v_task_id := coalesce(
    v_event.task_id,
    atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
    atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
  );
  if v_task_id is not null then
    select status into v_task_status from atlas.tasks where id = v_task_id;
    if v_task_status in ('open', 'blocked') and (
      v_event.event_kind in ('owner_decision', 'rhythm_due', 'rhythm_failure')
      or v_event.importance in ('attention', 'critical')
      or v_event.assigned_user_id = p_effective_user_id
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create or replace function atlas.bell_event_deep_link_v1(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.journal_event_index%rowtype;
  v_object_id uuid;
  v_object_key text;
  v_task_id uuid;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;
  if v_event.id is null then return '/bell'; end if;

  v_task_id := coalesce(
    v_event.task_id,
    atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
    atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
  );
  if v_task_id is not null then
    return '/task-focus/' || v_task_id::text || '?returnTo=%2Fbell';
  end if;

  if v_event.project_id is not null then
    return '/project/' || v_event.project_id::text;
  end if;

  v_object_id := coalesce(
    v_event.object_id,
    case when v_event.payload ->> 'subjectKind' = 'growing_object'
      then atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'subjectId') else null end
  );
  if v_object_id is not null then
    select stable_key into v_object_key from atlas.growing_objects where id = v_object_id;
    if v_object_key is not null then
      return '/objects/' || v_object_key;
    end if;
  end if;

  return '/journal?date=' || v_event.journal_date::text || '#event-' || v_event.id::text;
end;
$$;

create or replace function atlas.bell_history_v1(
  p_farm_id uuid,
  p_effective_membership_id uuid default null,
  p_limit integer default 40,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_role text;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_before timestamptz := coalesce(p_before, now());
  v_last_visit_at timestamptz;
  v_since_at timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_badge_count integer := 0;
  v_unread_count integer := 0;
  v_while_away_count integer := 0;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  select visit.last_visited_at into v_last_visit_at
  from atlas.bell_visit_state visit
  where visit.user_id = v_user_id and visit.farm_id = p_farm_id;
  v_since_at := coalesce(v_last_visit_at, now() - interval '24 hours');

  with candidate as (
    select
      event.*,
      receipt.read_at,
      receipt.acknowledged_at,
      atlas.bell_event_requires_action_v1(event.id, v_user_id) as requires_action,
      atlas.bell_event_deep_link_v1(event.id) as deep_link
    from atlas.journal_event_index event
    left join atlas.bell_event_receipts receipt
      on receipt.journal_event_id = event.id and receipt.user_id = v_user_id
    where event.farm_id = p_farm_id
      and event.occurred_at <= v_before
      and atlas.bell_event_is_worthy_v1(event.id)
      and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    order by event.occurred_at desc, event.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', item.id,
    'eventKey', item.event_key,
    'eventKind', item.event_kind,
    'sourceKind', item.source_kind,
    'sourceId', item.source_id,
    'sourceEvent', item.source_event,
    'title', item.title,
    'detail', item.detail,
    'occurredAt', item.occurred_at,
    'journalDate', item.journal_date,
    'importance', item.importance,
    'symbol', case item.event_kind
      when 'rhythm_failure' then '!'
      when 'rhythm_due' then '!'
      when 'rhythm_warning' then '~'
      when 'unlock' then '◆'
      when 'owner_decision' then '?'
      when 'task_result' then '✓'
      else '–' end,
    'deepLink', item.deep_link,
    'taskId', item.task_id,
    'objectId', item.object_id,
    'projectId', item.project_id,
    'trailBindingId', item.trail_binding_id,
    'unread', item.read_at is null,
    'acknowledged', item.acknowledged_at is not null,
    'requiresAction', item.requires_action,
    'whileAway', item.occurred_at > v_since_at,
    'payload', item.payload
  ) order by item.occurred_at desc, item.id desc), '[]'::jsonb)
  into v_items
  from candidate item;

  select count(*)::integer into v_unread_count
  from atlas.journal_event_index event
  left join atlas.bell_event_receipts receipt
    on receipt.journal_event_id = event.id and receipt.user_id = v_user_id
  where event.farm_id = p_farm_id
    and atlas.bell_event_is_worthy_v1(event.id)
    and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    and receipt.read_at is null;

  select count(*)::integer into v_badge_count
  from atlas.journal_event_index event
  left join atlas.bell_event_receipts receipt
    on receipt.journal_event_id = event.id and receipt.user_id = v_user_id
  where event.farm_id = p_farm_id
    and atlas.bell_event_is_worthy_v1(event.id)
    and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    and receipt.acknowledged_at is null
    and atlas.bell_event_requires_action_v1(event.id, v_user_id);

  select count(*)::integer into v_while_away_count
  from atlas.journal_event_index event
  where event.farm_id = p_farm_id
    and event.occurred_at > v_since_at
    and event.occurred_at <= v_before
    and atlas.bell_event_is_worthy_v1(event.id)
    and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id);

  return jsonb_build_object(
    'contractVersion', 'atlas_bell_v1',
    'farmId', p_farm_id,
    'effectiveUserId', v_user_id,
    'effectiveMembershipId', v_membership_id,
    'effectiveRole', v_role,
    'preparedAt', now(),
    'lastVisitAt', v_last_visit_at,
    'whileAwaySinceAt', v_since_at,
    'whileAwayCount', v_while_away_count,
    'unreadCount', v_unread_count,
    'badgeCount', v_badge_count,
    'items', v_items,
    'eventTruth', 'journal_event_index',
    'receiptTruth', 'bell_event_receipts'
  );
end;
$$;

create or replace function atlas.mark_bell_event_v1(
  p_farm_id uuid,
  p_event_id uuid,
  p_action text,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_role text;
  v_now timestamptz := now();
begin
  if p_action not in ('read', 'acknowledge') then
    raise exception 'Bell action must be read or acknowledge.' using errcode = '22023';
  end if;

  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  if not atlas.bell_can_read_event_as_v1(p_event_id, p_farm_id, p_effective_membership_id) then
    raise exception 'This Bell event is not available to the selected account.' using errcode = '42501';
  end if;

  insert into atlas.bell_event_receipts(
    journal_event_id, user_id, read_at, acknowledged_at, updated_at
  ) values (
    p_event_id,
    v_user_id,
    v_now,
    case when p_action = 'acknowledge' then v_now else null end,
    v_now
  )
  on conflict (journal_event_id, user_id) do update
  set read_at = coalesce(atlas.bell_event_receipts.read_at, excluded.read_at),
      acknowledged_at = case when p_action = 'acknowledge'
        then coalesce(atlas.bell_event_receipts.acknowledged_at, excluded.acknowledged_at)
        else atlas.bell_event_receipts.acknowledged_at end,
      updated_at = v_now;

  return jsonb_build_object(
    'eventId', p_event_id,
    'userId', v_user_id,
    'action', p_action,
    'recordedAt', v_now
  );
end;
$$;

create or replace function atlas.record_bell_visit_v1(
  p_farm_id uuid,
  p_seen_through timestamptz default null,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_role text;
  v_seen_through timestamptz := least(coalesce(p_seen_through, now()), now());
  v_previous timestamptz;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  select last_visited_at into v_previous
  from atlas.bell_visit_state
  where user_id = v_user_id and farm_id = p_farm_id;

  insert into atlas.bell_visit_state(
    user_id, farm_id, previous_visited_at, last_visited_at, updated_at
  ) values (
    v_user_id, p_farm_id, v_previous, v_seen_through, now()
  )
  on conflict (user_id, farm_id) do update
  set previous_visited_at = atlas.bell_visit_state.last_visited_at,
      last_visited_at = greatest(coalesce(atlas.bell_visit_state.last_visited_at, '-infinity'::timestamptz), excluded.last_visited_at),
      updated_at = now();

  return jsonb_build_object(
    'userId', v_user_id,
    'farmId', p_farm_id,
    'previousVisitAt', v_previous,
    'lastVisitAt', v_seen_through
  );
end;
$$;

revoke all on table atlas.bell_event_receipts from public, anon;
revoke all on table atlas.bell_visit_state from public, anon;
grant select on table atlas.bell_event_receipts to authenticated, service_role;
grant select on table atlas.bell_visit_state to authenticated, service_role;

revoke all on function atlas.bell_effective_member_v1(uuid,uuid) from public;
revoke all on function atlas.bell_can_read_event_as_v1(uuid,uuid,uuid) from public;
revoke all on function atlas.bell_event_is_worthy_v1(uuid) from public;
revoke all on function atlas.bell_event_requires_action_v1(uuid,uuid) from public;
revoke all on function atlas.bell_event_deep_link_v1(uuid) from public;
revoke all on function atlas.bell_history_v1(uuid,uuid,integer,timestamptz) from public;
revoke all on function atlas.mark_bell_event_v1(uuid,uuid,text,uuid) from public;
revoke all on function atlas.record_bell_visit_v1(uuid,timestamptz,uuid) from public;

grant execute on function atlas.bell_history_v1(uuid,uuid,integer,timestamptz) to authenticated, service_role;
grant execute on function atlas.mark_bell_event_v1(uuid,uuid,text,uuid) to authenticated, service_role;
grant execute on function atlas.record_bell_visit_v1(uuid,timestamptz,uuid) to authenticated, service_role;
