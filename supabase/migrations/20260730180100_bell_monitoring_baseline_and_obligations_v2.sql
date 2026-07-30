create table if not exists atlas.bell_monitoring_baselines (
  user_id uuid not null references auth.users(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  monitoring_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, farm_id)
);

comment on table atlas.bell_monitoring_baselines is
  'Per-player boundary separating known Atlas gaps at monitoring start from future gaps that should interrupt the player.';

alter table atlas.bell_monitoring_baselines enable row level security;

drop policy if exists bell_monitoring_baselines_read_own on atlas.bell_monitoring_baselines;
create policy bell_monitoring_baselines_read_own
  on atlas.bell_monitoring_baselines for select to authenticated
  using (user_id = auth.uid());

insert into atlas.bell_monitoring_baselines (user_id, farm_id, monitoring_started_at, metadata)
select distinct membership.user_id, membership.farm_id, now(), jsonb_build_object(
  'reason', 'Existing Atlas gaps acknowledged at Bell v2 monitoring start',
  'source', 'bell_v2_migration'
)
from atlas.farm_memberships membership
where membership.active
on conflict (user_id, farm_id) do nothing;

create or replace function atlas.bell_event_obligation_key_v2(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select case
      when event.event_kind in ('rhythm_warning', 'rhythm_due', 'rhythm_failure') then
        'rhythm:' || coalesce(
          nullif(event.payload ->> 'rhythmStateId', ''),
          nullif(event.payload ->> 'rhythm_state_id', ''),
          event.source_id::text,
          event.id::text
        )
      when event.task_id is not null then 'task:' || event.task_id::text
      when nullif(event.payload ->> 'taskId', '') is not null then 'task:' || (event.payload ->> 'taskId')
      when nullif(event.payload #>> '{task,taskId}', '') is not null then 'task:' || (event.payload #>> '{task,taskId}')
      when event.object_id is not null then 'object:' || event.object_id::text || ':' || event.event_kind
      when event.project_id is not null then 'project:' || event.project_id::text || ':' || event.event_kind
      else 'event:' || event.id::text
    end
    from atlas.journal_event_index event
    where event.id = p_event_id
  ), 'event:' || p_event_id::text);
$$;

