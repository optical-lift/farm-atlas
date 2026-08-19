create or replace function atlas.ensure_thursday_morning_cluster_occurrences_v2()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_cluster text;
  v_prefix text;
  v_state text;
  v_gate_satisfied_at timestamptz;
begin
  if new.occurrence_key not like 'community_thursday_wednesday_rooms:%' then
    return new;
  end if;

  v_state := case when new.state in ('planned','eligible','failed') then new.state else 'eligible' end;
  v_gate_satisfied_at := case when v_state = 'eligible' then coalesce(new.gate_satisfied_at,now()) else null end;

  -- Kitchen trash is part of the room/guest-readiness round. It must not
  -- become a separate one-line task.
  foreach v_cluster in array array['outdoor','coffee_water']
  loop
    v_prefix := 'community_thursday_wednesday_' || v_cluster || ':';

    insert into atlas.planned_work_occurrences (
      farm_id, work_definition_id, release_policy_id, parent_occurrence_id,
      occurrence_key, source_kind, source_id, source_event_key, title,
      planned_due_date, not_before_date, state, gate_satisfied_at,
      task_payload, relation_payload, metadata, work_lane, commitment_kind, effort_units
    ) values (
      new.farm_id, new.work_definition_id, new.release_policy_id, null,
      v_prefix || new.planned_due_date::text,
      new.source_kind, new.source_id, new.source_event_key, new.title,
      new.planned_due_date, new.not_before_date, v_state, v_gate_satisfied_at,
      new.task_payload, new.relation_payload,
      coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'clusterSeededFromOccurrenceId',new.id,
        'clusterSeededAt',now()
      ),
      'required','hard_date',0.10
    )
    on conflict (farm_id, work_definition_id, occurrence_key) do update
    set release_policy_id = excluded.release_policy_id,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        source_event_key = excluded.source_event_key,
        title = excluded.title,
        planned_due_date = excluded.planned_due_date,
        not_before_date = excluded.not_before_date,
        state = case
          when atlas.planned_work_occurrences.state in ('released','completed') then atlas.planned_work_occurrences.state
          else excluded.state
        end,
        gate_satisfied_at = case
          when atlas.planned_work_occurrences.state in ('released','completed') then atlas.planned_work_occurrences.gate_satisfied_at
          else excluded.gate_satisfied_at
        end,
        task_payload = excluded.task_payload,
        relation_payload = excluded.relation_payload,
        metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
        work_lane = excluded.work_lane,
        commitment_kind = excluded.commitment_kind,
        effort_units = excluded.effort_units,
        updated_at = now();
  end loop;

  return new;
end;
$function$;

create or replace function atlas.normalize_thursday_morning_cluster_occurrence_v2()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_cluster text;
  v_suffix text;
  v_definition_key text;
  v_policy_key text;
  v_series_key text;
  v_title text;
  v_display_action text;
  v_display_subject text;
  v_display_detail text;
  v_display_location text;
  v_kicker text;
  v_checklist_title text;
  v_completion_label text;
  v_template_key text;
  v_day_order integer;
  v_effort numeric;
  v_definition_id uuid;
  v_policy_id uuid;
  v_task_metadata jsonb;
