-- Elm church outreach is one reusable Network checklist sequence:
-- contact attempts live as child tasks; confirmed visits live on the Thursdays at Elm calendar.

alter table atlas.community_events
  drop constraint if exists community_events_event_kind_check;

alter table atlas.community_events
  add constraint community_events_event_kind_check
  check (event_kind = any (array[
    'free_community_morning'::text,
    'ticketed_seasonal_evening'::text,
    'special_fifth_thursday'::text,
    'church_group_visit'::text
  ]));

do $$
declare
  v_farm_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_owner_user_id uuid;
  v_org_id uuid;
  v_batch1_id uuid;
  v_batch2_id uuid;
  v_common jsonb;
  v_script text := 'Hi, this is Anna from Elm Farm in Marshfield. We’re opening the farm to a few local church groups for free this month.\n\nWe’d love to have a [women’s group, moms group, small group, homeschool group, etc.] come out for an hour or two farm morning. We can have coffee ready, give them a place to gather outside, walk around the farm, and they can either just spend time together or join us in a little bit of whatever farm work is happening that morning.\n\nWe’re a working flower farm transitioning toward having an indoor venue, and want to start opening up the farm to local churches as we finish indoor renovations.\n\nIs there someone at your church who leads a group like that who I could send the invitation to?';
  v_voicemail text := 'Hi, this is Anna from Elm Farm in Marshfield. We’re inviting a few local church groups to use the farm for free for a small outdoor farm morning while we finish our venue renovations. I’d love to send the invitation to whoever coordinates your group. You can call or text Elm Farm back at (417) 319-4581. Thanks!';
