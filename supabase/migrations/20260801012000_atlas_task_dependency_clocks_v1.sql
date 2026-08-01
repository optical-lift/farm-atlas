begin;

create table if not exists atlas.task_dependency_clocks (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  source_task_id uuid not null references atlas.tasks(id) on delete cascade,
  downstream_occurrence_id uuid not null references atlas.planned_work_occurrences(id) on delete cascade,
  source_transitions text[] not null default array['done']::text[],
  source_result_path text[],
  source_result_equals jsonb,
  delay_interval interval not null default interval '0 seconds',
  state text not null default 'waiting',
  source_transition_id uuid references atlas.task_transitions(id) on delete set null,
  source_satisfied_at timestamptz,
  ready_at timestamptz,
  downstream_task_id uuid references atlas.tasks(id) on delete set null,
  released_at timestamptz,
  initial_notified_at timestamptz,
  followup_notified_at timestamptz,
  notification_policy jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_dependency_clocks_downstream_occurrence_key unique (downstream_occurrence_id),
  constraint task_dependency_clocks_state_check check (state = any (array['waiting','counting','ready','released','completed','cancelled']::text[])),
  constraint task_dependency_clocks_transition_check check (
    cardinality(source_transitions) > 0
    and source_transitions <@ array['done','checklist_done']::text[]
  ),
  constraint task_dependency_clocks_result_gate_check check (
    (source_result_path is null and source_result_equals is null)
    or (cardinality(source_result_path) > 0 and source_result_equals is not null)
  ),
  constraint task_dependency_clocks_delay_check check (
    delay_interval >= interval '0 seconds'
    and delay_interval <= interval '30 days'
  )
);

create index if not exists task_dependency_clocks_source_waiting_idx
  on atlas.task_dependency_clocks(source_task_id, state)
  where state in ('waiting','counting','ready');

create index if not exists task_dependency_clocks_ready_idx
  on atlas.task_dependency_clocks(ready_at, state)
  where state in ('counting','ready');

create index if not exists task_dependency_clocks_downstream_task_idx
  on atlas.task_dependency_clocks(downstream_task_id)
  where downstream_task_id is not null;

alter table atlas.task_dependency_clocks enable row level security;
revoke all on table atlas.task_dependency_clocks from public, anon, authenticated;
grant select, insert, update, delete on table atlas.task_dependency_clocks to service_role;

create or replace function atlas.validate_task_dependency_clock_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_source_farm_id uuid;
  v_occurrence_farm_id uuid;
  v_occurrence_state text;
  v_released_task_id uuid;
  v_gate_type text;
begin
  select task.farm_id
  into v_source_farm_id
  from atlas.tasks task
  where task.id = new.source_task_id;

  if v_source_farm_id is null or v_source_farm_id is distinct from new.farm_id then
    raise exception 'Dependency clock source task must belong to the selected farm.' using errcode = '23514';
  end if;

  select occurrence.farm_id, occurrence.state, occurrence.released_task_id, policy.gate_type
  into v_occurrence_farm_id, v_occurrence_state, v_released_task_id, v_gate_type
  from atlas.planned_work_occurrences occurrence
  join atlas.work_release_policies policy on policy.id = occurrence.release_policy_id
  where occurrence.id = new.downstream_occurrence_id;

  if v_occurrence_farm_id is null or v_occurrence_farm_id is distinct from new.farm_id then
    raise exception 'Dependency clock downstream occurrence must belong to the selected farm.' using errcode = '23514';
  end if;

  if v_gate_type not in ('predecessor','event','state','composite') then
    raise exception 'Dependency clock downstream occurrence must use a gated release policy.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and (v_occurrence_state not in ('planned','eligible','failed') or v_released_task_id is not null) then
    raise exception 'Dependency clock downstream occurrence has already been released or closed.' using errcode = '23514';
  end if;

  if new.state = 'waiting' and (
    new.source_transition_id is not null
    or new.source_satisfied_at is not null
    or new.ready_at is not null
    or new.downstream_task_id is not null
    or new.released_at is not null
  ) then
    raise exception 'A waiting dependency clock cannot contain release timestamps or a downstream task.' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function atlas.validate_task_dependency_clock_v1() from public, anon, authenticated;
