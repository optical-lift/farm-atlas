create table if not exists atlas.walkway_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  zone_id uuid references atlas.zones(id) on delete set null,
  object_id uuid not null unique references atlas.growing_objects(id) on delete cascade,
  card_key text not null,
  strategy text not null,
  target_condition text not null default 'clear_passable',
  last_strategy_at timestamptz,
  dieback_interval_seconds integer not null default 604800,
  dieback_review_at timestamptz,
  observed_condition text not null default 'unknown',
  observed_at timestamptz,
  observation_field_log_id uuid references atlas.field_logs(id) on delete set null,
  current_task_id uuid references atlas.tasks(id) on delete set null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, card_key),
  check (length(btrim(card_key)) > 0),
  check (strategy in ('spray', 'mow', 'mulch', 'weed')),
  check (target_condition in ('clear_passable', 'mown_passable', 'mulched_clear', 'weeded_clear')),
  check (dieback_interval_seconds > 0),
  check (observed_condition in ('unknown', 'living_growth', 'mixed_growth', 'dead_growth', 'clear')),
  check ((strategy = 'spray') or dieback_review_at is null),
  check ((observed_at is null) = (observed_condition = 'unknown'))
);

comment on table atlas.walkway_cards is
  'Permanent strategy cards for walkways and other passage objects. They carry strategy, observation, Clock state, and next move without labor-time tracking.';
comment on column atlas.walkway_cards.strategy is
  'Owner-selected passage strategy: spray, mow, mulch, or weed.';
comment on column atlas.walkway_cards.dieback_review_at is
  'For spray strategy, the seven-day Clock opens a review. Time does not claim that growth is physically dead.';
comment on column atlas.walkway_cards.observed_condition is
  'Canonical observed physical condition. Clear-dead-growth work unlocks only from observation, never from elapsed time alone.';

create index if not exists idx_walkway_cards_farm_active
  on atlas.walkway_cards (farm_id, active, card_key);
create index if not exists idx_walkway_cards_clock
  on atlas.walkway_cards (farm_id, dieback_review_at)
  where active and strategy = 'spray';

create or replace function atlas.set_walkway_card_clock_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  if new.strategy = 'spray' and new.last_strategy_at is not null then
    new.dieback_review_at := new.last_strategy_at + make_interval(secs => new.dieback_interval_seconds);
  else
    new.dieback_review_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_walkway_card_clock_v1 on atlas.walkway_cards;
create trigger set_walkway_card_clock_v1
before insert or update of strategy, last_strategy_at, dieback_interval_seconds, observed_condition, observed_at, current_task_id, active, metadata
on atlas.walkway_cards
for each row execute function atlas.set_walkway_card_clock_v1();

alter table atlas.walkway_cards enable row level security;

drop policy if exists walkway_cards_read_v1 on atlas.walkway_cards;
create policy walkway_cards_read_v1
  on atlas.walkway_cards
  for select
  to authenticated
  using (atlas.is_farm_member(farm_id));

revoke all on atlas.walkway_cards from anon;
revoke insert, update, delete on atlas.walkway_cards from authenticated;
grant select on atlas.walkway_cards to authenticated;