begin
  if new.occurrence_key like 'community_thursday_wednesday_setup:%' then
    v_cluster := 'rooms';
    v_suffix := split_part(new.occurrence_key, ':', 2);
    new.occurrence_key := 'community_thursday_wednesday_rooms:' || v_suffix;
  elsif new.occurrence_key like 'community_thursday_wednesday_outdoor:%' then
    v_cluster := 'outdoor';
    v_suffix := split_part(new.occurrence_key, ':', 2);
  elsif new.occurrence_key like 'community_thursday_wednesday_coffee_water:%' then
    v_cluster := 'coffee_water';
    v_suffix := split_part(new.occurrence_key, ':', 2);
  elsif new.occurrence_key like 'community_thursday_wednesday_rooms:%' then
    v_cluster := 'rooms';
    v_suffix := split_part(new.occurrence_key, ':', 2);
  elsif new.occurrence_key like 'community_thursday_wednesday_trash:%' then
    v_cluster := 'trash';
    v_suffix := split_part(new.occurrence_key, ':', 2);
  else
    return new;
  end if;

  if v_cluster = 'outdoor' then
    v_definition_key := 'community_thursday_morning_cluster:outdoor:v2';
    v_policy_key := 'community_thursday_morning_cluster:outdoor:v2:time_window';
    v_series_key := 'community_thursday_wednesday_outdoor';
    v_title := 'Close the Farm Work Areas';
    v_display_action := 'Close';
    v_display_subject := 'Farm work areas';
    v_display_detail := 'Tools · work areas · harvest buckets';
    v_display_location := 'Farm work areas';
    v_kicker := 'Farm close';
    v_checklist_title := 'Outdoor closing round';
    v_completion_label := 'Farm work areas are closed';
    v_template_key := 'community_thursday_morning_outdoor_v2';
    v_day_order := 910;
    v_effort := 0.15;
  elsif v_cluster = 'coffee_water' then
    v_definition_key := 'community_thursday_morning_cluster:coffee_water:v2';
    v_policy_key := 'community_thursday_morning_cluster:coffee_water:v2:time_window';
    v_series_key := 'community_thursday_wednesday_coffee_water';
    v_title := 'Prepare Coffee + Water';
    v_display_action := 'Prepare';
    v_display_subject := 'Coffee + water';
    v_display_detail := 'Keurig · real mugs · water';
    v_display_location := 'Coffee Bar';
    v_kicker := 'Coffee + water';
    v_checklist_title := 'Coffee + water setup';
    v_completion_label := 'Coffee + water are ready';
    v_template_key := 'community_thursday_morning_coffee_water_v2';
    v_day_order := 920;
    v_effort := 0.05;
  elsif v_cluster = 'rooms' then
    v_definition_key := 'community_thursday_morning_cluster:rooms:v2';
    v_policy_key := 'community_thursday_morning_cluster:rooms:v2:time_window';
    v_series_key := 'community_thursday_wednesday_rooms';
    v_title := 'Ready the Guest Rooms';
    v_display_action := 'Ready';
    v_display_subject := 'Guest rooms';
    v_display_detail := 'Library · Meeting Room · Kitchen trash';
    v_display_location := 'Library · Meeting Room · Kitchen';
    v_kicker := 'Room checks';
    v_checklist_title := 'Guest room checks';
    v_completion_label := 'Guest rooms are ready';
    v_template_key := 'community_thursday_morning_rooms_v2';
    v_day_order := 930;
    v_effort := 0.15;
  else
    -- Legacy only. New recurrence generation no longer creates this cluster.
    v_definition_key := 'community_thursday_morning_cluster:trash:v2';
    v_policy_key := 'community_thursday_morning_cluster:trash:v2:time_window';
    v_series_key := 'community_thursday_wednesday_trash';
    v_title := 'Take Out the Kitchen Trash';
    v_display_action := 'Take out';
    v_display_subject := 'Kitchen trash';
    v_display_detail := 'Kitchen';
    v_display_location := 'Kitchen';
    v_kicker := 'Closing';
    v_checklist_title := 'Kitchen trash';
    v_completion_label := 'Kitchen trash is out';
    v_template_key := 'community_thursday_morning_trash_v2';
    v_day_order := 940;
    v_effort := 0.05;
  end if;

  select id into v_definition_id
  from atlas.work_definitions
  where farm_id = new.farm_id and stable_key = v_definition_key and active
  limit 1;

  select id into v_policy_id
  from atlas.work_release_policies
  where farm_id = new.farm_id and stable_key = v_policy_key and active
  limit 1;

  if v_definition_id is null or v_policy_id is null then
    raise exception 'Thursday morning cluster release contract is missing for %.', v_cluster using errcode = 'P0002';
  end if;

  v_task_metadata := (coalesce(new.task_payload -> 'metadata','{}'::jsonb)
    - 'detail_lines'
    - 'execution_checklist_template_key'
    - 'execution_checklist_title'
    - 'execution_checklist_completion_label')
    || jsonb_build_object(
      'task_key','anna_' || replace(new.planned_due_date::text,'-','') || '_thursday_morning_' || v_cluster,
      'anna_task',true,
      'owner_task',false,
      'marshall_task',false,
      'assigned_to','Anna',
      'assignee_key','anna',
      'work_route','prepare',
      'created_source','owner_instruction_20260804',
      'task_instruction',v_title,
      'display_action',v_display_action,
      'display_subject',v_display_subject,
      'display_detail',v_display_detail,
      'display_location',v_display_location,
      'collection_zone','Venue',
      'collection_label','Thursday Morning Prep',
      'day_order',v_day_order,
      'thursday_morning_cluster_key',v_cluster,
      'execution_checklist_kicker',v_kicker,
      'execution_checklist_title',v_checklist_title,
      'execution_checklist_completion_label',v_completion_label,
      'execution_checklist_template_key',v_template_key,
      'checklist_visibility','fully_visible_on_task_card',
      'paid_event_scope',false,
      'recurrence_pattern','Wednesday before first and third Thursday community mornings',
      'contract_version','thursday_morning_clusters_v2'
    );

  new.work_definition_id := v_definition_id;
  new.release_policy_id := v_policy_id;
  new.title := v_title;
  new.work_lane := 'required';
  new.commitment_kind := 'hard_date';
  new.effort_units := v_effort;
  new.task_payload := coalesce(new.task_payload,'{}'::jsonb)
    || jsonb_build_object(
      'title',v_title,
      'priority','high',
      'due_date',new.planned_due_date,
      'task_type','event_setup',
      'action_key','prepare',
      'work_class','light',
      'task_scope','farm_operation',
      'origin_kind','owner_assigned',
      'visibility_scope','assigned_worker',
      'task_series_key',v_series_key,
      'engine_instance_key','recurring:' || v_series_key || ':' || new.planned_due_date::text,
      'metadata',v_task_metadata
    );
  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'program_key','thursdays_at_elm',
    'thursdayMorningClusterKey',v_cluster,
    'executionChecklistTemplateKey',v_template_key,
    'normalizedBy','normalize_thursday_morning_cluster_occurrence_v2'
  );
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function atlas.seed_task_execution_checklist_v1(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_template text;
  v_inserted integer := 0;
  v_expected_minutes integer;
  v_physical_load text;
  v_round_key text;
  v_owner_note text;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then return 0; end if;

  v_template := coalesce(v_task.metadata ->> 'execution_checklist_template_key','');
  if v_template not in (
    'community_thursday_morning_outdoor_v2',
    'community_thursday_morning_coffee_water_v2',
    'community_thursday_morning_rooms_v2'
  ) then
    return 0;
  end if;

  insert into atlas.task_execution_checklist_items (
    farm_id, task_id, item_key, section_key, section_label, item_label, sort_order, required, metadata
  )
  select
    v_task.farm_id,
    v_task.id,
    template.item_key,
    template.section_key,
    template.section_label,
    template.item_label,
    template.sort_order,
    template.required,
    jsonb_build_object('templateKey', template.template_key, 'clusterKey', template.cluster_key)
      || case when template.crossed_out then jsonb_build_object('crossedOut',true,'crossedOutReason','Bathroom is unfinished and not usable by guests.') else '{}'::jsonb end
  from (values
    ('community_thursday_morning_outdoor_v2','outdoor','store_farm_tools','outdoor','Farm work areas','Store farm tools in their proper places',10,true,false),
    ('community_thursday_morning_outdoor_v2','outdoor','tidy_farm_work_areas','outdoor','Farm work areas','Tidy the farm work areas',20,true,false),
    ('community_thursday_morning_outdoor_v2','outdoor','wash_stage_harvest_buckets','outdoor','Farm work areas','Wash and stage the harvest buckets',30,true,false),
    ('community_thursday_morning_coffee_water_v2','coffee_water','restock_reset_coffee_bar','coffee_water','Coffee + water','Set out the Keurig and real mugs',20,true,false),
    ('community_thursday_morning_coffee_water_v2','coffee_water','refill_water_dispenser','coffee_water','Coffee + water','Set out the water dispenser',30,true,false),
    ('community_thursday_morning_rooms_v2','rooms','bathroom_ready','rooms','Room checks','C̶l̶e̶a̶n̶ ̶a̶n̶d̶ ̶s̶t̶o̶c̶k̶ ̶t̶h̶e̶ ̶b̶a̶t̶h̶r̶o̶o̶m̶',10,false,true),
    ('community_thursday_morning_rooms_v2','rooms','library_ready','rooms','Room checks','Clear and reset the Library until it is visibly guest-ready',20,true,false),
    ('community_thursday_morning_rooms_v2','rooms','meeting_room_ready','rooms','Room checks','Clear and reset the meeting room until it is visibly guest-ready',30,true,false),
    ('community_thursday_morning_rooms_v2','rooms','take_out_kitchen_trash','rooms','Room checks','Take out the kitchen trash',40,true,false)
  ) as template(template_key, cluster_key, item_key, section_key, section_label, item_label, sort_order, required, crossed_out)
  where template.template_key = v_template
  on conflict (task_id, item_key) do update
  set section_key = excluded.section_key,
      section_label = excluded.section_label,
      item_label = excluded.item_label,
      sort_order = excluded.sort_order,
      required = excluded.required,
      metadata = (atlas.task_execution_checklist_items.metadata - 'retired' - 'retiredAt' - 'crossedOut' - 'crossedOutReason') || excluded.metadata,
      updated_at = now();

  get diagnostics v_inserted = row_count;

  select expected_minutes, physical_load, round_key, owner_note
  into v_expected_minutes, v_physical_load, v_round_key, v_owner_note
  from (values
    ('community_thursday_morning_outdoor_v2',35,'moderate','thursday_morning_outdoor_close','Private owner estimate for closing the farm work areas.'),
    ('community_thursday_morning_coffee_water_v2',10,'light','thursday_morning_coffee_water','Private owner estimate for free-Thursday Keurig, mugs, and water setup.'),
    ('community_thursday_morning_rooms_v2',40,'moderate','thursday_morning_room_checks','Private owner estimate for Library, meeting room, and kitchen-trash checks; bathroom is currently unusable.')
  ) as profile(template_key, expected_minutes, physical_load, round_key, owner_note)
  where profile.template_key = v_template;

  insert into atlas.task_capacity_profiles (
    task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class,
    micro_round_key, estimate_source, estimate_confidence, owner_locked, owner_note, metadata
  ) values (
    v_task.id, v_task.farm_id, v_expected_minutes, v_physical_load, 'hard_window',
    v_round_key, 'template:' || v_template, 'rule', false, v_owner_note,
    jsonb_build_object('templateKey',v_template,'clusteredThursdayMorning',true)
  )
  on conflict (task_id) do update
  set expected_active_minutes = excluded.expected_active_minutes,
      physical_load = excluded.physical_load,
      base_obligation_class = excluded.base_obligation_class,
      micro_round_key = excluded.micro_round_key,
      estimate_source = excluded.estimate_source,
      estimate_confidence = excluded.estimate_confidence,
      owner_note = excluded.owner_note,
      metadata = atlas.task_capacity_profiles.metadata || excluded.metadata,
      updated_at = now()
  where not atlas.task_capacity_profiles.owner_locked;

  return v_inserted;
end;
$function$;

create or replace function atlas.task_execution_checklist_v1(p_task_id uuid, p_effective_membership_id uuid default null::uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_items jsonb;
  v_total integer;
  v_complete integer;
begin
  v_context := atlas.task_execution_checklist_context_v1(p_task_id, p_effective_membership_id);
  select * into v_task from atlas.tasks where id = p_task_id;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'itemId', item.id,
        'itemKey', item.item_key,
        'sectionKey', item.section_key,
        'sectionLabel', item.section_label,
        'label', item.item_label,
        'sortOrder', item.sort_order,
        'required', item.required,
        'checked', item.checked,
        'checkedAt', item.checked_at,
        'crossedOut', coalesce((item.metadata ->> 'crossedOut')::boolean,false)
      ) order by item.sort_order, item.item_key
    ), '[]'::jsonb),
    count(*) filter (where coalesce(item.metadata ->> 'crossedOut','false') <> 'true')::integer,
    count(*) filter (where item.checked and coalesce(item.metadata ->> 'crossedOut','false') <> 'true')::integer
  into v_items, v_total, v_complete
  from atlas.task_execution_checklist_items item
  where item.task_id = p_task_id
    and coalesce(item.metadata ->> 'retired', 'false') <> 'true';

  return jsonb_build_object(
    'taskId', v_task.id,
    'title', coalesce(nullif(v_task.metadata ->> 'execution_checklist_title',''), v_task.title),
    'completionLabel', coalesce(nullif(v_task.metadata ->> 'execution_checklist_completion_label',''), 'Finish task'),
    'items', v_items,
    'totalCount', coalesce(v_total,0),
    'completeCount', coalesce(v_complete,0),
    'ready', not exists (
      select 1
      from atlas.task_execution_checklist_items required_item
      where required_item.task_id = p_task_id
        and required_item.required
        and not required_item.checked
        and coalesce(required_item.metadata ->> 'retired', 'false') <> 'true'
    ) and coalesce(v_total,0) > 0
  );
end;
$function$;