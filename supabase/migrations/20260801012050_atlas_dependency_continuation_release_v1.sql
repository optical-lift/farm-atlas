begin;

create or replace function atlas.release_ready_task_dependency_continuations_v1(
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
  v_policy atlas.work_release_policies%rowtype;
  v_template atlas.tasks%rowtype;
  v_task_id uuid;
  v_assignee uuid;
  v_parent_task_id uuid;
  v_released integer := 0;
begin
  for v_clock in
    select clock.*
    from atlas.task_dependency_clocks clock
    where clock.state = 'ready'
      and clock.ready_at is not null
      and clock.ready_at <= p_as_of
      and clock.downstream_task_id is null
    order by clock.ready_at, clock.id
    limit v_limit
    for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended('dependency-continuation:' || v_clock.id::text, 0));

    select occurrence.*
    into v_occurrence
    from atlas.planned_work_occurrences occurrence
    where occurrence.id = v_clock.downstream_occurrence_id
    for update;

    if v_occurrence.id is null
      or v_occurrence.released_task_id is not null
      or v_occurrence.state not in ('planned','eligible','failed')
      or v_occurrence.gate_satisfied_at is null
    then
      continue;
    end if;

    select policy.*
    into v_policy
    from atlas.work_release_policies policy
    where policy.id = v_occurrence.release_policy_id
      and policy.active
    for update;

    if v_policy.id is null
      or v_policy.gate_type not in ('predecessor','event','state','composite')
      or coalesce(v_policy.gate_config ->> 'engine', '') <> 'task_dependency_clock_v1'
    then
      raise exception 'Dependency continuation release policy no longer matches the reviewed contract.';
    end if;

    select *
    into v_template
    from jsonb_populate_record(null::atlas.tasks, v_occurrence.task_payload);

    v_assignee := v_template.assigned_membership_id;
    if v_assignee is not null and not exists (
      select 1
      from atlas.farm_memberships membership
      where membership.id = v_assignee
        and membership.farm_id = v_clock.farm_id
        and membership.active = true
    ) then
      raise exception 'Dependency continuation assignee is no longer an active member of the farm.';
    end if;

    v_parent_task_id := case
      when v_template.parent_task_id is not null and exists (
        select 1 from atlas.tasks parent where parent.id = v_template.parent_task_id
      ) then v_template.parent_task_id
      else null
    end;

    insert into atlas.tasks(
      farm_id,
      zone_id,
      title,
      task_type,
      status,
      priority,
      due_date,
      unlock_text,
      blocker_text,
      generated_from,
      generated_from_id,
      note,
      metadata,
      action_key,
      work_class,
      parent_task_id,
      task_series_key,
      engine_instance_key,
      visibility_scope,
      assigned_membership_id,
      assigned_user_id,
      created_by_user_id,
      origin_kind,
      planned_occurrence_id,
      release_policy_id,
      released_at,
      release_reason
    ) values (
      v_clock.farm_id,
      v_template.zone_id,
      v_occurrence.title,
      coalesce(nullif(v_template.task_type, ''), 'general'),
      'open',
      coalesce(nullif(v_template.priority, ''), 'normal'),
      v_occurrence.planned_due_date,
      v_template.unlock_text,
      null,
      coalesce(nullif(v_template.generated_from, ''), 'task_dependency_clock'),
      coalesce(v_template.generated_from_id, v_clock.source_task_id),
      v_template.note,
      coalesce(v_template.metadata, '{}'::jsonb) || jsonb_build_object(
        'released_by', 'release_ready_task_dependency_continuations_v1',
        'dependency_clock_id', v_clock.id,
        'dependency_source_task_id', v_clock.source_task_id,
        'dependency_ready_at', v_clock.ready_at,
        'capacity_class', 'workflow_continuation'
      ),
      v_template.action_key,
      v_template.work_class,
      v_parent_task_id,
      v_template.task_series_key,
      v_template.engine_instance_key,
      case
        when v_assignee is null and v_template.visibility_scope = 'assigned_worker' then 'management'
        else coalesce(v_template.visibility_scope, 'farm_shared')
      end,
      v_assignee,
      v_template.assigned_user_id,
      v_template.created_by_user_id,
      coalesce(v_template.origin_kind, 'generated'),
      v_occurrence.id,
      v_occurrence.release_policy_id,
      p_as_of,
      'dependency_workflow_continuation'
    )
    returning id into v_task_id;

    perform atlas.restore_task_relation_payload_v1(v_task_id, v_occurrence.relation_payload);
    perform atlas.attach_released_task_to_source_v1(v_occurrence.id, v_task_id);

    insert into atlas.work_gate_evaluations(
      farm_id,
      occurrence_id,
      release_policy_id,
      outcome,
      reason,
      gate_snapshot
    ) values (
      v_clock.farm_id,
      v_occurrence.id,
      v_occurrence.release_policy_id,
      'released',
      'Dependency workflow continuation released outside backlog-admission capacity.',
      jsonb_build_object(
        'task_id', v_task_id,
        'dependency_clock_id', v_clock.id,
        'source_task_id', v_clock.source_task_id,
        'ready_at', v_clock.ready_at,
        'capacity_class', 'workflow_continuation'
      )
    );

    v_released := v_released + 1;
  end loop;

  return jsonb_build_object(
    'asOf', p_as_of,
    'releasedContinuations', v_released
  );
end;
$function$;

revoke all on function atlas.release_ready_task_dependency_continuations_v1(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function atlas.release_ready_task_dependency_continuations_v1(timestamptz, integer)
  to service_role;

create or replace function atlas.tick_task_dependency_clocks_v1(
  p_as_of timestamptz default now(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_first jsonb;
  v_continuations jsonb;
  v_second jsonb;
begin
  v_first := atlas.advance_task_dependency_clocks_v1(p_as_of, p_limit);
  v_continuations := atlas.release_ready_task_dependency_continuations_v1(p_as_of, p_limit);
  v_second := atlas.advance_task_dependency_clocks_v1(p_as_of, p_limit);

  return jsonb_build_object(
    'asOf', p_as_of,
    'gateAdvance', v_first,
    'continuationRelease', v_continuations,
    'notificationAdvance', v_second
  );
end;
$function$;

revoke all on function atlas.tick_task_dependency_clocks_v1(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function atlas.tick_task_dependency_clocks_v1(timestamptz, integer)
  to service_role;

do $schedule$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'atlas-task-dependency-clock-v1';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'atlas-task-dependency-clock-v1',
    '*/5 * * * *',
    $command$select atlas.tick_task_dependency_clocks_v1();$command$
  );
end;
$schedule$;

comment on function atlas.release_ready_task_dependency_continuations_v1(timestamptz, integer) is
  'Releases already-started workflow continuations after their dependency clock is ready. This intentionally bypasses backlog-admission ceilings without changing those ceilings or admitting unrelated planned work.';

comment on function atlas.tick_task_dependency_clocks_v1(timestamptz, integer) is
  'Five-minute dependency-clock tick: satisfy elapsed gates, release ready workflow continuations, then enqueue readiness notifications.';

commit;
