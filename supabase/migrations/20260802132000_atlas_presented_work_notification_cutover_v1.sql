begin;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='presented_work_rows_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_work_date date';

  v_old := $old$  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

$old$;
  if position(v_old in v_definition)>0 then
    v_definition := replace(v_definition, v_old, '');
  end if;

  v_old := $old$  if v_target_user_id is distinct from auth.uid()
    and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s presented work.' using errcode = '42501';
  end if;$old$;
  v_new := $new$  if auth.uid() is not null
    and v_target_user_id is distinct from auth.uid()
    and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s presented work.' using errcode = '42501';
  end if;$new$;
  if position(v_old in v_definition)>0 then
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$    select array_agg(task.id order by task.created_at, task.id),
           count(*)::integer,
           min(regexp_replace(task.title, '^(Owner|Anna|Marshall) — ', '', 'i'))
    into v_task_ids, v_task_count, v_first_title
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and task.task_scope = 'farm_operation'
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = p_work_date
      and (
        task.assigned_membership_id = v_member.membership_id
        or (task.assigned_membership_id is null and task.assigned_user_id = v_member.user_id)
      );$old$;
  v_new text := $new$    select array_agg(task.id order by presented.lane_order, presented.selection_rank),
           count(*)::integer,
           min(regexp_replace(task.title, '^(Owner|Anna|Marshall) — ', '', 'i'))
    into v_task_ids, v_task_count, v_first_title
    from atlas.presented_work_rows_v1(p_farm_id, v_member.membership_id, p_work_date) presented
    join atlas.tasks task on task.id = presented.task_id
    where presented.presentation_state in ('presented', 'attention')
      and presented.presentation_reason <> 'owner_review'
      and task.task_scope = 'farm_operation'
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = p_work_date;$new$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='ensure_task_notification_moments_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_work_date date, p_user_id uuid, p_as_of timestamp with time zone';
  if position(v_old in v_definition)=0 then
    raise exception 'Notification schedule source fragment was not found.';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$    select array_agg(task.id order by task.created_at, task.id), count(*)::integer
    into v_open_ids, v_open_count
    from atlas.tasks task
    where task.id = any(v_moment.task_ids)
      and task.farm_id = v_moment.farm_id
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = v_moment.work_date
      and (
        task.assigned_membership_id = v_moment.membership_id
        or (task.assigned_membership_id is null and task.assigned_user_id = v_moment.user_id)
      );$old$;
  v_new text := $new$    select array_agg(task.id order by presented.lane_order, presented.selection_rank), count(*)::integer
    into v_open_ids, v_open_count
    from atlas.presented_work_rows_v1(v_moment.farm_id, v_moment.membership_id, v_moment.work_date) presented
    join atlas.tasks task on task.id = presented.task_id
    where task.id = any(v_moment.task_ids)
      and presented.presentation_state in ('presented', 'attention')
      and presented.presentation_reason <> 'owner_review'
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = v_moment.work_date;$new$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='dispatch_task_notification_moments_v1'
    and pg_get_function_identity_arguments(p.oid)='p_as_of timestamp with time zone, p_limit integer';
  if position(v_old in v_definition)=0 then
    raise exception 'Notification dispatch source fragment was not found.';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

insert into atlas.task_notification_plans(
  farm_id,
  task_id,
  release_local_time,
  close_local_time,
  nudge_after_minutes,
  group_key,
  group_label,
  source,
  active,
  metadata
)
select
  task.farm_id,
  task.id,
  (profile.packet ->> 'releaseTime')::time,
  nullif(profile.packet ->> 'closeTime', '')::time,
  nullif(profile.packet ->> 'nudgeMinutes', '')::integer,
  profile.packet ->> 'groupKey',
  profile.packet ->> 'groupLabel',
  'presented_work_hard_date_backfill',
  true,
  jsonb_build_object(
    'workLane', task.work_lane,
    'commitmentKind', task.commitment_kind,
    'backfilledAt', now(),
    'backfillReason', 'required_hard_date_notification_guarantee'
  )
from atlas.tasks task
cross join lateral (
  select atlas.task_notification_profile_v1(task.id) as packet
) profile
where task.parent_task_id is null
  and task.status in ('open','blocked')
  and task.work_lane='required'
  and task.commitment_kind='hard_date'
  and task.due_date is not null
on conflict (task_id) do update
set active=true,
    metadata=atlas.task_notification_plans.metadata || excluded.metadata,
    updated_at=now();

do $schedule$
declare
  v_farm record;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  for v_farm in
    select distinct membership.farm_id
    from atlas.farm_memberships membership
    where membership.active
  loop
    perform atlas.ensure_task_notification_moments_v1(v_farm.farm_id, v_today, null, now());
    perform atlas.ensure_task_notification_moments_v1(v_farm.farm_id, v_today + 1, null, now());
  end loop;
end;
$schedule$;

commit;
