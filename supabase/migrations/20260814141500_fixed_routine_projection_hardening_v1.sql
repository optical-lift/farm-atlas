do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'atlas.fixed_routines'::regclass
      and conname = 'fixed_routines_weekdays_check'
  ) then
    alter table atlas.fixed_routines
      add constraint fixed_routines_weekdays_check
      check (
        cardinality(weekdays) between 1 and 7
        and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
      );
  end if;
end $$;

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

  -- An occurrence override protects that date from routine edits while its source
  -- remains active. It does not outlive a routine that no longer applies to the day.
  update atlas.day_reservations reservation
  set active = false,
      updated_at = now(),
      metadata = reservation.metadata || jsonb_build_object('sourceInactive', true)
  where reservation.farm_id = p_farm_id
    and reservation.membership_id = p_membership_id
    and reservation.service_date = p_day
    and reservation.source = 'fixed_routine'
    and reservation.active
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

revoke execute on function atlas.sync_fixed_routine_reservations_for_day_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.sync_fixed_routine_reservations_for_day_v1(uuid,uuid,date) to authenticated, service_role;
