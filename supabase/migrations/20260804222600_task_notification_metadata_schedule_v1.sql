create or replace function atlas.task_notification_profile_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_plan atlas.task_notification_plans%rowtype;
  v_title text;
  v_action text;
  v_task_type text;
  v_collection text;
  v_group_key text;
  v_group_label text;
  v_release time;
  v_close time;
  v_nudge integer;
  v_release_text text;
  v_close_text text;
  v_nudge_text text;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then return null; end if;

  select * into v_plan
  from atlas.task_notification_plans
  where task_id = p_task_id and active;

  if v_plan.id is not null then
    return jsonb_build_object(
      'source', v_plan.source,
      'releaseTime', to_char(v_plan.release_local_time, 'HH24:MI'),
      'closeTime', case when v_plan.close_local_time is null then null else to_char(v_plan.close_local_time, 'HH24:MI') end,
      'nudgeMinutes', v_plan.nudge_after_minutes,
      'groupKey', coalesce(nullif(v_plan.group_key, ''), p_task_id::text),
      'groupLabel', coalesce(nullif(v_plan.group_label, ''), nullif(v_task.metadata ->> 'collection_label', ''), v_task.title)
    );
  end if;

  v_release_text := nullif(v_task.metadata ->> 'notification_release_local_time', '');
  v_close_text := nullif(v_task.metadata ->> 'notification_close_local_time', '');
  v_nudge_text := nullif(v_task.metadata ->> 'notification_nudge_after_minutes', '');

  if v_release_text is not null then
    begin
      v_release := v_release_text::time;
    exception when invalid_datetime_format then
      v_release := null;
    end;

    if v_release is not null then
      begin
        v_close := case when v_close_text is null then null else v_close_text::time end;
      exception when invalid_datetime_format then
        v_close := null;
      end;

      begin
        v_nudge := case when v_nudge_text is null then null else v_nudge_text::integer end;
      exception when invalid_text_representation then
        v_nudge := null;
      end;

      v_group_label := coalesce(
        nullif(v_task.metadata ->> 'notification_group_label', ''),
        nullif(v_task.metadata ->> 'collection_label', ''),
        v_task.title
      );
      v_group_key := coalesce(
        nullif(v_task.metadata ->> 'notification_group_key', ''),
        trim(both '_' from lower(regexp_replace(v_group_label, '[^a-zA-Z0-9]+', '_', 'g')))
      );
      if v_group_key in ('owner', 'owner_work', 'today_s_work', '') then
        v_group_key := p_task_id::text;
      end if;

      return jsonb_build_object(
        'source', 'task_metadata',
        'releaseTime', to_char(v_release, 'HH24:MI'),
        'closeTime', case when v_close is null then null else to_char(v_close, 'HH24:MI') end,
        'nudgeMinutes', v_nudge,
        'groupKey', v_group_key || '@' || replace(to_char(v_release, 'HH24:MI'), ':', ''),
        'groupLabel', v_group_label
      );
    end if;
  end if;

  v_title := lower(coalesce(v_task.title, ''));
  v_action := lower(coalesce(nullif(v_task.action_key, ''), nullif(v_task.metadata ->> 'display_action', ''), ''));
  v_task_type := lower(coalesce(v_task.task_type, ''));
  v_collection := nullif(v_task.metadata ->> 'collection_label', '');

  if v_title like '%trash%' then
    v_release := time '19:00'; v_close := time '20:30'; v_nudge := 35; v_group_label := 'Trash to the street';
  elsif v_action = 'harvest' or v_task_type like '%harvest%' then
    v_release := time '06:30'; v_close := time '09:00'; v_nudge := 45; v_group_label := coalesce(v_collection, 'Morning harvest');
  elsif v_action in ('spray', 'respray') or v_task_type like '%spray%' then
    v_release := time '07:30'; v_close := time '10:30'; v_nudge := 60; v_group_label := coalesce(v_collection, 'Morning spraying');
  elsif v_action in ('weed', 'weeding') or v_task_type like '%weed%' then
    v_release := time '08:00'; v_close := time '11:30'; v_nudge := 60; v_group_label := coalesce(v_collection, 'Morning weeding');
  elsif v_action in ('sow', 'transplant', 'plant') or v_task_type in ('sowing', 'transplanting') then
    v_release := time '09:00'; v_close := time '13:00'; v_nudge := 60; v_group_label := coalesce(v_collection, 'Morning planting');
  elsif v_action in ('call', 'send', 'order', 'coordinate', 'network', 'email')
     or v_task_type in ('marketing', 'coordination', 'purchasing', 'owner_procurement') then
    v_release := case when coalesce(v_collection, '') = 'Saturday Purchases' then time '11:30' else time '10:00' end;
    v_close := case when coalesce(v_collection, '') = 'Saturday Purchases' then time '17:00' else time '15:00' end;
    v_nudge := 90; v_group_label := coalesce(v_collection, 'Calls and orders');
  elsif v_action = 'mow' or v_task_type like '%mow%' then
    v_release := time '15:00'; v_close := time '18:00'; v_nudge := 75; v_group_label := coalesce(v_collection, 'Afternoon mowing');
  elsif v_task_type = 'departure_prep' or v_action in ('pack', 'find', 'prepare') then
    v_release := time '16:00'; v_close := time '20:00'; v_nudge := 90; v_group_label := coalesce(v_collection, 'Departure preparation');
  elsif v_task_type like '%clean%' or v_action in ('clean', 'reset') then
    v_release := time '13:00'; v_close := time '17:00'; v_nudge := 90; v_group_label := coalesce(v_collection, 'Afternoon reset');
  else
    v_release := time '10:00'; v_close := time '17:00'; v_nudge := 90;
    v_group_label := coalesce(v_collection, nullif(v_task.metadata ->> 'collection_zone', ''), 'Today''s work');
  end if;

  v_group_key := trim(both '_' from lower(regexp_replace(coalesce(v_group_label, p_task_id::text), '[^a-zA-Z0-9]+', '_', 'g')));
  if v_group_key in ('owner', 'owner_work', 'today_s_work', '') then v_group_key := p_task_id::text; end if;

  return jsonb_build_object(
    'source', 'inferred_v1',
    'releaseTime', to_char(v_release, 'HH24:MI'),
    'closeTime', to_char(v_close, 'HH24:MI'),
    'nudgeMinutes', v_nudge,
    'groupKey', v_group_key || '@' || replace(to_char(v_release, 'HH24:MI'), ':', ''),
    'groupLabel', v_group_label
  );
end;
$function$;