create or replace function atlas.walkway_card_state_v1(
  p_card_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_card atlas.walkway_cards%rowtype;
  v_state text;
  v_clock_state text;
  v_next_action text;
  v_next_action_key text;
  v_task_eligible boolean := false;
  v_observation_after_clock boolean := false;
begin
  select card.* into v_card
  from atlas.walkway_cards card
  where card.id = p_card_id and card.active;

  if not found then
    return null;
  end if;

  if not atlas.is_farm_member(v_card.farm_id) then
    raise exception 'This walkway card is outside the current farm membership.' using errcode = '42501';
  end if;

  v_observation_after_clock := v_card.observed_at is not null
    and (v_card.dieback_review_at is null or v_card.observed_at >= v_card.dieback_review_at);

  if v_card.strategy <> 'spray' then
    v_clock_state := 'not_required';
    if v_card.observed_condition = 'clear' then
      v_state := 'maintained';
      v_next_action := 'No recovery move is open.';
      v_next_action_key := null;
    else
      v_state := 'strategy_active';
      v_next_action := case v_card.strategy
        when 'mow' then 'Mow when the passage no longer reads clear.'
        when 'mulch' then 'Refresh mulch when coverage no longer suppresses growth.'
        else 'Weed when living growth interrupts the passage.'
      end;
      v_next_action_key := v_card.strategy;
    end if;
  elsif v_card.last_strategy_at is null then
    v_clock_state := 'not_started';
    v_state := 'needs_strategy_action';
    v_next_action := 'Apply the selected spray strategy before starting the dieback Clock.';
    v_next_action_key := 'spray';
  elsif coalesce(p_as_of, now()) < v_card.dieback_review_at then
    v_clock_state := 'waiting';
    v_state := 'sprayed_waiting_dieback_review';
    v_next_action := 'Wait for the seven-day spray review date.';
    v_next_action_key := null;
  elsif not v_observation_after_clock then
    v_clock_state := 'review_due';
    v_state := 'spray_dieback_review_due';
    v_next_action := 'Check whether the sprayed growth is dead.';
    v_next_action_key := 'check_spray_dieback';
    v_task_eligible := true;
  elsif v_card.observed_condition = 'dead_growth' then
    v_clock_state := 'review_satisfied';
    v_state := 'clear_dead_growth_ready';
    v_next_action := 'Clear dead growth.';
    v_next_action_key := 'clear_dead_growth';
    v_task_eligible := true;
  elsif v_card.observed_condition = 'clear' then
    v_clock_state := 'review_satisfied';
    v_state := 'clear';
    v_next_action := 'No recovery move is open.';
    v_next_action_key := null;
  else
    v_clock_state := 'review_satisfied';
    v_state := 'strategy_review';
    v_next_action := 'Review the walkway strategy; living growth remains.';
    v_next_action_key := 'review_walkway_strategy';
    v_task_eligible := true;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'clockState', v_clock_state,
    'nextAction', v_next_action,
    'nextActionKey', v_next_action_key,
    'taskEligible', v_task_eligible,
    'strategy', v_card.strategy,
    'lastStrategyAt', v_card.last_strategy_at,
    'diebackReviewAt', v_card.dieback_review_at,
    'observedCondition', v_card.observed_condition,
    'observedAt', v_card.observed_at,
    'observationAfterClock', v_observation_after_clock,
    'timeClaimsPhysicalCondition', false,
    'laborTimeTracked', false
  );
end;
$$;

revoke all on function atlas.walkway_card_state_v1(uuid, timestamptz) from public;
grant execute on function atlas.walkway_card_state_v1(uuid, timestamptz) to authenticated;

create or replace function atlas.walkway_cards_v1(
  p_farm_id uuid,
  p_object_key text default null,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_cards jsonb;
begin
  if not atlas.is_farm_member(p_farm_id) then
    raise exception 'This farm is outside the current membership.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cardId', card.id,
    'cardKey', card.card_key,
    'farmId', card.farm_id,
    'zoneId', card.zone_id,
    'zoneKey', zone.stable_key,
    'zoneLabel', zone.label,
    'objectId', object.id,
    'objectKey', object.stable_key,
    'objectLabel', object.label,
    'objectType', object.object_type,
    'strategy', card.strategy,
    'targetCondition', card.target_condition,
    'lastStrategyAt', card.last_strategy_at,
    'diebackIntervalSeconds', card.dieback_interval_seconds,
    'diebackReviewAt', card.dieback_review_at,
    'observedCondition', card.observed_condition,
    'observedAt', card.observed_at,
    'currentTaskId', task.id,
    'currentTaskTitle', task.title,
    'currentTaskStatus', task.status,
    'metadata', card.metadata,
    'derived', atlas.walkway_card_state_v1(card.id, p_as_of)
  ) order by coalesce((object.metadata->>'clock_position')::text, object.sort_order::text), object.label), '[]'::jsonb)
  into v_cards
  from atlas.walkway_cards card
  join atlas.growing_objects object on object.id = card.object_id
  left join atlas.zones zone on zone.id = card.zone_id
  left join atlas.tasks task on task.id = card.current_task_id
  where card.farm_id = p_farm_id
    and card.active
    and (p_object_key is null or object.stable_key = p_object_key);

  return jsonb_build_object(
    'contractVersion', 'walkway_cards_v1',
    'farmId', p_farm_id,
    'asOf', coalesce(p_as_of, now()),
    'cards', v_cards
  );