create or replace function atlas.bell_event_why_v2(
  p_event_id uuid,
  p_effective_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.journal_event_index%rowtype;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;

  if v_event.id is null then
    return 'Atlas recorded a meaningful change connected to work visible to this account.';
  end if;

  if v_event.event_kind = 'rhythm_warning' then
    return 'This rhythm is approaching its next boundary, so Atlas is giving the responsible account time to place the work before it becomes due.';
  end if;
  if v_event.event_kind = 'rhythm_due' then
    return 'Atlas expected this rhythm to renew by now, but no completed work or acceptable observation was recorded.';
  end if;
  if v_event.event_kind = 'rhythm_failure' then
    return 'This rhythm crossed its failure boundary after its last completed work or accepted observation.';
  end if;
  if v_event.event_kind = 'owner_decision' then
    return 'A decision or problem handoff reached the Owner or manager responsible for the next move.';
  end if;
  if v_event.event_kind = 'unlock' then
    return 'A dependency cleared and made a next move available.';
  end if;
  if v_event.event_kind in ('task_result', 'maintenance_result') then
    if v_event.assigned_user_id = p_effective_user_id then
      return 'A result changed work assigned to this account.';
    end if;
    return 'Another player changed work in a farm or project visible to this account.';
  end if;
  if v_event.event_kind = 'production_change' then
    return 'A production state changed in a way Atlas considers meaningful to the selected account.';
  end if;

  return 'Atlas recorded a meaningful change connected to work visible to this account.';
end;
$$;

create or replace function atlas.bell_history_v2(
  p_farm_id uuid,
  p_effective_membership_id uuid default null,
  p_limit integer default 40,
  p_before timestamptz default null
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
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_before timestamptz := coalesce(p_before, now());
  v_last_visit_at timestamptz;
  v_baseline_at timestamptz;
  v_since_at timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_badge_count integer := 0;
  v_unread_count integer := 0;
  v_while_away_count integer := 0;
  v_baseline_count integer := 0;
  v_baseline_due_count integer := 0;
  v_baseline_failure_count integer := 0;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  insert into atlas.bell_monitoring_baselines (user_id, farm_id, monitoring_started_at, metadata)
  values (v_user_id, p_farm_id, now(), jsonb_build_object(
    'reason', 'First Bell v2 visit established the future-gap monitoring boundary',
    'source', 'bell_history_v2'
  ))
  on conflict (user_id, farm_id) do nothing;

  select baseline.monitoring_started_at into v_baseline_at
  from atlas.bell_monitoring_baselines baseline
  where baseline.user_id = v_user_id and baseline.farm_id = p_farm_id;

  select visit.last_visited_at into v_last_visit_at
  from atlas.bell_visit_state visit
  where visit.user_id = v_user_id and visit.farm_id = p_farm_id;

  v_since_at := greatest(coalesce(v_last_visit_at, v_baseline_at), v_baseline_at);

  with eligible as (
    select
      event.*,
      receipt.read_at,
      receipt.acknowledged_at,
      atlas.bell_event_requires_action_v1(event.id, v_user_id) as requires_action,
      atlas.bell_event_deep_link_v1(event.id) as deep_link,
      atlas.bell_event_obligation_key_v2(event.id) as obligation_key,
      atlas.bell_event_why_v2(event.id, v_user_id) as why
    from atlas.journal_event_index event
    left join atlas.bell_event_receipts receipt
      on receipt.journal_event_id = event.id and receipt.user_id = v_user_id
    where event.farm_id = p_farm_id
      and event.occurred_at <= v_before
      and atlas.bell_event_is_worthy_v1(event.id)
      and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
  ), latest as (
    select distinct on (eligible.obligation_key) eligible.*
    from eligible
    order by eligible.obligation_key, eligible.occurred_at desc, eligible.id desc
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
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
        'unread', item.read_at is null and item.occurred_at > v_baseline_at,
        'acknowledged', item.acknowledged_at is not null,
        'requiresAction', item.requires_action,
        'whileAway', item.occurred_at > v_since_at,
        'baseline', item.occurred_at <= v_baseline_at,
        'obligationKey', item.obligation_key,
        'section', case
          when item.event_kind in ('rhythm_warning', 'rhythm_due', 'rhythm_failure') then 'rhythms'
          when item.requires_action then 'needs_you'
          else 'farm_movement'
        end,
        'why', item.why,
        'payload', item.payload
      ) order by item.occurred_at desc, item.id desc)
      from (
        select latest.*
        from latest
        order by latest.occurred_at desc, latest.id desc
        limit v_limit
      ) item
    ), '[]'::jsonb),
    (select count(*)::integer from latest item
      where item.occurred_at > v_baseline_at and item.read_at is null),
    (select count(*)::integer from latest item
      where item.occurred_at > v_baseline_at
        and item.requires_action
        and item.acknowledged_at is null),
    (select count(*)::integer from latest item
      where item.occurred_at > v_since_at and item.requires_action),
    (select count(*)::integer from latest item
      where item.occurred_at <= v_baseline_at and item.requires_action),
    (select count(*)::integer from latest item
      where item.occurred_at <= v_baseline_at and item.requires_action and item.event_kind = 'rhythm_due'),
    (select count(*)::integer from latest item
      where item.occurred_at <= v_baseline_at and item.requires_action and item.event_kind = 'rhythm_failure')
  into v_items, v_unread_count, v_badge_count, v_while_away_count,
       v_baseline_count, v_baseline_due_count, v_baseline_failure_count;

  return jsonb_build_object(
    'contractVersion', 'atlas_bell_v2',
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
    'baselineSummary', jsonb_build_object(
      'startedAt', v_baseline_at,
      'totalCount', v_baseline_count,
      'dueCount', v_baseline_due_count,
      'failureCount', v_baseline_failure_count,
      'label', 'Existing Atlas gaps at monitoring start'
    ),
    'items', v_items,
    'eventTruth', 'journal_event_index',
    'receiptTruth', 'bell_event_receipts',
    'obligationTruth', 'latest_worthy_event_per_obligation'
  );
end;
$$;

grant execute on function atlas.bell_history_v2(uuid, uuid, integer, timestamptz) to authenticated;
grant execute on function atlas.bell_event_obligation_key_v2(uuid) to authenticated;
grant execute on function atlas.bell_event_why_v2(uuid, uuid) to authenticated;
