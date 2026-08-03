do $complete$
declare
  v_task_id uuid;
  v_owner_user_id uuid;
  v_owner_membership_id uuid;
  v_event_count integer;
  v_future_setup_count integer;
  v_outbox_count integer;
begin
  select t.id into v_task_id
  from atlas.tasks t
  join atlas.farms f on f.id = t.farm_id
  where f.stable_key = 'elm_farm'
    and t.metadata ->> 'task_key' = 'owner_20260804_build_thursday_event_bell_flow'
  order by t.created_at
  limit 1;

  select fm.user_id, fm.id
  into v_owner_user_id, v_owner_membership_id
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where f.stable_key = 'elm_farm' and fm.active and fm.role = 'owner'
  order by fm.created_at
  limit 1;

  select count(*)::integer into v_event_count
  from atlas.community_events ce
  join atlas.farms f on f.id = ce.farm_id
  where f.stable_key = 'elm_farm'
    and ce.program_id = (
      select cp.id from atlas.community_programs cp
      join atlas.farms pf on pf.id = cp.farm_id
      where pf.stable_key = 'elm_farm' and cp.stable_key = 'thursdays_at_elm'
    );

  select count(*)::integer into v_future_setup_count
  from atlas.planned_work_occurrences pwo
  where pwo.occurrence_key like 'community_thursday_wednesday_setup:%'
    and pwo.planned_due_date >= date '2026-08-05';

  select count(*)::integer into v_outbox_count
  from atlas.notification_outbox no
  join atlas.farms f on f.id = no.farm_id
  where f.stable_key = 'elm_farm'
    and no.dedupe_key like 'community-event-reminder:%';

  if v_task_id is null or v_owner_user_id is null or v_owner_membership_id is null then
    raise exception 'Community Thursday owner task or owner membership was not found.';
  end if;
  if v_event_count < 10 then
    raise exception 'Community Thursday event generation is incomplete: % events.', v_event_count;
  end if;
  if v_future_setup_count < 5 then
    raise exception 'Community Thursday setup recurrence is incomplete: % occurrences.', v_future_setup_count;
  end if;
  if v_outbox_count < 3 then
    raise exception 'Community Thursday member Bell reminder is incomplete: % recipients.', v_outbox_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'implementation_status', 'complete',
        'community_program_key', 'thursdays_at_elm',
        'community_event_key', 'thursdays_at_elm_2026_08_06_morning',
        'member_reminder_scheduled_for', '2026-08-05T19:00:00-05:00',
        'anna_setup_recurrence_installed', true,
        'completed_by_build', 'community_thursday_event_bell_flow_v1'
      ),
      updated_at = now()
  where id = v_task_id;

  perform atlas.record_task_transition_v1_internal(
    v_task_id,
    'done',
    'community-thursday-event-bell-flow-v1:2026-08-02',
    null,
    'Created the Thursdays at Elm program and August 6 community morning, scheduled the August 5 Bell reminder for every active Elm member, installed the first/third-morning and second/fourth-evening rhythm, and planned Anna''s Wednesday-night setup recurrence.',
    'Owner-authorized Atlas build completed.',
    'build',
    'community_thursday_event_bell_flow',
    jsonb_build_object(
      'actor_user_id', v_owner_user_id,
      'actor_membership_id', v_owner_membership_id,
      'actor_role', 'owner',
      'community_program_key', 'thursdays_at_elm',
      'community_event_key', 'thursdays_at_elm_2026_08_06_morning',
      'member_reminder_scheduled_for', '2026-08-05T19:00:00-05:00',
      'event_count', v_event_count,
      'setup_occurrence_count', v_future_setup_count,
      'member_recipient_count', v_outbox_count
    ),
    null
  );
end;
$complete$;
