create or replace function atlas.record_rhythm_game_master_satisfaction_v1(
  p_state_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_satisfied_at timestamptz default now(),
  p_renewal_interval_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_workflow_event_id uuid;
  v_satisfaction_id uuid;
  v_satisfaction_key text;
  v_event_key text;
  v_at timestamptz := coalesce(p_satisfied_at, now());
  v_evaluation jsonb;
begin
  select * into v_state
  from atlas.rhythm_state
  where id = p_state_id
  for update;

  if v_state.id is null then
    raise exception 'Rhythm state not found.' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not atlas.is_farm_owner(v_state.farm_id) then
    raise exception 'Only a farm Owner may record a game-master rhythm satisfaction.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Game-master reason and idempotency key are required.' using errcode = '22023';
  end if;
  if p_renewal_interval_seconds is not null and p_renewal_interval_seconds <= 0 then
    raise exception 'Renewal interval must be positive.' using errcode = '22023';
  end if;

  -- Resolve any newly active Rulebook winner before the governed override is linked.
  v_evaluation := atlas.evaluate_rhythm_binding_v1(v_state.id, v_at, 'game_master_precheck');
  select * into v_state from atlas.rhythm_state where id = p_state_id for update;
  if v_state.state = 'paused' then
    raise exception 'A paused rhythm has no active Rulebook lease to satisfy.' using errcode = '22023';
  end if;

  v_event_key := 'rhythm-game-master:' || v_state.id::text || ':' || md5(btrim(p_idempotency_key));
  insert into atlas.workflow_events (
    farm_id, event_key, source_kind, source_id, source_key,
    source_event, event_date, payload, created_at
  ) values (
    v_state.farm_id,
    v_event_key,
    'rhythm_state',
    v_state.id,
    v_state.rhythm_key || ':' || v_state.subject_kind || ':' || v_state.subject_id::text,
    'game_master_satisfaction',
    (v_at at time zone 'America/Chicago')::date,
    jsonb_build_object(
      'rhythm_state_id', v_state.id,
      'rhythm_binding_id', v_state.rhythm_binding_id,
      'rhythm_rule_id', v_state.rhythm_rule_id,
      'reason', btrim(p_reason),
      'actor_user_id', auth.uid(),
      'renewal_interval_seconds', p_renewal_interval_seconds,
      'clock_version', 'rhythm_clock_v1'
    ),
    v_at
  )
  on conflict (farm_id, event_key) do update
    set payload = atlas.workflow_events.payload || excluded.payload
  returning id into v_workflow_event_id;

  v_satisfaction_key := 'game-master:' || v_state.id::text || ':' || md5(btrim(p_idempotency_key));
  insert into atlas.rhythm_satisfactions (
    organization_id, farm_id, rhythm_state_id, rhythm_binding_id, rhythm_rule_id,
    rhythm_key, subject_kind, subject_id, satisfaction_key, satisfaction_kind,
    satisfied_at, renewal_interval_seconds, source_kind, source_id, source_event,
    source_workflow_event_id, policy_match, evidence, created_by_user_id
  ) values (
    v_state.organization_id,
    v_state.farm_id,
    v_state.id,
    v_state.rhythm_binding_id,
    v_state.rhythm_rule_id,
    v_state.rhythm_key,
    v_state.subject_kind,
    v_state.subject_id,
    v_satisfaction_key,
    'game_master',
    v_at,
    p_renewal_interval_seconds,
    'owner_action',
    v_workflow_event_id,
    'game_master_satisfaction',
    v_workflow_event_id,
    jsonb_build_object('matchKind', 'owner_governed_override', 'reason', btrim(p_reason)),
    jsonb_build_object('workflowEventId', v_workflow_event_id, 'actorUserId', auth.uid()),
    auth.uid()
  )
  on conflict (farm_id, satisfaction_key) do nothing
  returning id into v_satisfaction_id;

  if v_satisfaction_id is null then
    select id into v_satisfaction_id
    from atlas.rhythm_satisfactions
    where farm_id = v_state.farm_id and satisfaction_key = v_satisfaction_key;
  end if;

  update atlas.rhythm_state
  set last_qualifying_satisfaction_id = v_satisfaction_id,
      recovery_started_at = null,
      updated_at = now()
  where id = v_state.id;

  v_evaluation := atlas.evaluate_rhythm_binding_v1(v_state.id, now(), 'game_master_satisfaction');

  return jsonb_build_object(
    'contractVersion', 'rhythm_game_master_satisfaction_v1',
    'stateId', v_state.id,
    'satisfactionId', v_satisfaction_id,
    'workflowEventId', v_workflow_event_id,
    'evaluation', v_evaluation
  );
end;
$$;

revoke all on function atlas.record_rhythm_game_master_satisfaction_v1(
  uuid, text, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function atlas.record_rhythm_game_master_satisfaction_v1(
  uuid, text, text, timestamptz, integer
) to authenticated;

create or replace function atlas.sync_workflow_event_to_rhythm_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.apply_result_rhythm_effects_v1(new.id);
  return new;
end;
$$;

revoke all on function atlas.sync_workflow_event_to_rhythm_v1()
  from public, anon, authenticated;

drop trigger if exists workflow_events_rhythm_effects_v1 on atlas.workflow_events;
create trigger workflow_events_rhythm_effects_v1
after insert or update of source_event, payload on atlas.workflow_events
for each row execute function atlas.sync_workflow_event_to_rhythm_v1();

create or replace function atlas.farm_rhythm_tick_v1(
  p_farm_id uuid default null,
  p_as_of timestamptz default now(),
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_row record;
  v_result jsonb;
  v_scanned integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_failed integer := 0;
  v_farms jsonb := '{}'::jsonb;
begin
  for v_row in
    select s.id, s.farm_id
    from atlas.rhythm_state s
    where (p_farm_id is null or s.farm_id = p_farm_id)
    order by coalesce(s.last_evaluated_at, '-infinity'::timestamptz), s.id
    limit greatest(1, least(coalesce(p_limit, 1000), 5000))
    for update skip locked
  loop
    v_scanned := v_scanned + 1;
    begin
      v_result := atlas.evaluate_rhythm_binding_v1(v_row.id, coalesce(p_as_of, now()), 'scheduled_tick');
      if coalesce((v_result ->> 'changed')::boolean, false) then
        v_changed := v_changed + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
      v_farms := jsonb_set(
        v_farms,
        array[v_row.farm_id::text],
        to_jsonb(coalesce((v_farms ->> v_row.farm_id::text)::integer, 0) + 1),
        true
      );
    exception when others then
      v_failed := v_failed + 1;
      update atlas.rhythm_state
      set last_evaluated_at = coalesce(p_as_of, now()),
          metadata = metadata || jsonb_build_object(
            'last_clock_error', sqlerrm,
            'last_clock_sqlstate', sqlstate,
            'last_clock_error_at', now()
          ),
          updated_at = now()
      where id = v_row.id;
    end;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'farm_rhythm_tick_v1',
    'asOf', coalesce(p_as_of, now()),
    'farmId', p_farm_id,
    'scanned', v_scanned,
    'changed', v_changed,
    'unchanged', v_unchanged,
    'failed', v_failed,
    'farmScanCounts', v_farms,
    'evaluatorVersion', 'rhythm_clock_v1'
  );
end;
$$;

revoke all on function atlas.farm_rhythm_tick_v1(uuid, timestamptz, integer)
  from public, anon, authenticated;

-- The Clock is server-owned and continues while no browser is open.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'atlas-farm-rhythm-clock-v1'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'atlas-farm-rhythm-clock-v1',
    '17 * * * *',
    'select atlas.farm_rhythm_tick_v1();'
  );
end;
$$;
