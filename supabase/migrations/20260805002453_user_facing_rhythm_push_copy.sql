create or replace function atlas.enqueue_journal_event_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_category text;
  v_title text;
  v_body text;
  v_deep_link text;
  v_task_title text;
  v_user record;
  v_preferences atlas.notification_preferences%rowtype;
  v_enabled boolean;
  v_not_before timestamptz;
  v_outbox_id uuid;
  v_inserted integer := 0;
begin
  v_category := atlas.notification_category_for_event_v1(new.id);
  if v_category is null then
    return new;
  end if;

  if new.task_id is not null then
    select nullif(t.title, '')
      into v_task_title
    from atlas.tasks t
    where t.id = new.task_id;
  end if;

  v_title := case v_category
    when 'rhythm_warning' then 'Atlas · Coming due'
    when 'rhythm_due' then 'Atlas · Due'
    when 'rhythm_failure' then 'Atlas · Overdue'
    when 'unlock' then 'Atlas · Move unlocked'
    when 'owner_decision' then 'Atlas · Owner decision'
    when 'other_player_result' then 'Atlas · Farm changed'
    else 'Atlas'
  end;

  v_body := left(
    case
      when v_category = 'rhythm_failure' and v_task_title is not null then
        v_task_title || ' is overdue.'
      when v_category = 'rhythm_failure' and coalesce(new.title, '') ~* ' weed rhythm fell out of rhythm$' then
        regexp_replace(new.title, ' weed rhythm fell out of rhythm$', ' needs weeding.', 'i')
      when v_category = 'rhythm_failure' then
        regexp_replace(
          coalesce(nullif(new.title, ''), 'A farm rhythm needs attention.'),
          ' fell out of rhythm$',
          ' is overdue.',
          'i'
        )
      when v_category = 'rhythm_due' and v_task_title is not null then
        v_task_title || ' is due.'
      when v_category = 'rhythm_warning' and v_task_title is not null then
        v_task_title || ' is coming due.'
      when v_category in ('rhythm_warning', 'rhythm_due') then
        coalesce(nullif(new.title, ''), 'A farm rhythm needs attention.')
      else
        coalesce(nullif(new.detail, ''), nullif(new.title, ''), 'A farm change is waiting in Atlas.')
    end,
    500
  );

  v_deep_link := atlas.bell_event_deep_link_v1(new.id);

  for v_user in
    select distinct fm.user_id, fm.role
    from atlas.farm_memberships fm
    where fm.farm_id = new.farm_id
      and fm.active
      and fm.user_id is not null
      and exists (
        select 1
        from atlas.push_subscriptions s
        where s.farm_id = new.farm_id
          and s.user_id = fm.user_id
          and s.status = 'active'
      )
      and (
        (new.assigned_user_id is not null and fm.user_id = new.assigned_user_id)
        or (new.assigned_user_id is null and fm.role in ('owner', 'manager'))
      )
      and atlas.notification_can_user_read_event_v1(new.id, fm.user_id)
  loop
    if v_category in ('unlock', 'owner_decision', 'other_player_result')
       and new.actor_user_id is not null
       and v_user.user_id = new.actor_user_id then
      continue;
    end if;

    select *
      into v_preferences
    from atlas.notification_preferences
    where user_id = v_user.user_id
      and farm_id = new.farm_id;

    v_enabled := coalesce(v_preferences.enabled, true)
      and coalesce(
        (coalesce(v_preferences.categories, atlas.web_push_default_categories_v1()) ->> v_category)::boolean,
        v_category <> 'other_player_result'
      );
    if not v_enabled then
      continue;
    end if;

    v_not_before := atlas.notification_next_available_at_v1(v_user.user_id, new.farm_id, now());
    v_outbox_id := atlas.enqueue_direct_push_v1(
      new.farm_id,
      v_user.user_id,
      v_category,
      v_title,
      v_body,
      v_deep_link,
      'journal:' || new.id::text || ':user:' || v_user.user_id::text || ':' || v_category,
      new.importance,
      v_not_before,
      jsonb_build_object(
        'journalEventId', new.id,
        'eventKind', new.event_kind,
        'category', v_category,
        'journalDate', new.journal_date
      )
    );
    if v_outbox_id is not null then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  if v_inserted > 0 then
    perform atlas.kick_web_push_dispatch_v1('journal_event');
  end if;
  return new;
end;
$function$;
