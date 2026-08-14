alter table atlas.day_reservations
  add column if not exists source_reference text;

update atlas.day_reservations
set source = 'owner_manual'
where source = 'owner_instruction';

alter table atlas.day_reservations
  alter column source set default 'owner_manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'atlas.day_reservations'::regclass
      and conname = 'day_reservations_source_check'
  ) then
    alter table atlas.day_reservations
      add constraint day_reservations_source_check
      check (source in ('owner_manual', 'fixed_routine', 'calendar_import', 'atlas_rule'));
  end if;
end $$;

comment on column atlas.day_reservations.source is
  'Reservation provenance: owner_manual, fixed_routine, calendar_import, or atlas_rule.';
comment on column atlas.day_reservations.source_reference is
  'Optional durable source identity. Generated reservations point back to the routine, calendar item, or Atlas rule that produced the dated occurrence.';

create table if not exists atlas.fixed_routines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  stable_key text not null check (btrim(stable_key) <> ''),
  kind text not null check (kind in ('routine', 'meal', 'external_commitment')),
  title text not null check (btrim(title) <> ''),
  local_start time without time zone not null,
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  effective_from date not null default current_date,
  effective_through date,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_routines_effective_span check (effective_through is null or effective_through >= effective_from),
  constraint fixed_routines_membership_key unique (membership_id, stable_key)
);

create index if not exists fixed_routines_member_active_idx
  on atlas.fixed_routines (membership_id, active, effective_from, effective_through);

alter table atlas.fixed_routines enable row level security;

drop policy if exists fixed_routines_owner_read on atlas.fixed_routines;
create policy fixed_routines_owner_read
on atlas.fixed_routines
for select
to authenticated
using (atlas.can_read_farm_operations(farm_id));

grant select on atlas.fixed_routines to authenticated;
grant select, insert, update, delete on atlas.fixed_routines to service_role;
revoke insert, update, delete on atlas.fixed_routines from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'atlas.fixed_routines'::regclass
      and tgname = 'fixed_routines_set_updated_at'
      and not tgisinternal
  ) then
    create trigger fixed_routines_set_updated_at
    before update on atlas.fixed_routines
    for each row execute function atlas.set_updated_at();
  end if;
end $$;

comment on table atlas.fixed_routines is
  'Durable life-structure definitions. These project into dated day_reservations; they never create recurring tasks.';

