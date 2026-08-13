-- Pass 7: timed Day cues need an actual Elm Farm clock time.
-- Existing invalid rows are left visible for Owner repair, while NOT VALID
-- constraints protect every new or edited row immediately.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.worker_day_cues'::regclass
      and conname='worker_day_cues_timed_requires_time_ck'
  ) then
    alter table atlas.worker_day_cues
      add constraint worker_day_cues_timed_requires_time_ck
      check (anchor_kind <> 'at_time' or scheduled_at is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.worker_day_cues'::regclass
      and conname='worker_day_cues_timed_service_day_ck'
  ) then
    alter table atlas.worker_day_cues
      add constraint worker_day_cues_timed_service_day_ck
      check (
        anchor_kind <> 'at_time'
        or scheduled_at is null
        or (scheduled_at at time zone 'America/Chicago')::date = service_date
      ) not valid;
  end if;
end
$$;
