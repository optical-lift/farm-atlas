-- Owner fixed routine command boundary v1
-- A fixed routine is a durable source of dated day_reservations, never a recurring task.

create or replace function atlas.owner_command_fixed_routine_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_operation text := nullif(btrim(coalesce(p_command->>'operation','')), '');
  v_routine_id uuid;
  v_existing atlas.fixed_routines%rowtype;
  v_after atlas.fixed_routines%rowtype;
  v_kind text;
  v_title text;
  v_start_text text;
  v_end_text text;
  v_local_start time without time zone;
  v_local_end time without time zone;
  v_duration integer;
  v_weekdays smallint[];
  v_effective_from date;
  v_effective_through date;
  v_note text;
  v_metadata jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'A fixed routine command is required.' using errcode='22023';
  end if;
  if v_operation not in ('create','change','end','resume') then
    raise exception 'Routine operation must be create, change, end, or resume.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.active
      and fm.role = 'owner'
      and fm.user_id = auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id = p_membership_id
      and fm.farm_id = p_farm_id
      and fm.active
      and fm.role = 'farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  begin
    v_routine_id := (p_command->>'routineId')::uuid;
  exception when others then
    raise exception 'A valid routine ID is required.' using errcode='22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text || '|' || p_membership_id::text || '|fixed_routine_v1', 0));

  if v_operation = 'create' then
    v_kind := nullif(btrim(coalesce(p_command->>'reservationKind','')), '');
    v_title := nullif(btrim(coalesce(p_command->>'title','')), '');
    v_start_text := nullif(btrim(coalesce(p_command->>'startLocalTime','')), '');
    v_end_text := nullif(btrim(coalesce(p_command->>'endLocalTime','')), '');
    if v_kind not in ('routine','meal','external_commitment') or v_title is null then
      raise exception 'Routine type and label are required.' using errcode='22023';
    end if;
    begin
      v_local_start := v_start_text::time without time zone;
      v_local_end := v_end_text::time without time zone;
    exception when others then
      raise exception 'Routine times must be valid Elm Farm local times.' using errcode='22023';
    end;
    if v_local_end <= v_local_start then
      raise exception 'Routine end must be after start on the same day.' using errcode='22023';
    end if;
    v_duration := floor(extract(epoch from (v_local_end - v_local_start)) / 60)::integer;
    if v_duration < 5 or v_duration > 720 then
      raise exception 'Routine duration must be between 5 minutes and 12 hours.' using errcode='22023';
    end if;
    if jsonb_typeof(p_command->'weekdays') <> 'array' then
      raise exception 'Choose at least one weekday for the routine.' using errcode='22023';
    end if;
    begin
      select array_agg(distinct value::smallint order by value::smallint)
      into v_weekdays
      from jsonb_array_elements_text(p_command->'weekdays') value;
    exception when others then
      raise exception 'Routine weekdays must be Sunday through Saturday values.' using errcode='22023';
    end;
    if coalesce(cardinality(v_weekdays),0) < 1
       or not (v_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]) then
      raise exception 'Choose at least one valid weekday.' using errcode='22023';
    end if;
    begin
      v_effective_from := coalesce(nullif(p_command->>'effectiveFrom','')::date, current_date);
    exception when others then
      raise exception 'Routine start date must be valid.' using errcode='22023';
    end;
    if p_command ? 'effectiveThrough' and nullif(p_command->>'effectiveThrough','') is not null then
      begin v_effective_through := (p_command->>'effectiveThrough')::date;
      exception when others then raise exception 'Routine end date must be valid.' using errcode='22023'; end;
    end if;
    if v_effective_through is not null and v_effective_through < v_effective_from then
      raise exception 'Routine end date cannot be before its start date.' using errcode='22023';
    end if;
    v_note := nullif(btrim(coalesce(p_command->>'note','')), '');
    v_metadata := case when jsonb_typeof(p_command->'metadata') = 'object' then p_command->'metadata' else '{}'::jsonb end;
    v_metadata := v_metadata || jsonb_build_object('enteredBy','owner');
    if v_note is not null then v_metadata := v_metadata || jsonb_build_object('operationalNote',v_note); end if;

    insert into atlas.fixed_routines (
      id, farm_id, membership_id, stable_key, kind, title, local_start,
      duration_minutes, weekdays, effective_from, effective_through, active, metadata
    ) values (
      v_routine_id, p_farm_id, p_membership_id, 'owner:' || v_routine_id::text,
      v_kind, v_title, v_local_start, v_duration, v_weekdays,
      v_effective_from, v_effective_through, true, v_metadata
    ) returning * into v_after;
  else
    select * into v_existing
    from atlas.fixed_routines routine
    where routine.id = v_routine_id
      and routine.farm_id = p_farm_id
      and routine.membership_id = p_membership_id
    for update;
    if v_existing.id is null then
      raise exception 'The selected fixed routine no longer exists for this worker.' using errcode='55000';
    end if;

    if v_operation = 'end' then
      begin
        v_effective_through := (p_command->>'effectiveThrough')::date;
      exception when others then
        raise exception 'A valid final routine date is required.' using errcode='22023';
      end;
      if v_effective_through < v_existing.effective_from then
        raise exception 'Routine end date cannot be before its start date.' using errcode='22023';
      end if;
      update atlas.fixed_routines routine
      set effective_through = v_effective_through,
          active = true,
          metadata = routine.metadata || jsonb_build_object('endedByOwner',true),
          updated_at = now()
      where routine.id = v_existing.id
      returning * into v_after;
    elsif v_operation = 'resume' then
      update atlas.fixed_routines routine
      set effective_through = null,
          active = true,
          metadata = (routine.metadata - 'endedByOwner') || jsonb_build_object('resumedByOwner',true),
          updated_at = now()
      where routine.id = v_existing.id
      returning * into v_after;
    else
      v_kind := coalesce(nullif(btrim(coalesce(p_command->>'reservationKind','')), ''), v_existing.kind);
      v_title := coalesce(nullif(btrim(coalesce(p_command->>'title','')), ''), v_existing.title);
      if v_kind not in ('routine','meal','external_commitment') then
        raise exception 'Routine type is invalid.' using errcode='22023';
      end if;
      v_local_start := v_existing.local_start;
      v_duration := v_existing.duration_minutes;
      if p_command ? 'startLocalTime' or p_command ? 'endLocalTime' then
        v_start_text := coalesce(nullif(p_command->>'startLocalTime',''), to_char(v_existing.local_start,'HH24:MI'));
        v_end_text := nullif(p_command->>'endLocalTime','');
        if v_end_text is null then
          v_local_end := v_existing.local_start + make_interval(mins => v_existing.duration_minutes);
        else
          begin v_local_end := v_end_text::time without time zone;
          exception when others then raise exception 'Routine end time must be valid.' using errcode='22023'; end;
        end if;
        begin v_local_start := v_start_text::time without time zone;
        exception when others then raise exception 'Routine start time must be valid.' using errcode='22023'; end;
        if v_local_end <= v_local_start then
          raise exception 'Routine end must be after start on the same day.' using errcode='22023';
        end if;
        v_duration := floor(extract(epoch from (v_local_end - v_local_start)) / 60)::integer;
        if v_duration < 5 or v_duration > 720 then
          raise exception 'Routine duration must be between 5 minutes and 12 hours.' using errcode='22023';
        end if;
      end if;
      v_weekdays := v_existing.weekdays;
      if p_command ? 'weekdays' then
        if jsonb_typeof(p_command->'weekdays') <> 'array' then
          raise exception 'Choose at least one weekday for the routine.' using errcode='22023';
        end if;
        begin
          select array_agg(distinct value::smallint order by value::smallint)
          into v_weekdays
          from jsonb_array_elements_text(p_command->'weekdays') value;
        exception when others then
          raise exception 'Routine weekdays must be Sunday through Saturday values.' using errcode='22023';
        end;
        if coalesce(cardinality(v_weekdays),0) < 1
           or not (v_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]) then
          raise exception 'Choose at least one valid weekday.' using errcode='22023';
        end if;
      end if;
      v_effective_from := v_existing.effective_from;
      if p_command ? 'effectiveFrom' then
        begin v_effective_from := (p_command->>'effectiveFrom')::date;
        exception when others then raise exception 'Routine start date must be valid.' using errcode='22023'; end;
      end if;
      v_effective_through := v_existing.effective_through;
      if p_command ? 'effectiveThrough' then
        if nullif(p_command->>'effectiveThrough','') is null then v_effective_through := null;
        else
          begin v_effective_through := (p_command->>'effectiveThrough')::date;
          exception when others then raise exception 'Routine end date must be valid.' using errcode='22023'; end;
        end if;
      end if;
      if v_effective_through is not null and v_effective_through < v_effective_from then
        raise exception 'Routine end date cannot be before its start date.' using errcode='22023';
      end if;
      v_metadata := v_existing.metadata;
      if p_command ? 'note' then
        v_metadata := v_metadata - 'operationalNote';
        v_note := nullif(btrim(coalesce(p_command->>'note','')), '');
        if v_note is not null then v_metadata := v_metadata || jsonb_build_object('operationalNote',v_note); end if;
      end if;
      update atlas.fixed_routines routine
      set kind = v_kind,
          title = v_title,
          local_start = v_local_start,
          duration_minutes = v_duration,
          weekdays = v_weekdays,
          effective_from = v_effective_from,
          effective_through = v_effective_through,
          active = true,
          metadata = v_metadata,
          updated_at = now()
      where routine.id = v_existing.id
      returning * into v_after;
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','owner_fixed_routine_command_v1',
    'operation',v_operation,
    'routine',jsonb_build_object(
      'routineId',v_after.id,
      'kind',v_after.kind,
      'title',v_after.title,
      'startLocalTime',to_char(v_after.local_start,'HH24:MI'),
      'durationMinutes',v_after.duration_minutes,
      'weekdays',to_jsonb(v_after.weekdays),
      'effectiveFrom',v_after.effective_from,
      'effectiveThrough',v_after.effective_through,
      'active',v_after.active,
      'note',v_after.metadata->>'operationalNote'
    )
  );
end;
$$;

revoke execute on function atlas.owner_command_fixed_routine_api_v1(uuid,uuid,jsonb) from public, anon;
grant execute on function atlas.owner_command_fixed_routine_api_v1(uuid,uuid,jsonb) to authenticated, service_role;
revoke insert, update, delete on atlas.fixed_routines from authenticated;

comment on function atlas.owner_command_fixed_routine_api_v1(uuid,uuid,jsonb) is
  'Owner-authoritative fixed-routine source command. Definitions project dated day_reservations and never mutate atlas.tasks.';

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values (
  'atlas.owner_command_fixed_routine_api_v1(uuid, uuid, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Create and edit repeating fixed-time sources for one active Farm Hand',
    'boundary','active farm Owner only; target must be an active Farm Hand in the same farm',
    'projection','routine definition -> dated day_reservations',
    'taskTruth','never creates or mutates recurring tasks'
  ),now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;
