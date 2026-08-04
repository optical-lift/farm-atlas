create or replace function atlas.handle_task_notification_action_v1(
  p_moment_id uuid,
  p_action text,
  p_delay_minutes integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_moment atlas.task_notification_moments%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_open_ids uuid[] := '{}'::uuid[];
  v_open_count integer := 0;
  v_task atlas.tasks%rowtype;
  v_delay integer;
  v_scheduled_for timestamptz;
  v_snooze_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_moment_id is null then
    raise exception 'Notification moment id is required.' using errcode = '22023';
  end if;
  if p_action not in ('done', 'snooze') then
    raise exception 'Unsupported notification action.' using errcode = '22023';
  end if;

  select * into v_moment
  from atlas.task_notification_moments moment
  where moment.id = p_moment_id
    and moment.user_id = v_user_id;

  if v_moment.id is null then
    raise exception 'Notification moment was not found.' using errcode = 'P0002';
  end if;

  select * into v_membership
  from atlas.farm_memberships membership
  where membership.id = v_moment.membership_id
    and membership.farm_id = v_moment.farm_id
    and membership.user_id = v_user_id
    and membership.active;

  if v_membership.id is null then
    raise exception 'The notification no longer belongs to an active farm membership.' using errcode = '42501';
  end if;

  select
    coalesce(array_agg(task.id order by array_position(v_moment.task_ids, task.id)), '{}'::uuid[]),
    count(*)::integer
  into v_open_ids, v_open_count
  from atlas.tasks task
  where task.id = any(v_moment.task_ids)
    and task.parent_task_id is null
    and task.status in ('open', 'blocked')
    and task.due_date = v_moment.work_date
    and exists (
      select 1
      from atlas.presented_work_rows_v1(v_moment.farm_id, v_moment.membership_id, v_moment.work_date) presented
      where presented.task_id = task.id
        and presented.presentation_state in ('presented', 'attention')
        and presented.presentation_reason <> 'owner_review'
    );

  if coalesce(v_open_count, 0) = 0 then
    return jsonb_build_object(
      'ok', true,
      'status', 'resolved',
      'action', p_action,
      'notificationMomentId', v_moment.id,
      'deepLink', v_moment.deep_link,
      'requiresOpen', false
    );
  end if;

  if p_action = 'snooze' then
    v_delay := greatest(15, least(coalesce(p_delay_minutes, 300), 1440));
    v_scheduled_for := now() + make_interval(mins => v_delay);

    v_snooze_id := atlas.upsert_task_notification_moment_v1(
      v_moment.farm_id,
      v_moment.membership_id,
      v_moment.user_id,
      v_moment.work_date,
      'work_window',
      v_moment.category,
      'snooze:' || v_moment.id::text,
      v_scheduled_for,
      true,
      v_open_ids,
      left('Reminder · ' || regexp_replace(v_moment.title, '^Reminder · ', '', 'i'), 140),
      v_moment.body,
      v_moment.deep_link,
      coalesce(v_moment.metadata, '{}'::jsonb) || jsonb_build_object(
        'manualSnooze', true,
        'sourceMomentId', v_moment.id,
        'delayMinutes', v_delay,
        'snoozedAt', now(),
        'asOf', now(),
        'notificationActionVersion', 'task_notification_actions_v1'
      )
    );

    update atlas.task_notification_moments
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastNotificationAction', 'snooze',
          'lastNotificationActionAt', now(),
          'snoozedMomentId', v_snooze_id,
          'snoozedUntil', v_scheduled_for
        ),
        updated_at = now()
    where id = v_moment.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'snoozed',
      'action', 'snooze',
      'notificationMomentId', v_moment.id,
      'snoozedMomentId', v_snooze_id,
      'scheduledFor', v_scheduled_for,
      'delayMinutes', v_delay,
      'deepLink', v_moment.deep_link,
      'requiresOpen', false
    );
  end if;

  if v_open_count <> 1 then
    return jsonb_build_object(
      'ok', true,
      'status', 'open_required',
      'action', 'done',
      'notificationMomentId', v_moment.id,
      'deepLink', v_moment.deep_link,
      'requiresOpen', true,
      'reason', 'The notification represents more than one task.'
    );
  end if;

  select * into v_task from atlas.tasks where id = v_open_ids[1];

  if v_task.status <> 'open'
     or lower(coalesce(v_task.metadata ->> 'quick_complete_allowed', 'false')) not in ('true', 'yes', '1')
  then
    return jsonb_build_object(
      'ok', true,
      'status', 'open_required',
      'action', 'done',
      'taskId', v_task.id,
      'notificationMomentId', v_moment.id,
      'deepLink', coalesce(nullif(v_moment.deep_link, ''), '/task-focus/' || v_task.id::text),
      'requiresOpen', true,
      'reason', 'This task needs its Atlas result screen before completion.'
    );
  end if;

  v_result := atlas.record_task_transition_v1(
    v_task.id,
    'done',
    'notification-action:done:' || v_moment.id::text,
    null,
    null,
    null,
    coalesce(nullif(v_task.action_key, ''), 'notification'),
    coalesce(nullif(v_task.action_key, ''), 'notification'),
    jsonb_build_object(
      'completion_source', 'notification_action',
      'notification_moment_id', v_moment.id,
      'notification_action_version', 'task_notification_actions_v1'
    ),
    null
  );

  update atlas.task_notification_moments
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'lastNotificationAction', 'done',
        'lastNotificationActionAt', now(),
        'completedTaskId', v_task.id
      ),
      updated_at = now()
  where id = v_moment.id;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'ok', true,
    'status', 'done',
    'action', 'done',
    'taskId', v_task.id,
    'notificationMomentId', v_moment.id,
    'deepLink', v_moment.deep_link,
    'requiresOpen', false
  );
end;
$$;

revoke all on function atlas.handle_task_notification_action_v1(uuid, text, integer) from public;
grant execute on function atlas.handle_task_notification_action_v1(uuid, text, integer) to authenticated;
grant execute on function atlas.handle_task_notification_action_v1(uuid, text, integer) to service_role;