create or replace function atlas.sync_fixed_routine_reservations_for_day_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_routine atlas.fixed_routines%rowtype;
  v_start timestamptz;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.id = p_membership_id
      and fm.farm_id = p_farm_id
      and fm.active
      and (
        fm.user_id = auth.uid()
        or exists (
          select 1 from atlas.farm_memberships owner_membership
          where owner_membership.farm_id = p_farm_id
            and owner_membership.active
            and owner_membership.role = 'owner'
            and owner_membership.user_id = auth.uid()
        )
      )
  ) then
    raise exception 'Worker Day access required.' using errcode='42501';
  end if;

  update atlas.day_reservations reservation
  set active = false,
      updated_at = now(),
      metadata = reservation.metadata || jsonb_build_object('sourceInactive', true)
  where reservation.farm_id = p_farm_id
    and reservation.membership_id = p_membership_id
    and reservation.service_date = p_day
    and reservation.source = 'fixed_routine'
    and reservation.active
    and not (reservation.metadata @> '{"occurrenceOverride": true}'::jsonb)
    and not exists (
      select 1
      from atlas.fixed_routines routine
      where routine.id::text = reservation.source_reference
        and routine.farm_id = p_farm_id
        and routine.membership_id = p_membership_id
        and routine.active
        and routine.effective_from <= p_day
        and (routine.effective_through is null or routine.effective_through >= p_day)
        and extract(dow from p_day)::smallint = any(routine.weekdays)
    );

  for v_routine in
    select *
    from atlas.fixed_routines routine
    where routine.farm_id = p_farm_id
      and routine.membership_id = p_membership_id
      and routine.active
      and routine.effective_from <= p_day
      and (routine.effective_through is null or routine.effective_through >= p_day)
      and extract(dow from p_day)::smallint = any(routine.weekdays)
    order by routine.local_start, routine.id
  loop
    v_start := (p_day::timestamp + v_routine.local_start) at time zone 'America/Chicago';
    insert into atlas.day_reservations (
      farm_id, membership_id, stable_key, kind, service_date, title,
      starts_at, ends_at, source, source_reference, active, metadata
    ) values (
      p_farm_id,
      p_membership_id,
      'routine:' || v_routine.id::text,
      v_routine.kind,
      p_day,
      v_routine.title,
      v_start,
      v_start + make_interval(mins => v_routine.duration_minutes),
      'fixed_routine',
      v_routine.id::text,
      true,
      v_routine.metadata || jsonb_build_object('generatedFrom', 'fixed_routine')
    )
    on conflict (membership_id, service_date, stable_key)
    do update set
      kind = excluded.kind,
      title = excluded.title,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      source = excluded.source,
      source_reference = excluded.source_reference,
      active = true,
      metadata = excluded.metadata,
      updated_at = now()
    where atlas.day_reservations.source = 'fixed_routine'
      and not (atlas.day_reservations.metadata @> '{"occurrenceOverride": true}'::jsonb)
      and not (atlas.day_reservations.metadata @> '{"suppressed": true}'::jsonb);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function atlas.owner_command_day_reservation_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_operation text := nullif(btrim(coalesce(p_command->>'operation','')), '');
  v_reservation_id uuid;
  v_existing atlas.day_reservations%rowtype;
  v_after atlas.day_reservations%rowtype;
  v_kind text;
  v_title text;
  v_note text;
  v_start_text text;
  v_end_text text;
  v_local_start time without time zone;
  v_local_end time without time zone;
  v_start timestamptz;
  v_end timestamptz;
  v_metadata jsonb;
  v_duration interval;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null or p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'A service date and reservation command are required.' using errcode='22023';
  end if;
  if v_operation not in ('create','change','move','resize','remove') then
    raise exception 'Reservation operation must be create, change, move, resize, or remove.' using errcode='22023';
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
    v_reservation_id := (p_command->>'reservationId')::uuid;
  exception when others then
    raise exception 'A valid reservation ID is required.' using errcode='22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text || '|' || p_membership_id::text || '|' || p_day::text || '|day_reservation_v1', 0));

  if v_operation = 'create' then
    v_kind := nullif(btrim(coalesce(p_command->>'reservationKind','')), '');
    v_title := nullif(btrim(coalesce(p_command->>'title','')), '');
    v_start_text := nullif(btrim(coalesce(p_command->>'startLocalTime','')), '');
    v_end_text := nullif(btrim(coalesce(p_command->>'endLocalTime','')), '');
    if v_kind not in ('routine','meal','external_commitment') or v_title is null then
      raise exception 'Reservation type and label are required.' using errcode='22023';
    end if;
    begin
      v_local_start := v_start_text::time without time zone;
      v_local_end := v_end_text::time without time zone;
    exception when others then
      raise exception 'Reservation times must be valid Elm Farm local times.' using errcode='22023';
    end;
    v_start := (p_day::timestamp + v_local_start) at time zone 'America/Chicago';
    v_end := (p_day::timestamp + v_local_end) at time zone 'America/Chicago';
    if v_end <= v_start then
      raise exception 'Reservation end must be after its start on the same service day.' using errcode='22023';
    end if;
    v_metadata := case when jsonb_typeof(p_command->'metadata') = 'object' then p_command->'metadata' else '{}'::jsonb end;
    v_note := nullif(btrim(coalesce(p_command->>'note','')), '');
    if v_note is not null then v_metadata := v_metadata || jsonb_build_object('operationalNote', v_note); end if;
    v_metadata := v_metadata || jsonb_build_object('enteredBy', 'owner');

    insert into atlas.day_reservations (
      id, farm_id, membership_id, stable_key, kind, service_date, title,
      starts_at, ends_at, source, source_reference, active, metadata
    ) values (
      v_reservation_id, p_farm_id, p_membership_id, 'manual:' || v_reservation_id::text,
      v_kind, p_day, v_title, v_start, v_end, 'owner_manual', null, true, v_metadata
    ) returning * into v_after;
  else
    select * into v_existing
    from atlas.day_reservations reservation
    where reservation.id = v_reservation_id
      and reservation.farm_id = p_farm_id
      and reservation.membership_id = p_membership_id
      and reservation.service_date = p_day
      and reservation.active
    for update;
    if v_existing.id is null then
      raise exception 'The selected reservation is no longer active on this worker day.' using errcode='55000';
    end if;

    if v_operation = 'remove' then
      update atlas.day_reservations reservation
      set active = false,
          metadata = reservation.metadata || jsonb_build_object(
            'removedByOwner', true,
            'suppressed', reservation.source <> 'owner_manual'
          ),
          updated_at = now()
      where reservation.id = v_existing.id
      returning * into v_after;
    elsif v_operation = 'move' then
      v_start_text := nullif(btrim(coalesce(p_command->>'startLocalTime','')), '');
      begin v_local_start := v_start_text::time without time zone;
      exception when others then raise exception 'Move time must be a valid Elm Farm local time.' using errcode='22023'; end;
      v_duration := v_existing.ends_at - v_existing.starts_at;
      v_start := (p_day::timestamp + v_local_start) at time zone 'America/Chicago';
      v_end := v_start + v_duration;
      if (v_end at time zone 'America/Chicago')::date <> p_day then
        raise exception 'A reservation move must remain inside the selected service day.' using errcode='22023';
      end if;
      update atlas.day_reservations reservation
      set starts_at = v_start,
          ends_at = v_end,
          metadata = reservation.metadata || case when reservation.source <> 'owner_manual' then '{"occurrenceOverride": true}'::jsonb else '{}'::jsonb end,
          updated_at = now()
      where reservation.id = v_existing.id
      returning * into v_after;
    elsif v_operation = 'resize' then
      v_end_text := nullif(btrim(coalesce(p_command->>'endLocalTime','')), '');
      begin v_local_end := v_end_text::time without time zone;
      exception when others then raise exception 'Resize time must be a valid Elm Farm local time.' using errcode='22023'; end;
      v_end := (p_day::timestamp + v_local_end) at time zone 'America/Chicago';
      if v_end <= v_existing.starts_at then
        raise exception 'Reservation end must be after its start.' using errcode='22023';
      end if;
      update atlas.day_reservations reservation
      set ends_at = v_end,
          metadata = reservation.metadata || case when reservation.source <> 'owner_manual' then '{"occurrenceOverride": true}'::jsonb else '{}'::jsonb end,
          updated_at = now()
      where reservation.id = v_existing.id
      returning * into v_after;
    else
      v_kind := coalesce(nullif(btrim(coalesce(p_command->>'reservationKind','')), ''), v_existing.kind);
      v_title := coalesce(nullif(btrim(coalesce(p_command->>'title','')), ''), v_existing.title);
      if v_kind not in ('routine','meal','external_commitment') then
        raise exception 'Reservation type is invalid.' using errcode='22023';
      end if;
      v_start := v_existing.starts_at;
      v_end := v_existing.ends_at;
      if p_command ? 'startLocalTime' then
        v_start_text := nullif(btrim(coalesce(p_command->>'startLocalTime','')), '');
        begin v_local_start := v_start_text::time without time zone;
        exception when others then raise exception 'Reservation start must be a valid Elm Farm local time.' using errcode='22023'; end;
        v_start := (p_day::timestamp + v_local_start) at time zone 'America/Chicago';
      end if;
      if p_command ? 'endLocalTime' then
        v_end_text := nullif(btrim(coalesce(p_command->>'endLocalTime','')), '');
        begin v_local_end := v_end_text::time without time zone;
        exception when others then raise exception 'Reservation end must be a valid Elm Farm local time.' using errcode='22023'; end;
        v_end := (p_day::timestamp + v_local_end) at time zone 'America/Chicago';
      end if;
      if v_end <= v_start then
        raise exception 'Reservation end must be after its start.' using errcode='22023';
      end if;
      v_metadata := v_existing.metadata;
      if p_command ? 'note' then
        v_note := nullif(btrim(coalesce(p_command->>'note','')), '');
        v_metadata := v_metadata - 'operationalNote';
        if v_note is not null then v_metadata := v_metadata || jsonb_build_object('operationalNote', v_note); end if;
      end if;
      if v_existing.source <> 'owner_manual' then
        v_metadata := v_metadata || '{"occurrenceOverride": true}'::jsonb;
      end if;
      update atlas.day_reservations reservation
      set kind = v_kind,
          title = v_title,
          starts_at = v_start,
          ends_at = v_end,
          metadata = v_metadata,
          updated_at = now()
      where reservation.id = v_existing.id
      returning * into v_after;
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion', 'owner_day_reservation_command_v1',
    'operation', v_operation,
    'reservation', jsonb_build_object(
      'reservationId', v_after.id,
      'serviceDate', v_after.service_date,
      'kind', v_after.kind,
      'title', v_after.title,
      'startAt', v_after.starts_at,
      'endAt', v_after.ends_at,
      'source', v_after.source,
      'sourceReference', v_after.source_reference,
      'active', v_after.active,
      'note', v_after.metadata->>'operationalNote'
    )
  );
end;
$$;

revoke insert, update, delete on atlas.day_reservations from authenticated;
revoke execute on function atlas.owner_command_day_reservation_api_v1(uuid,uuid,date,jsonb) from public, anon;
grant execute on function atlas.owner_command_day_reservation_api_v1(uuid,uuid,date,jsonb) to authenticated, service_role;
revoke execute on function atlas.sync_fixed_routine_reservations_for_day_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.sync_fixed_routine_reservations_for_day_v1(uuid,uuid,date) to authenticated, service_role;