end;
$$;

revoke all on function atlas.walkway_cards_v1(uuid, text, timestamptz) from public;
grant execute on function atlas.walkway_cards_v1(uuid, text, timestamptz) to authenticated;

create or replace function atlas.record_walkway_observation_v1(
  p_card_id uuid,
  p_condition text,
  p_note text,
  p_observed_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_card atlas.walkway_cards%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_observed_at timestamptz := coalesce(p_observed_at, now());
  v_log_id uuid;
  v_task_id uuid;
  v_task_title text;
  v_assigned_membership_id uuid;
  v_assigned_user_id uuid;
  v_deduplicated boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if p_condition not in ('living_growth', 'mixed_growth', 'dead_growth', 'clear') then
    raise exception 'Unsupported walkway observation condition.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required.' using errcode = '22023';
  end if;

  select card.* into v_card
  from atlas.walkway_cards card
  where card.id = p_card_id and card.active
  for update;
  if not found then
    raise exception 'Walkway card not found.' using errcode = 'P0002';
  end if;

  select object.* into v_object
  from atlas.growing_objects object
  where object.id = v_card.object_id;

  select membership.* into v_membership
  from atlas.farm_memberships membership
  where membership.farm_id = v_card.farm_id
    and membership.user_id = auth.uid()
    and membership.active
  order by case membership.role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1;
  if not found then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;

  insert into atlas.field_logs (
    farm_id, log_date, action_types, summary_sentence, note, created_by, source, metadata,
    actor_user_id, actor_membership_id, actor_role, idempotency_key
  ) values (
    v_card.farm_id,
    (v_observed_at at time zone 'America/Chicago')::date,
    array['observed', 'walkway'],
    format('Observed %s at %s.', replace(p_condition, '_', ' '), v_object.label),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_membership.worker_key,
    'walkway_card',
    jsonb_build_object(
      'walkway_card_id', v_card.id,
      'strategy', v_card.strategy,
      'dieback_review_at', v_card.dieback_review_at,
      'physical_condition_source', 'observation'
    ),
    auth.uid(), v_membership.id, v_membership.role, p_idempotency_key
  )
  on conflict (farm_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_log_id;

  if v_log_id is null then
    select log.id into v_log_id
    from atlas.field_logs log
    where log.farm_id = v_card.farm_id
      and log.idempotency_key = p_idempotency_key;
    v_deduplicated := true;
  end if;

  insert into atlas.field_log_objects (field_log_id, zone_id, object_id, role)
  select v_log_id, v_card.zone_id, v_card.object_id, 'observed'
  where not exists (
    select 1 from atlas.field_log_objects link
    where link.field_log_id = v_log_id and link.object_id = v_card.object_id
  );

  update atlas.walkway_cards
  set observed_condition = p_condition,
      observed_at = v_observed_at,
      observation_field_log_id = v_log_id,
      metadata = metadata || jsonb_build_object(
        'last_observation_note', nullif(btrim(coalesce(p_note, '')), ''),
        'physical_condition_source', 'field_log'
      )
  where id = v_card.id;

  if p_condition = 'dead_growth'
     and v_card.strategy = 'spray'
     and v_card.dieback_review_at is not null
     and v_observed_at >= v_card.dieback_review_at then
    select task.id, task.title into v_task_id, v_task_title
    from atlas.tasks task
    where task.farm_id = v_card.farm_id
      and task.generated_from = 'walkway_card'
      and task.generated_from_id = v_card.id
      and task.action_key = 'clear_dead_growth'
      and task.status in ('open', 'blocked')
    order by task.created_at desc
    limit 1;

    if v_task_id is null then
      select membership.id, membership.user_id
      into v_assigned_membership_id, v_assigned_user_id
      from atlas.farm_memberships membership
      where membership.farm_id = v_card.farm_id
        and membership.active
        and membership.worker_key = 'anna'
      limit 1;

      if v_assigned_membership_id is null then
        v_assigned_membership_id := v_membership.id;
        v_assigned_user_id := v_membership.user_id;
      end if;

      v_task_title := format('Clear dead growth — %s', v_object.label);
      insert into atlas.tasks (
        farm_id, zone_id, title, task_type, status, priority, due_date, unlock_text,
        generated_from, generated_from_id, note, metadata, action_key, work_class,
        visibility_scope, assigned_membership_id, released_at, release_reason,
        organization_id, task_scope, assigned_user_id, created_by_user_id, origin_kind
      ) values (
        v_card.farm_id,
        v_card.zone_id,
        v_task_title,
        'maintenance',
        'open',
        'normal',
        null,
        'Returns the walkway to clear, readable passage after the spray cycle.',
        'walkway_card',
        v_card.id,
        'Dead growth was physically observed after the seven-day spray dieback review opened.',
        jsonb_build_object(
          'task_key', 'walkway_clear_dead_growth_' || v_card.card_key,
          'conditional_work', true,
          'condition_source', 'walkway_card_observation',
          'condition', 'dead_growth_observed_after_dieback_clock',
          'day_denominator_excluded', true,
          'unlocked_outside_day_plan', true,
          'no_labor_time_tracking', true,
          'collection_zone', coalesce((select label from atlas.zones where id = v_card.zone_id), 'Walkway'),
          'display_action', 'Clear dead growth',
          'display_subject', v_object.label,
          'walkway_card_id', v_card.id
        ),
        'clear_dead_growth',
        'maintenance',
        'assigned_worker',
        v_assigned_membership_id,
        v_observed_at,
        'walkway_dead_growth_observed',
        v_card.organization_id,
        'farm_operation',
        v_assigned_user_id,
        auth.uid(),
        'generated'
      ) returning id into v_task_id;

      insert into atlas.task_objects (task_id, object_id, role)
      values (v_task_id, v_card.object_id, 'target')
      on conflict (task_id, object_id) do nothing;
    end if;

    update atlas.walkway_cards set current_task_id = v_task_id where id = v_card.id;
  end if;

  return jsonb_build_object(
    'cardId', v_card.id,
    'fieldLogId', v_log_id,
    'condition', p_condition,
    'observedAt', v_observed_at,
    'taskId', v_task_id,
    'taskTitle', v_task_title,
    'deduplicated', v_deduplicated,
    'derived', atlas.walkway_card_state_v1(v_card.id, v_observed_at)
  );
end;
$$;

revoke all on function atlas.record_walkway_observation_v1(uuid, text, text, timestamptz, text) from public;
grant execute on function atlas.record_walkway_observation_v1(uuid, text, text, timestamptz, text) to authenticated;

with elm as (
  select farm.id as farm_id, farm.organization_id
  from atlas.farms farm
  where farm.stable_key = 'elm_farm'
), walkway_objects as (
  select object.id as object_id, object.zone_id, object.stable_key, object.label
  from atlas.growing_objects object
  join elm on elm.farm_id = object.farm_id
  where object.stable_key in (
    'mg_center_diamond',
    'mg_12_walkway',
    'mg_130_walkway',
    'mg_3_walkway',
    'mg_430_walkway',
    'mg_6_walkway',
    'mg_730_walkway',
    'mg_9_walkway',
    'mg_1030_walkway'
  )
)
insert into atlas.walkway_cards (
  organization_id, farm_id, zone_id, object_id, card_key, strategy, target_condition,
  last_strategy_at, dieback_interval_seconds, observed_condition, observed_at, metadata
)
select
  elm.organization_id,
  elm.farm_id,
  object.zone_id,
  object.object_id,
  'walkway:' || object.stable_key,
  'spray',
  'clear_passable',
  timestamptz '2026-07-15 12:00:00-05',
  604800,
  'dead_growth',
  timestamptz '2026-07-29 12:00:00-05',
  jsonb_build_object(
    'source', 'main_garden_walkway_correction_20260729',
    'strategy_reason', 'Main Garden walkways and center diamond were sufficiently sprayed; dead biomass removal is the next physical step.',
    'physical_condition_source', 'owner_observation',
    'no_labor_time_tracking', true,
    'clock_rule', 'seven_day_spray_dieback_review',
    'time_does_not_claim_physical_condition', true
  )
from elm cross join walkway_objects object
on conflict (object_id) do update
set strategy = excluded.strategy,
    target_condition = excluded.target_condition,
    last_strategy_at = excluded.last_strategy_at,
    dieback_interval_seconds = excluded.dieback_interval_seconds,
    observed_condition = excluded.observed_condition,
    observed_at = excluded.observed_at,
    active = true,
    metadata = atlas.walkway_cards.metadata || excluded.metadata;

with elm as (
  select farm.id as farm_id, farm.organization_id
  from atlas.farms farm where farm.stable_key = 'elm_farm'
), main_garden as (
  select zone.id as zone_id, zone.label
  from atlas.zones zone join elm on elm.farm_id = zone.farm_id
  where zone.stable_key in ('main_garden', 'main_garden_tea_courtyard')
  order by case when zone.stable_key = 'main_garden' then 1 else 2 end
  limit 1
), anna as (
  select membership.id as membership_id, membership.user_id
  from atlas.farm_memberships membership join elm on elm.farm_id = membership.farm_id
  where membership.active and membership.worker_key = 'anna'
  limit 1
), inserted_task as (
  insert into atlas.tasks (
    farm_id, zone_id, title, task_type, status, priority, due_date, unlock_text,
    generated_from, note, metadata, action_key, work_class, visibility_scope,
    assigned_membership_id, released_at, release_reason, organization_id,
    task_scope, assigned_user_id, origin_kind
  )
  select
    elm.farm_id,
    main_garden.zone_id,
    'Clear dead growth — Main Garden walkways + center diamond',
    'maintenance',
    'open',
    'normal',
    null,
    'Returns the Main Garden passages to clear, readable movement after the spray cycle.',
    'walkway_card_collection',
    'The seven-day review opened July 22. Dead biomass was physically observed July 29; elapsed time alone did not release this move.',
    jsonb_build_object(
      'task_key', 'main_garden_clear_dead_growth_after_spray_20260729',
      'conditional_work', true,
      'condition_source', 'walkway_card_observation',
      'condition', 'dead_growth_observed_after_dieback_clock',
      'day_denominator_excluded', true,
      'unlocked_outside_day_plan', true,
      'no_labor_time_tracking', true,
      'collection_zone', 'Main Garden',
      'display_action', 'Clear dead growth',
      'display_subject', 'Main Garden walkways + center diamond',
      'walkway_card_collection', true,
      'walkway_card_keys', (
        select jsonb_agg(card.card_key order by card.card_key)
        from atlas.walkway_cards card
        where card.farm_id = elm.farm_id and card.card_key like 'walkway:mg_%'
      )
    ),
    'clear_dead_growth',
    'maintenance',
    'assigned_worker',
    anna.membership_id,
    timestamptz '2026-07-29 12:00:00-05',
    'walkway_dead_growth_observed',
    elm.organization_id,
    'farm_operation',
    anna.user_id,
    'generated'
  from elm cross join main_garden cross join anna
  where not exists (
    select 1 from atlas.tasks task
    where task.farm_id = elm.farm_id
      and task.metadata->>'task_key' = 'main_garden_clear_dead_growth_after_spray_20260729'
      and task.status in ('open', 'blocked', 'done')
  )
  returning id
), task_row as (
  select id from inserted_task
  union all
  select task.id
  from atlas.tasks task join elm on elm.farm_id = task.farm_id
  where task.metadata->>'task_key' = 'main_garden_clear_dead_growth_after_spray_20260729'
  order by id
  limit 1
), linked as (
  insert into atlas.task_objects (task_id, object_id, role)
  select task_row.id, card.object_id, 'target'
  from task_row
  join atlas.walkway_cards card on card.farm_id = (select farm_id from elm)
  where card.card_key like 'walkway:mg_%'
  on conflict (task_id, object_id) do nothing
  returning task_id
)
update atlas.walkway_cards card
set current_task_id = task_row.id,
    metadata = card.metadata || jsonb_build_object('conditional_task_key', 'main_garden_clear_dead_growth_after_spray_20260729')
from task_row
where card.farm_id = (select farm_id from elm)
  and card.card_key like 'walkway:mg_%';