begin
  select f.id, f.organization_id
    into v_farm_id, v_org_id
  from atlas.farms f
  where f.stable_key = 'elm_farm'
  limit 1;

  if v_farm_id is null then
    raise exception 'Elm Farm was not found';
  end if;

  select fm.id, fm.user_id
    into v_anna_membership_id, v_anna_user_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.worker_key = 'anna'
    and fm.active = true
  limit 1;

  select fm.user_id
    into v_owner_user_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.role = 'owner'
    and fm.active = true
  order by fm.created_at
  limit 1;

  if v_anna_membership_id is null then
    raise exception 'Anna membership was not found';
  end if;

  v_common := jsonb_build_object(
    'anna_task', true,
    'work_route', 'network',
    'work_rhythm', 'Network',
    'display_action', 'Network',
    'collection_zone', 'Network',
    'collection_label', 'Church Outreach',
    'display_location', 'Phone · Thursdays at Elm',
    'executor_role', 'farm_hand',
    'executor_label', 'Anna',
    'executor_worker_key', 'anna',
    'executor_membership_id', v_anna_membership_id,
    'checklist_mode', 'network_outreach',
    'network_outreach_master_task', true,
    'task_result_mode', 'standard_execution',
    'preferred_call_window', '10:00–11:30 AM',
    'callback_number', '(417) 319-4581',
    'callback_note', 'Call from Elm’s Google Voice number. Return calls to this number forward to your phone.',
    'outreach_objective', 'Fill Elm’s upcoming Thursdays with small local church groups.',
    'outreach_script', v_script,
    'voicemail_script', v_voicemail,
    'outdoor_only', true,
    'free_use', true,
    'guest_restroom_available', false,
    'booking_rule', 'Only offer Thursdays. Before confirming a booking, tell them there is currently no guest restroom available and the visit is outdoor-only.',
    'if_they_ask', jsonb_build_array(
      'How much? Free.',
      'How long? About 60–90 minutes; up to two hours if it makes sense.',
      'What happens? Coffee, outdoor gathering space, a farm walk, and optional participation in whatever farm work is happening.',
      'Is this a finished venue? No. Elm is a working flower farm and the indoor venue is still being renovated.',
      'Restroom? There is currently no guest restroom available, so these first visits are outdoor-only.'
    ),
    'thursday_slots', jsonb_build_array(
      jsonb_build_object('start','09:30','end','11:00','label','9:30–11:00'),
      jsonb_build_object('start','11:30','end','13:00','label','11:30–1:00'),
      jsonb_build_object('start','13:30','end','15:00','label','1:30–3:00'),
      jsonb_build_object('start','15:30','end','17:00','label','3:30–5:00')
    ),
    'thursday_options', jsonb_build_array(
      '2026-08-13','2026-08-20','2026-08-27','2026-09-03',
      '2026-09-10','2026-09-17','2026-09-24','2026-10-01'
    ),
    'created_source', 'owner_instruction_20260808_church_outreach'
  );

  select t.id into v_batch1_id
  from atlas.tasks t
  where t.farm_id = v_farm_id
    and t.metadata ->> 'task_key' = 'network_20260725_call_10_churches'
  order by t.created_at desc
  limit 1;

  if v_batch1_id is null then
    raise exception 'Existing church outreach task was not found';
  end if;

  update atlas.tasks
  set title = 'Network — Invite 5 Local Church Groups to Elm',
      note = 'Fill Elm’s upcoming Thursdays. Call these five churches and invite one of their groups to a free 60–90 minute outdoor Elm Farm visit on a Thursday. Record every attempt and book a Thursday when someone is interested.',
      assigned_membership_id = v_anna_membership_id,
      assigned_user_id = v_anna_user_id,
      visibility_scope = 'assigned_worker',
      blocker_text = null,
      metadata = (coalesce(metadata, '{}'::jsonb)
        - 'network_saturday'
        - 'network_shift_reason'
        - 'network_shifted_one_week_at'
        - 'shifted_by_owner_request')
        || v_common
        || jsonb_build_object(
          'task_key', 'network_20260725_call_10_churches',
          'batch_number', 1,
          'display_subject', 'Fill Elm’s Thursdays · first 5 churches',
          'checklist_heading', 'Churches to call',
          'completion_label', 'I’m ready for the next five churches',
          'next_batch_task_key', 'anna_20260812_church_outreach_batch_2'
        ),
      updated_at = now()
  where id = v_batch1_id;

  perform atlas.record_task_transition_v1(
    v_batch1_id,
    'rescheduled',
    'church-outreach-batch-1-20260811',
    date '2026-08-11',
    null,
    'Prepared as the first Thursday church-outreach batch',
    'network',
    'network',
    jsonb_build_object('source','owner_instruction_20260808_church_outreach'),
    null
  );

  -- First five: children of the existing canonical task.
  insert into atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    note, action_key, work_class, parent_task_id, assigned_membership_id,
    assigned_user_id, visibility_scope, created_by_user_id, origin_kind,
    task_scope, work_lane, commitment_kind, effort_units, released_at,
    release_reason, metadata
  )
  select
    v_farm_id, v_org_id, 'Checklist — ' || x.church_name, 'checklist_step', 'open', 'normal', date '2026-08-11',
    null, 'checklist_step', 'standard', v_batch1_id, v_anna_membership_id,
    v_anna_user_id, 'assigned_worker', v_owner_user_id, 'owner_assigned',
    'farm_operation', 'discretionary', 'floating', 0.25, now(),
    'owner_instruction_20260808_church_outreach',
    jsonb_build_object(
      'task_key', x.task_key,
      'anna_task', true,
      'step_order', x.step_order,
      'work_route', 'network',
      'work_rhythm', 'Network',
      'subtask_kind', 'network_outreach_contact',
      'is_child_task', true,
      'parent_task_id', v_batch1_id,
      'checklist_label', x.church_name,
      'checklist_status', 'open',
      'collection_label', 'Church Outreach',
      'display_subject', x.church_name,
      'church_name', x.church_name,
      'church_address', x.church_address,
      'church_phone', x.church_phone,
      'church_email', x.church_email,
      'suggested_group', x.suggested_group,
      'suggested_contact', x.suggested_contact,
      'network_log_enabled', true,
      'network_log_prompt', 'Record who you reached, what happened, the best contact, follow-up, and any Thursday booking.',
      'result_storage', 'task_note_and_network_outreach_result',
      'created_source', 'owner_instruction_20260808_church_outreach'
    )
  from (values
    (1, 'anna_church_outreach_b1_faith_southern', 'Faith Southern Baptist Church', '1002 S Marshall St, Marshfield, MO 65706', '417-859-3125', 'office@faithsbcmo.com', 'MarCHE homeschool group or Sisters of Faith', null),
    (2, 'anna_church_outreach_b1_kingdom', 'Kingdom Church', '1235 Spur Dr, Marshfield, MO 65706', '417-413-4635', 'hello@kingdomchurch.info', 'Young Families or Single Moms Community Group', null),
    (3, 'anna_church_outreach_b1_hope_nazarene', 'Hope Church of the Nazarene', '226 Church St, Marshfield, MO 65706', '417-241-6868', null, 'Women’s Ministry', 'Bridget Grier'),
    (4, 'anna_church_outreach_b1_marshfield_ag', 'Marshfield Assembly of God', '1538 W Washington St, Marshfield, MO 65706', '417-859-4065', 'magsec1538@gmail.com', 'Women’s Ministry', null),
    (5, 'anna_church_outreach_b1_marshfield_first', 'Marshfield First', '1001 S White Oak Rd, Marshfield, MO 65706', '417-468-2330', 'Jimmy@MarshfieldFirst.org', 'Connect Groups', 'Jimmy Hammond · Discipleship Pastor')
  ) as x(step_order, task_key, church_name, church_address, church_phone, church_email, suggested_group, suggested_contact)
  where not exists (
    select 1 from atlas.tasks existing
    where existing.farm_id = v_farm_id and existing.metadata ->> 'task_key' = x.task_key
  );

  -- Batch two exists canonically but remains blocked until Batch one is completed.
  select t.id into v_batch2_id
  from atlas.tasks t
  where t.farm_id = v_farm_id
    and t.metadata ->> 'task_key' = 'anna_20260812_church_outreach_batch_2'
  limit 1;

  if v_batch2_id is null then
    v_batch2_id := gen_random_uuid();
    insert into atlas.tasks (
      id, farm_id, organization_id, title, task_type, status, priority, due_date,
      note, blocker_text, action_key, work_class, assigned_membership_id,
      assigned_user_id, visibility_scope, created_by_user_id, origin_kind,
      task_scope, work_lane, commitment_kind, effort_units, metadata
    ) values (
      v_batch2_id, v_farm_id, v_org_id, 'Network — Invite 5 More Local Church Groups to Elm', 'network', 'blocked', 'normal', date '2026-08-12',
      'Keep filling Elm’s upcoming Thursdays. Contact the next five researched church groups, record every attempt, and book a Thursday when someone is interested.',
      'Finish the first five church contacts first.', 'network', 'standard', v_anna_membership_id,
      v_anna_user_id, 'assigned_worker', v_owner_user_id, 'owner_assigned',
      'farm_operation', 'discretionary', 'floating', 1,
      v_common || jsonb_build_object(
        'task_key', 'anna_20260812_church_outreach_batch_2',
        'batch_number', 2,
        'display_subject', 'Fill Elm’s Thursdays · next 5 churches',
        'checklist_heading', 'Next churches to call',
        'completion_label', 'I’ve contacted these five',
        'prerequisite_task_key', 'network_20260725_call_10_churches',
        'prerequisite_gate_state', 'blocked'
      )
    );
  end if;

  insert into atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    note, blocker_text, action_key, work_class, parent_task_id,
    assigned_membership_id, assigned_user_id, visibility_scope,
    created_by_user_id, origin_kind, task_scope, work_lane, commitment_kind,
    effort_units, metadata
  )
  select
    v_farm_id, v_org_id, 'Checklist — ' || x.church_name, 'checklist_step', 'blocked', 'normal', date '2026-08-12',
    null, 'Waiting for the first church outreach batch.', 'checklist_step', 'standard', v_batch2_id,
    v_anna_membership_id, v_anna_user_id, 'assigned_worker', v_owner_user_id,
    'owner_assigned', 'farm_operation', 'discretionary', 'floating', 0.25,
    jsonb_build_object(
      'task_key', x.task_key,
      'anna_task', true,
      'step_order', x.step_order,
      'work_route', 'network',
      'work_rhythm', 'Network',
      'subtask_kind', 'network_outreach_contact',
      'is_child_task', true,
      'parent_task_id', v_batch2_id,
      'checklist_label', x.church_name,
      'checklist_status', 'open',
      'collection_label', 'Church Outreach',
      'display_subject', x.church_name,
      'church_name', x.church_name,
      'church_address', x.church_address,
      'church_phone', x.church_phone,
      'church_email', x.church_email,
      'suggested_group', x.suggested_group,
      'suggested_contact', x.suggested_contact,
      'network_log_enabled', true,
      'network_log_prompt', 'Record who you reached, what happened, the best contact, follow-up, and any Thursday booking.',
      'result_storage', 'task_note_and_network_outreach_result',
      'created_source', 'owner_instruction_20260808_church_outreach'
    )
  from (values
    (1, 'anna_church_outreach_b2_high_street', 'High Street Church', '900 N Eastgate Ave, Springfield, MO 65802', '417-862-5502', 'community@highstreet.org', 'High Street Women, Mom’s Group, or Growing Families', null),
    (2, 'anna_church_outreach_b2_southland', 'Southland Christian Church', '1630 W Republic Rd, Springfield, MO 65807', '417-881-7405', 'kristie@gosouthland.org', 'Women’s Ministry or Box Top Girls moms', 'Kristie Martin · Women’s Minister'),
    (3, 'anna_church_outreach_b2_seas', 'St. Elizabeth Ann Seton Catholic Church', '2200 W Republic Rd, Springfield, MO 65807', '417-887-6472', 'parishinfo@seaschurch.org', 'Catholic Moms Group, PCCW, or a women’s guild', null),
    (4, 'anna_church_outreach_b2_park_crest', 'Park Crest Baptist Church', '816 W Republic Rd, Springfield, MO 65807', '417-883-1676', null, 'Women’s Ministries or a Grow Group', 'Stephanie Housley · Women’s Ministries'),
    (5, 'anna_church_outreach_b2_one_community', 'One Community Church', '355 N Missouri Blvd, Rogersville, MO 65742', '417-408-1928', null, 'Women’s Ministry or a Community Group', null)
  ) as x(step_order, task_key, church_name, church_address, church_phone, church_email, suggested_group, suggested_contact)
  where not exists (
    select 1 from atlas.tasks existing
    where existing.farm_id = v_farm_id and existing.metadata ->> 'task_key' = x.task_key
  );

  -- The owner setup task is now factually complete: Elm's Voice number is live on Anna's phone.
  perform atlas.record_task_transition_v1(
    t.id,
    'done',
    'elm-google-voice-confirmed-20260808',
    null,
    'Elm Farm Google Voice is active at (417) 319-4581 and forwards to Anna’s phone.',
    'Owner confirmed setup complete',
    'network',
    'network',
    jsonb_build_object(
      'source', 'owner_confirmation_20260808',
      'elm_callback_number', '(417) 319-4581',
      'forwards_to_anna', true
    ),
    null
  )
  from atlas.tasks t
  where t.farm_id = v_farm_id
    and t.metadata ->> 'task_key' = 'owner_20260804_get_elm_google_voice_number'
    and t.status <> 'done';
end
$$;
