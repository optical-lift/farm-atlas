begin;

create or replace function atlas.upsert_task_notification_moment_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_work_date date,
  p_moment_kind text,
  p_category text,
  p_group_key text,
  p_scheduled_for timestamptz,
  p_required boolean,
  p_task_ids uuid[],
  p_title text,
  p_body text,
  p_deep_link text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_id uuid;
  v_as_of timestamptz := now();
  v_initial_status text := 'planned';
  v_skip_reason text;
begin
  begin
    if nullif(p_metadata ->> 'asOf', '') is not null then
      v_as_of := (p_metadata ->> 'asOf')::timestamptz;
    end if;
  exception when invalid_text_representation then
    v_as_of := now();
  end;

  if p_moment_kind <> 'tomorrow_covered'
     and p_scheduled_for < v_as_of - interval '10 minutes'
  then
    v_initial_status := 'skipped';
    v_skip_reason := 'historical_backfill_suppressed';
  end if;

  insert into atlas.task_notification_moments(
    farm_id, membership_id, user_id, work_date, moment_kind, category,
    group_key, scheduled_for, required, task_ids, title, body, deep_link,
    status, skipped_at, skip_reason, metadata
  ) values (
    p_farm_id, p_membership_id, p_user_id, p_work_date, p_moment_kind, p_category,
    p_group_key, p_scheduled_for, coalesce(p_required, false), coalesce(p_task_ids, '{}'::uuid[]),
    left(p_title, 140), left(p_body, 500), coalesce(nullif(p_deep_link, ''), '/day'),
    v_initial_status,
    case when v_initial_status = 'skipped' then v_as_of else null end,
    v_skip_reason,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (farm_id, user_id, work_date, moment_kind, group_key)
  do update set
    membership_id = excluded.membership_id,
    scheduled_for = excluded.scheduled_for,
    required = excluded.required,
    task_ids = excluded.task_ids,
    title = excluded.title,
    body = excluded.body,
    deep_link = excluded.deep_link,
    status = case
      when atlas.task_notification_moments.status = 'skipped'
       and atlas.task_notification_moments.skip_reason = 'historical_backfill_suppressed'
       and excluded.status = 'planned'
      then 'planned'
      else atlas.task_notification_moments.status
    end,
    skipped_at = case
      when atlas.task_notification_moments.status = 'skipped'
       and atlas.task_notification_moments.skip_reason = 'historical_backfill_suppressed'
       and excluded.status = 'planned'
      then null
      else atlas.task_notification_moments.skipped_at
    end,
    skip_reason = case
      when atlas.task_notification_moments.status = 'skipped'
       and atlas.task_notification_moments.skip_reason = 'historical_backfill_suppressed'
       and excluded.status = 'planned'
      then null
      else atlas.task_notification_moments.skip_reason
    end,
    metadata = atlas.task_notification_moments.metadata || excluded.metadata,
    updated_at = now()
  where atlas.task_notification_moments.status = 'planned'
     or atlas.task_notification_moments.skip_reason = 'historical_backfill_suppressed'
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from atlas.task_notification_moments
    where farm_id = p_farm_id
      and user_id = p_user_id
      and work_date = p_work_date
      and moment_kind = p_moment_kind
      and group_key = p_group_key;
  end if;

  return v_id;
end;
$function$;

revoke all on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) from public, anon, authenticated;
grant execute on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) to service_role;

comment on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) is
  'Creates idempotent lockscreen moments while suppressing historical same-day backfill floods. Tomorrow coverage may catch up after its evening checkpoint.';

commit;