grant execute on function atlas.validate_task_dependency_clock_v1() to service_role;

drop trigger if exists validate_task_dependency_clock_v1 on atlas.task_dependency_clocks;
create trigger validate_task_dependency_clock_v1
before insert or update on atlas.task_dependency_clocks
for each row execute function atlas.validate_task_dependency_clock_v1();

create or replace function atlas.advance_task_dependency_clocks_v1(
  p_as_of timestamptz default now(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_clock atlas.task_dependency_clocks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_task atlas.tasks%rowtype;
  v_timezone text;
  v_user_id uuid;
  v_outbox_id uuid;
  v_notifications_enabled boolean;
  v_category_enabled boolean;
  v_followup_minutes integer;
  v_released integer := 0;
  v_waiting_capacity integer := 0;
  v_initial_notifications integer := 0;
  v_followup_notifications integer := 0;
begin
  for v_clock in
    select clock.*
    from atlas.task_dependency_clocks clock
    where clock.state in ('counting','ready')
      and clock.ready_at is not null
      and clock.ready_at <= p_as_of
    order by clock.ready_at, clock.id
    limit v_limit
    for update skip locked
  loop
    select occurrence.*
    into v_occurrence
    from atlas.planned_work_occurrences occurrence
    where occurrence.id = v_clock.downstream_occurrence_id
    for update;

    if v_occurrence.id is null or v_occurrence.state in ('completed','cancelled') then
      update atlas.task_dependency_clocks
      set state = 'cancelled',
          metadata = metadata || jsonb_build_object(
            'cancelled_reason', 'downstream_occurrence_closed',
            'cancelled_at', p_as_of
          ),
          updated_at = p_as_of
      where id = v_clock.id;
      continue;
    end if;

    if v_occurrence.gate_satisfied_at is null then
      update atlas.planned_work_occurrences
      set state = case when state = 'failed' then 'eligible' else state end,
          gate_satisfied_at = v_clock.ready_at,
          metadata = metadata || jsonb_build_object(
            'dependency_clock_id', v_clock.id,
            'dependency_clock_state', 'ready',
            'dependency_source_task_id', v_clock.source_task_id,
            'dependency_ready_at', v_clock.ready_at
          ),
          updated_at = p_as_of
      where id = v_occurrence.id;

      insert into atlas.work_gate_evaluations(
        farm_id, occurrence_id, release_policy_id, outcome, reason, gate_snapshot
      ) values (
        v_clock.farm_id,
        v_occurrence.id,
        v_occurrence.release_policy_id,
        'gate_satisfied',
        'Task dependency clock elapsed.',
        jsonb_build_object(
          'dependency_clock_id', v_clock.id,
          'source_task_id', v_clock.source_task_id,
          'source_transition_id', v_clock.source_transition_id,
          'source_satisfied_at', v_clock.source_satisfied_at,
          'ready_at', v_clock.ready_at,
          'delay_seconds', extract(epoch from v_clock.delay_interval)::integer
        )
      );
    end if;

    update atlas.task_dependency_clocks
    set state = 'ready', updated_at = p_as_of
    where id = v_clock.id and state = 'counting';

    select coalesce(settings.timezone_name, 'America/Chicago')
    into v_timezone
    from atlas.farm_task_release_settings settings
    where settings.farm_id = v_clock.farm_id;
    v_timezone := coalesce(v_timezone, 'America/Chicago');

    perform atlas.release_eligible_work_v1(
      v_clock.farm_id,
      (p_as_of at time zone v_timezone)::date,
      10
    );

    select occurrence.*
    into v_occurrence
    from atlas.planned_work_occurrences occurrence
    where occurrence.id = v_clock.downstream_occurrence_id;

    if v_occurrence.released_task_id is null then
      v_waiting_capacity := v_waiting_capacity + 1;
      continue;
    end if;

    select task.*
    into v_task
    from atlas.tasks task
    where task.id = v_occurrence.released_task_id;

    update atlas.task_dependency_clocks
    set state = 'released',
        downstream_task_id = v_occurrence.released_task_id,
        released_at = coalesce(v_occurrence.released_at, p_as_of),
        metadata = metadata || jsonb_build_object(
          'released_task_id', v_occurrence.released_task_id,
          'released_at', coalesce(v_occurrence.released_at, p_as_of)
        ),
        updated_at = p_as_of
    where id = v_clock.id;

    update atlas.planned_work_occurrences
    set metadata = metadata || jsonb_build_object(
      'dependency_clock_state', 'released',
      'dependency_released_task_id', v_occurrence.released_task_id
    ),
    updated_at = p_as_of
    where id = v_occurrence.id;

    v_released := v_released + 1;

    v_user_id := coalesce(
      v_task.assigned_user_id,
      (
        select membership.user_id
        from atlas.farm_memberships membership
        where membership.id = v_task.assigned_membership_id
          and membership.active = true
      )
    );

    if v_user_id is not null
      and coalesce((v_clock.notification_policy ->> 'notify_when_ready')::boolean, true)
    then
      select coalesce(preference.enabled, true),
             coalesce((preference.categories ->> 'dependency_ready')::boolean, true)
      into v_notifications_enabled, v_category_enabled
      from (select 1) seed
      left join atlas.notification_preferences preference
        on preference.user_id = v_user_id
       and preference.farm_id = v_clock.farm_id;

      if v_notifications_enabled and v_category_enabled then
        v_outbox_id := atlas.enqueue_direct_push_v1(
          v_clock.farm_id,
          v_user_id,
          'dependency_ready',
          coalesce(nullif(v_clock.notification_policy ->> 'ready_title', ''), v_task.title || ' is ready'),
          coalesce(nullif(v_clock.notification_policy ->> 'ready_body', ''), v_task.title || ' is ready to begin.'),
          '/task-focus/' || v_task.id::text || '?returnTo=%2Fwork%2Ftoday',
          'dependency-clock:' || v_clock.id::text || ':ready',
          coalesce(nullif(v_clock.notification_policy ->> 'importance', ''), 'normal'),
          atlas.notification_next_available_at_v1(v_user_id, v_clock.farm_id, p_as_of),
          jsonb_build_object(
            'dependencyClockId', v_clock.id,
            'sourceTaskId', v_clock.source_task_id,
            'taskId', v_task.id,
            'readyAt', v_clock.ready_at,
            'kind', 'dependency_ready'
          )
        );

        if v_outbox_id is not null then
          update atlas.task_dependency_clocks
          set initial_notified_at = p_as_of, updated_at = p_as_of
          where id = v_clock.id;
          v_initial_notifications := v_initial_notifications + 1;
        end if;
      end if;
    end if;
  end loop;

  for v_clock in
    select clock.*
    from atlas.task_dependency_clocks clock
    join atlas.tasks task on task.id = clock.downstream_task_id
    where clock.state = 'released'
      and clock.initial_notified_at is not null
      and clock.followup_notified_at is null
      and task.status in ('open','blocked')
      and coalesce(clock.notification_policy ->> 'followup_after_minutes', '') ~ '^\d+$'
      and p_as_of >= clock.initial_notified_at
        + make_interval(mins => (clock.notification_policy ->> 'followup_after_minutes')::integer)
      and not exists (
        select 1
        from atlas.task_transitions transition
        where transition.task_id = task.id
          and transition.created_at > coalesce(clock.released_at, clock.initial_notified_at)
      )
    order by clock.initial_notified_at, clock.id
    limit v_limit
    for update of clock skip locked
  loop
    select task.* into v_task from atlas.tasks task where task.id = v_clock.downstream_task_id;
    v_user_id := coalesce(
      v_task.assigned_user_id,
      (
        select membership.user_id
        from atlas.farm_memberships membership
        where membership.id = v_task.assigned_membership_id
          and membership.active = true
      )
    );

    if v_user_id is null then
      continue;
    end if;

    v_outbox_id := atlas.enqueue_direct_push_v1(
      v_clock.farm_id,
      v_user_id,
      'dependency_ready',
      coalesce(nullif(v_clock.notification_policy ->> 'followup_title', ''), 'Still waiting: ' || v_task.title),
      coalesce(nullif(v_clock.notification_policy ->> 'followup_body', ''), v_task.title || ' is ready and has not been started.'),
      '/task-focus/' || v_task.id::text || '?returnTo=%2Fwork%2Ftoday',
      'dependency-clock:' || v_clock.id::text || ':followup',
      coalesce(nullif(v_clock.notification_policy ->> 'importance', ''), 'normal'),
      atlas.notification_next_available_at_v1(v_user_id, v_clock.farm_id, p_as_of),
      jsonb_build_object(
        'dependencyClockId', v_clock.id,
        'sourceTaskId', v_clock.source_task_id,
        'taskId', v_task.id,
        'readyAt', v_clock.ready_at,
        'kind', 'dependency_ready_followup'
      )
    );

    if v_outbox_id is not null then
      update atlas.task_dependency_clocks
      set followup_notified_at = p_as_of, updated_at = p_as_of
      where id = v_clock.id;
      v_followup_notifications := v_followup_notifications + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'asOf', p_as_of,
    'released', v_released,
    'waitingForCapacity', v_waiting_capacity,
    'initialNotifications', v_initial_notifications,
    'followupNotifications', v_followup_notifications
  );
end;
$function$;

revoke all on function atlas.advance_task_dependency_clocks_v1(timestamptz, integer) from public, anon, authenticated;
grant execute on function atlas.advance_task_dependency_clocks_v1(timestamptz, integer) to service_role;

create or replace function atlas.start_task_dependency_clocks_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_started integer := 0;
begin
  update atlas.task_dependency_clocks clock
  set state = 'counting',
      source_transition_id = new.id,
      source_satisfied_at = new.created_at,
      ready_at = new.created_at + clock.delay_interval,
      metadata = clock.metadata || jsonb_build_object(
        'started_by_transition_id', new.id,
        'started_by_transition', new.transition,
        'started_at', new.created_at,
        'ready_at', new.created_at + clock.delay_interval
      ),
      updated_at = new.created_at
  where clock.source_task_id = new.task_id
    and clock.state = 'waiting'
    and new.transition = any(clock.source_transitions)
    and (
      clock.source_result_path is null
      or new.payload #> clock.source_result_path = clock.source_result_equals
    );

  get diagnostics v_started = row_count;

  if v_started > 0 then
    update atlas.planned_work_occurrences occurrence
    set metadata = occurrence.metadata || jsonb_build_object(
      'dependency_clock_state', 'counting',
      'dependency_source_task_id', new.task_id,
      'dependency_source_transition_id', new.id,
      'dependency_source_satisfied_at', new.created_at,
      'dependency_ready_at', clock.ready_at
    ),
    updated_at = new.created_at
    from atlas.task_dependency_clocks clock
    where clock.source_transition_id = new.id
      and clock.downstream_occurrence_id = occurrence.id;

    perform atlas.advance_task_dependency_clocks_v1(new.created_at, 100);
  end if;

  return new;
end;
$function$;

revoke all on function atlas.start_task_dependency_clocks_v1() from public, anon, authenticated;
grant execute on function atlas.start_task_dependency_clocks_v1() to service_role;

drop trigger if exists start_task_dependency_clocks_v1 on atlas.task_transitions;
create trigger start_task_dependency_clocks_v1
after insert on atlas.task_transitions
for each row execute function atlas.start_task_dependency_clocks_v1();

create or replace function atlas.close_task_dependency_clock_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  if old.status in ('open','blocked') and new.status in ('done','archived','skipped') then
    update atlas.task_dependency_clocks
    set state = case when new.status = 'done' then 'completed' else 'cancelled' end,
        metadata = metadata || jsonb_build_object(
          'downstream_terminal_status', new.status,
          'downstream_terminal_at', coalesce(new.completed_at, now())
        ),
        updated_at = now()
    where downstream_task_id = new.id
      and state = 'released';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.close_task_dependency_clock_v1() from public, anon, authenticated;
grant execute on function atlas.close_task_dependency_clock_v1() to service_role;

drop trigger if exists close_task_dependency_clock_v1 on atlas.tasks;
create trigger close_task_dependency_clock_v1
after update of status on atlas.tasks
for each row
when (old.status is distinct from new.status)
execute function atlas.close_task_dependency_clock_v1();

create or replace function atlas.task_dependency_status_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_result jsonb;
begin
  if p_task_id is null then
    raise exception 'Task id is required.' using errcode = '22023';
  end if;

  if not atlas.can_read_task_in_journal_v1(p_task_id) then
    raise exception 'Task dependency status is not available to this account.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'taskId', p_task_id,
    'dependencies', coalesce(jsonb_agg(jsonb_build_object(
      'clockId', clock.id,
      'direction', case when clock.source_task_id = p_task_id then 'downstream' else 'upstream' end,
      'state', clock.state,
      'sourceTaskId', clock.source_task_id,
      'sourceTaskTitle', source_task.title,
      'downstreamOccurrenceId', clock.downstream_occurrence_id,
      'downstreamTaskId', clock.downstream_task_id,
      'downstreamTitle', coalesce(downstream_task.title, occurrence.title),
      'sourceSatisfiedAt', clock.source_satisfied_at,
      'readyAt', clock.ready_at,
      'releasedAt', clock.released_at,
      'delaySeconds', extract(epoch from clock.delay_interval)::integer,
      'resultGatePath', clock.source_result_path,
      'resultGateEquals', clock.source_result_equals,
      'notificationPolicy', clock.notification_policy
    ) order by clock.created_at, clock.id) filter (where clock.id is not null), '[]'::jsonb)
  )
  into v_result
  from atlas.task_dependency_clocks clock
  join atlas.tasks source_task on source_task.id = clock.source_task_id
  join atlas.planned_work_occurrences occurrence on occurrence.id = clock.downstream_occurrence_id
  left join atlas.tasks downstream_task on downstream_task.id = clock.downstream_task_id
  where clock.source_task_id = p_task_id
     or clock.downstream_task_id = p_task_id;

  return coalesce(v_result, jsonb_build_object('taskId', p_task_id, 'dependencies', '[]'::jsonb));
end;
$function$;

revoke all on function atlas.task_dependency_status_v1(uuid) from public, anon;
grant execute on function atlas.task_dependency_status_v1(uuid) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values (
  'atlas.task_dependency_status_v1(uuid)',
  'app_endpoint',
  'reviewed',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'source', 'dependency_clock_release_build',
    'reviewed_date', '2026-08-01',
    'call_site', 'task transition response',
    'authorization', 'can_read_task_in_journal_v1'
  ),
  now(),
  now()
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  reviewed_at = now();

do $schedule$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'atlas-task-dependency-clock-v1';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'atlas-task-dependency-clock-v1',
    '*/5 * * * *',
    $command$select atlas.advance_task_dependency_clocks_v1();$command$
  );
end;
$schedule$;

comment on table atlas.task_dependency_clocks is
  'Canonical task-result dependency clocks. A source transition starts an elapsed wait; the clock then satisfies a planned-work gate, releases the downstream task, and optionally sends direct push nudges without creating Bell history.';

comment on function atlas.task_dependency_status_v1(uuid) is
  'Authenticated read model for dependency clocks attached to a task. Authorization follows canonical task visibility.';

commit;
