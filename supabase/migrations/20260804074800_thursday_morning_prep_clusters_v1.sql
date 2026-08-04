-- Split the regular Thursday-morning Wednesday close into four calm, themed work clusters.
-- Each cluster is a top-level task with its own visible checklist and private capacity weight.

begin;

create or replace function atlas.seed_task_execution_checklist_v1(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_template_key text;
  v_inserted integer := 0;
  v_minutes integer;
  v_physical_load text;
  v_micro_round_key text;
  v_owner_note text;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then return 0; end if;

  v_template_key := coalesce(v_task.metadata ->> 'execution_checklist_template_key','');
  if v_template_key not in (
    'community_thursday_farm_close_v1',
    'community_thursday_guest_rooms_v1',
    'community_thursday_coffee_water_v1',
    'community_thursday_kitchen_trash_v1'
  ) then
    return 0;
  end if;

  delete from atlas.task_execution_checklist_items item
  where item.task_id = v_task.id
    and coalesce(item.metadata ->> 'templateKey','') is distinct from v_template_key;

  insert into atlas.task_execution_checklist_items (
    farm_id, task_id, item_key, section_key, section_label,
    item_label, sort_order, required, metadata
  )
  select
    v_task.farm_id,
    v_task.id,
    template.item_key,
    template.section_key,
    template.section_label,
    template.item_label,
    template.sort_order,
    true,
    jsonb_build_object('templateKey', v_template_key)
  from (values
    ('community_thursday_farm_close_v1','store_farm_tools','farm_close','Farm close','Store farm tools in their proper places',10),
    ('community_thursday_farm_close_v1','tidy_farm_work_areas','farm_close','Farm close','Tidy the farm work areas',20),
    ('community_thursday_farm_close_v1','wash_stage_harvest_buckets','farm_close','Farm close','Wash and stage the harvest buckets',30),

    ('community_thursday_guest_rooms_v1','bathroom_clean_ready','bathroom','Bathroom','Clean the bathroom and leave it ready for guests',10),
    ('community_thursday_guest_rooms_v1','bathroom_supplies_stocked','bathroom','Bathroom','Stock the bathroom supplies',20),
    ('community_thursday_guest_rooms_v1','library_clear_reset','library','Library','Clear the Library surfaces and reset the furniture',30),
    ('community_thursday_guest_rooms_v1','library_visibly_ready','library','Library','Leave the Library visibly guest-ready',40),
    ('community_thursday_guest_rooms_v1','meeting_clear_reset','meeting_room','Meeting room','Clear the meeting room surfaces and reset the furniture',50),
    ('community_thursday_guest_rooms_v1','meeting_visibly_ready','meeting_room','Meeting room','Leave the meeting room visibly guest-ready',60),

    ('community_thursday_coffee_water_v1','make_cold_brew','coffee_water','Coffee and water','Make cold brew and refrigerate it overnight',10),
    ('community_thursday_coffee_water_v1','restock_reset_coffee_bar','coffee_water','Coffee and water','Restock and reset the coffee bar',20),
    ('community_thursday_coffee_water_v1','refill_water_dispenser','coffee_water','Coffee and water','Refill the water dispenser',30),

    ('community_thursday_kitchen_trash_v1','take_out_kitchen_trash','kitchen_trash','Kitchen trash','Take out the kitchen trash',10)
  ) as template(template_key, item_key, section_key, section_label, item_label, sort_order)
  where template.template_key = v_template_key
  on conflict (task_id, item_key) do update
  set section_key = excluded.section_key,
      section_label = excluded.section_label,
      item_label = excluded.item_label,
      sort_order = excluded.sort_order,
      required = true,
      metadata = atlas.task_execution_checklist_items.metadata || excluded.metadata,
      updated_at = now();

  get diagnostics v_inserted = row_count;

  select
    case v_template_key
      when 'community_thursday_farm_close_v1' then 40
      when 'community_thursday_guest_rooms_v1' then 50
      when 'community_thursday_coffee_water_v1' then 25
      when 'community_thursday_kitchen_trash_v1' then 5
    end,
    case v_template_key
      when 'community_thursday_farm_close_v1' then 'moderate'
      else 'light'
    end,
    case v_template_key
      when 'community_thursday_farm_close_v1' then 'thursday_farm_close'
      when 'community_thursday_guest_rooms_v1' then 'thursday_guest_rooms'
      when 'community_thursday_coffee_water_v1' then 'thursday_coffee_water'
      when 'community_thursday_kitchen_trash_v1' then 'thursday_kitchen_trash'
    end,
    case v_template_key
      when 'community_thursday_farm_close_v1' then 'Private owner capacity estimate for closing the farm work areas.'
      when 'community_thursday_guest_rooms_v1' then 'Private owner capacity estimate for the bathroom, Library, and meeting room reset.'
      when 'community_thursday_coffee_water_v1' then 'Private owner capacity estimate for cold brew, coffee bar, and guest water.'
      when 'community_thursday_kitchen_trash_v1' then 'Private owner capacity estimate for taking out the kitchen trash.'
    end
  into v_minutes, v_physical_load, v_micro_round_key, v_owner_note;

  insert into atlas.task_capacity_profiles (
    task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class,
    micro_round_key, estimate_source, estimate_confidence, owner_locked, owner_note, metadata
  ) values (
    v_task.id, v_task.farm_id, v_minutes, v_physical_load, 'hard_window',
    v_micro_round_key, 'template:' || v_template_key, 'rule', false,
    v_owner_note, jsonb_build_object('templateKey',v_template_key,'clusteredThursdayPrep',true)
  )
  on conflict (task_id) do update
  set expected_active_minutes = excluded.expected_active_minutes,
      physical_load = excluded.physical_load,
      base_obligation_class = 'hard_window',
      micro_round_key = excluded.micro_round_key,
      estimate_source = excluded.estimate_source,
      estimate_confidence = 'rule',
      owner_note = excluded.owner_note,
      metadata = atlas.task_capacity_profiles.metadata || excluded.metadata,
      updated_at = now()
  where not atlas.task_capacity_profiles.owner_locked;

  return v_inserted;
end;
$function$;

create or replace function atlas.normalize_thursday_morning_prep_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_cluster_key text;
  v_series_key text;
  v_template_key text;
  v_title text;
  v_note text;
  v_checklist_title text;
  v_completion_label text;
  v_display_action text;
  v_display_subject text;
  v_display_detail text;
  v_display_location text;
  v_day_order integer;
  v_effort_units numeric;
  v_metadata jsonb;
begin
  if new.occurrence_key like 'community_thursday_wednesday_farm_close:%' then
    v_cluster_key := 'farm_close';
    v_series_key := 'community_thursday_wednesday_farm_close';
    v_template_key := 'community_thursday_farm_close_v1';
    v_title := 'Close the Farm Work Areas';
    v_note := 'Store and tidy the farm-side work so Thursday morning begins cleanly.';
    v_checklist_title := 'Farm close';
    v_completion_label := 'Farm work areas are closed';
    v_display_action := 'Close';
    v_display_subject := 'Farm work areas';
    v_display_detail := 'Tools · work areas · harvest buckets';
    v_display_location := 'Farm work areas';
    v_day_order := 710;
    v_effort_units := 0.75;
  elsif new.occurrence_key like 'community_thursday_wednesday_guest_rooms:%' then
    v_cluster_key := 'guest_rooms';
    v_series_key := 'community_thursday_wednesday_guest_rooms';
    v_template_key := 'community_thursday_guest_rooms_v1';
    v_title := 'Reset the Guest Rooms';
    v_note := 'Move through the bathroom, Library, and meeting room as one guest-room round.';
    v_checklist_title := 'Guest rooms';
    v_completion_label := 'Guest rooms are ready';
    v_display_action := 'Reset';
    v_display_subject := 'Guest rooms';
    v_display_detail := 'Bathroom · Library · meeting room';
    v_display_location := 'Bathroom · Library · Meeting Room';
    v_day_order := 720;
    v_effort_units := 1.00;
  elsif new.occurrence_key like 'community_thursday_wednesday_coffee_water:%' then
    v_cluster_key := 'coffee_water';
    v_series_key := 'community_thursday_wednesday_coffee_water';
    v_template_key := 'community_thursday_coffee_water_v1';
    v_title := 'Prepare Coffee + Water';
    v_note := 'Prepare the Thursday morning drinks together in one kitchen round.';
    v_checklist_title := 'Coffee + water';
    v_completion_label := 'Coffee and water are ready';
    v_display_action := 'Prepare';
    v_display_subject := 'Coffee + water';
    v_display_detail := 'Cold brew · coffee bar · water dispenser';
    v_display_location := 'Coffee Bar';
    v_day_order := 730;
    v_effort_units := 0.50;
  elsif new.occurrence_key like 'community_thursday_wednesday_kitchen_trash:%' then
    v_cluster_key := 'kitchen_trash';
    v_series_key := 'community_thursday_wednesday_kitchen_trash';
    v_template_key := 'community_thursday_kitchen_trash_v1';
    v_title := 'Take Out the Kitchen Trash';
    v_note := 'Finish the Wednesday close by taking out the kitchen trash.';
    v_checklist_title := 'Kitchen trash';
    v_completion_label := 'Kitchen trash is out';
    v_display_action := 'Take out';
    v_display_subject := 'Kitchen trash';
    v_display_detail := 'Wednesday closing';
    v_display_location := 'Kitchen';
    v_day_order := 740;
    v_effort_units := 0.25;
  else
    return new;
  end if;

  v_metadata := (coalesce(new.task_payload -> 'metadata','{}'::jsonb) - 'detail_lines')
    || jsonb_build_object(
      'task_key',
        'anna_' || to_char(new.planned_due_date,'YYYYMMDD') || '_' || v_cluster_key || '_community_thursday',
      'task_series_key',v_series_key,
      'execution_checklist_template_key',v_template_key,
      'execution_checklist_title',v_checklist_title,
      'execution_checklist_completion_label',v_completion_label,
      'hide_details',true,
      'task_instruction',v_title,
      'display_action',v_display_action,
      'display_subject',v_display_subject,
      'display_detail',v_display_detail,
      'collection_label','Thursday Morning Prep',
      'collection_zone','Venue',
      'display_location',v_display_location,
      'checklist_visibility','fully_visible_on_task_card',
      'paid_event_scope',false,
      'thursday_prep_cluster_key',v_cluster_key,
      'thursday_prep_cluster_count',4,
      'day_order',v_day_order,
      'work_order',v_day_order,
      'run_sheet_order',v_day_order,
      'work_lane','required',
      'commitment_kind','hard_date',
      'effort_units',v_effort_units,
      'planned_occurrence_id',new.id
    );

  new.title := v_title;
  new.work_lane := 'required';
  new.commitment_kind := 'hard_date';
  new.effort_units := v_effort_units;
  new.task_payload := coalesce(new.task_payload,'{}'::jsonb)
    || jsonb_build_object(
      'title',v_title,
      'note',v_note,
      'priority','high',
      'task_type','event_setup',
      'action_key','venue',
      'work_class','light',
      'task_series_key',v_series_key,
      'engine_instance_key',
        'recurring:' || v_series_key || ':' || to_char(new.planned_due_date,'YYYY-MM-DD'),
      'work_lane','required',
      'commitment_kind','hard_date',
      'effort_units',v_effort_units,
      'metadata',v_metadata
    );
  new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'executionChecklistTemplateKey')
    || jsonb_build_object(
      'executionChecklistTemplateKey',v_template_key,
      'thursdayPrepClusterKey',v_cluster_key,
      'thursdayPrepClusterCount',4,
      'normalizedBy','normalize_thursday_morning_prep_occurrence_v1'
    );
  new.updated_at := now();
  return new;
end;
$function$;

update atlas.work_definitions definition
set title_template = 'Prepare Elm for Thursday Morning',
    metadata = (coalesce(definition.metadata,'{}'::jsonb) - 'series_key') || jsonb_build_object(
      'series_keys',jsonb_build_array(
        'community_thursday_wednesday_farm_close',
        'community_thursday_wednesday_guest_rooms',
        'community_thursday_wednesday_coffee_water',
        'community_thursday_wednesday_kitchen_trash'
      ),
      'clustered_thursday_prep',true,
      'cluster_count',4,
      'updated_by','thursday_morning_prep_clusters_v1'
    ),
    updated_at = now()
where definition.id in (
  select distinct occurrence.work_definition_id
  from atlas.planned_work_occurrences occurrence
  where occurrence.occurrence_key like 'community_thursday_wednesday_setup:%'
     or occurrence.occurrence_key like 'community_thursday_wednesday_farm_close:%'
);

update atlas.work_release_policies policy
set maximum_active_instances = 4,
    metadata = coalesce(policy.metadata,'{}'::jsonb) || jsonb_build_object(
      'clustered_thursday_prep',true,
      'cluster_count',4,
      'updated_by','thursday_morning_prep_clusters_v1'
    ),
    updated_at = now()
where policy.id in (
  select distinct occurrence.release_policy_id
  from atlas.planned_work_occurrences occurrence
  where occurrence.occurrence_key like 'community_thursday_wednesday_setup:%'
     or occurrence.occurrence_key like 'community_thursday_wednesday_farm_close:%'
);

update atlas.planned_work_occurrences occurrence
set occurrence_key = regexp_replace(
      occurrence.occurrence_key,
      '^community_thursday_wednesday_setup:',
      'community_thursday_wednesday_farm_close:'
    ),
    work_lane = 'required',
    commitment_kind = 'hard_date',
    effort_units = 0.75,
    updated_at = now()
where occurrence.occurrence_key like 'community_thursday_wednesday_setup:%';

delete from atlas.task_execution_checklist_items item
using atlas.tasks task
where item.task_id = task.id
  and task.task_series_key = 'community_thursday_wednesday_setup'
  and task.status in ('open','blocked');

update atlas.tasks task
set title = 'Close the Farm Work Areas',
    task_type = 'event_setup',
    action_key = 'venue',
    priority = 'high',
    note = 'Store and tidy the farm-side work so Thursday morning begins cleanly.',
    task_series_key = 'community_thursday_wednesday_farm_close',
    work_lane = 'required',
    commitment_kind = 'hard_date',
    effort_units = 0.75,
    metadata = (coalesce(task.metadata,'{}'::jsonb) - 'detail_lines')
      || jsonb_build_object(
        'task_key','anna_' || to_char(task.due_date,'YYYYMMDD') || '_farm_close_community_thursday',
        'task_series_key','community_thursday_wednesday_farm_close',
        'execution_checklist_template_key','community_thursday_farm_close_v1',
        'execution_checklist_title','Farm close',
        'execution_checklist_completion_label','Farm work areas are closed',
        'hide_details',true,
        'task_instruction','Close the Farm Work Areas',
        'display_action','Close',
        'display_subject','Farm work areas',
        'display_detail','Tools · work areas · harvest buckets',
        'collection_label','Thursday Morning Prep',
        'collection_zone','Venue',
        'display_location','Farm work areas',
        'checklist_visibility','fully_visible_on_task_card',
        'paid_event_scope',false,
        'thursday_prep_cluster_key','farm_close',
        'thursday_prep_cluster_count',4,
        'day_order',710,
        'work_order',710,
        'run_sheet_order',710,
        'work_lane','required',
        'commitment_kind','hard_date',
        'effort_units',0.75
      ),
    updated_at = now()
where task.task_series_key = 'community_thursday_wednesday_setup'
  and task.status in ('open','blocked');

insert into atlas.planned_work_occurrences (
  farm_id, work_definition_id, release_policy_id, parent_occurrence_id,
  occurrence_key, source_kind, source_id, source_event_key, title,
  planned_due_date, not_before_date, state, gate_satisfied_at, released_at,
  released_task_id, task_payload, relation_payload, metadata,
  work_lane, commitment_kind, effort_units, created_at, updated_at
)
select
  base.farm_id,
  base.work_definition_id,
  base.release_policy_id,
  base.parent_occurrence_id,
  cluster.series_key || ':' || to_char(base.planned_due_date,'YYYY-MM-DD'),
  base.source_kind,
  base.source_id,
  base.source_event_key,
  base.title,
  base.planned_due_date,
  base.not_before_date,
  'planned',
  null,
  null,
  null,
  base.task_payload || jsonb_build_object('task_series_key',cluster.series_key),
  base.relation_payload,
  coalesce(base.metadata,'{}'::jsonb) || jsonb_build_object(
    'created_by','thursday_morning_prep_clusters_v1',
    'cloned_from_occurrence_id',base.id,
    'thursdayPrepClusterKey',cluster.cluster_key
  ),
  'required',
  'hard_date',
  cluster.effort_units,
  now(),
  now()
from atlas.planned_work_occurrences base
cross join (values
  ('guest_rooms','community_thursday_wednesday_guest_rooms',1.00::numeric),
  ('coffee_water','community_thursday_wednesday_coffee_water',0.50::numeric),
  ('kitchen_trash','community_thursday_wednesday_kitchen_trash',0.25::numeric)
) as cluster(cluster_key,series_key,effort_units)
where base.occurrence_key like 'community_thursday_wednesday_farm_close:%'
on conflict (farm_id, work_definition_id, occurrence_key) do update
set source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    source_event_key = excluded.source_event_key,
    planned_due_date = excluded.planned_due_date,
    not_before_date = excluded.not_before_date,
    task_payload = excluded.task_payload,
    relation_payload = excluded.relation_payload,
    metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
    work_lane = excluded.work_lane,
    commitment_kind = excluded.commitment_kind,
    effort_units = excluded.effort_units,
    updated_at = now()
where atlas.planned_work_occurrences.state in ('planned','eligible','failed');

with active_close as (
  select close_occurrence.farm_id, close_occurrence.planned_due_date, close_occurrence.source_event_key
  from atlas.planned_work_occurrences close_occurrence
  join atlas.tasks close_task on close_task.id = close_occurrence.released_task_id
  where close_occurrence.occurrence_key like 'community_thursday_wednesday_farm_close:%'
    and close_task.status in ('open','blocked')
)
update atlas.planned_work_occurrences sibling
set state = 'releasing',
    gate_satisfied_at = coalesce(sibling.gate_satisfied_at,now()),
    updated_at = now()
from active_close
where sibling.farm_id = active_close.farm_id
  and sibling.planned_due_date = active_close.planned_due_date
  and sibling.source_event_key is not distinct from active_close.source_event_key
  and sibling.occurrence_key not like 'community_thursday_wednesday_farm_close:%'
  and (
    sibling.occurrence_key like 'community_thursday_wednesday_guest_rooms:%'
    or sibling.occurrence_key like 'community_thursday_wednesday_coffee_water:%'
    or sibling.occurrence_key like 'community_thursday_wednesday_kitchen_trash:%'
  )
  and sibling.state in ('planned','eligible','failed');

select set_config('atlas.release_engine_active','on',true);

insert into atlas.tasks (
  farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, note, metadata, action_key, work_class,
  visibility_scope, assigned_membership_id, assigned_user_id, created_by_user_id,
  origin_kind, task_scope, planned_occurrence_id, release_policy_id,
  released_at, release_reason, organization_id, work_lane, commitment_kind,
  effort_units, task_series_key, engine_instance_key
)
select
  occurrence.farm_id,
  nullif(occurrence.task_payload ->> 'zone_id','')::uuid,
  occurrence.title,
  coalesce(nullif(occurrence.task_payload ->> 'task_type',''),'event_setup'),
  'open',
  coalesce(nullif(occurrence.task_payload ->> 'priority',''),'high'),
  occurrence.planned_due_date,
  nullif(occurrence.task_payload ->> 'unlock_text',''),
  nullif(occurrence.task_payload ->> 'blocker_text',''),
  nullif(occurrence.task_payload ->> 'note',''),
  coalesce(occurrence.task_payload -> 'metadata','{}'::jsonb)
    || jsonb_build_object(
      'work_lane','required',
      'commitment_kind','hard_date',
      'effort_units',occurrence.effort_units,
      'reservoir_planned_due_date',occurrence.planned_due_date,
      'execution_date',occurrence.planned_due_date
    ),
  coalesce(nullif(occurrence.task_payload ->> 'action_key',''),'venue'),
  coalesce(nullif(occurrence.task_payload ->> 'work_class',''),'light'),
  coalesce(nullif(occurrence.task_payload ->> 'visibility_scope',''),'assigned_worker'),
  nullif(occurrence.task_payload ->> 'assigned_membership_id','')::uuid,
  nullif(occurrence.task_payload ->> 'assigned_user_id','')::uuid,
  nullif(occurrence.task_payload ->> 'created_by_user_id','')::uuid,
  case
    when occurrence.task_payload ->> 'origin_kind' in ('legacy','owner_assigned','contributor_created','generated')
      then occurrence.task_payload ->> 'origin_kind'
    else 'owner_assigned'
  end,
  coalesce(nullif(occurrence.task_payload ->> 'task_scope',''),'farm_operation'),
  occurrence.id,
  occurrence.release_policy_id,
  now(),
  'committed_window',
  nullif(occurrence.task_payload ->> 'organization_id','')::uuid,
  'required',
  'hard_date',
  occurrence.effort_units,
  occurrence.task_payload ->> 'task_series_key',
  occurrence.task_payload ->> 'engine_instance_key'
from atlas.planned_work_occurrences occurrence
where occurrence.state = 'releasing'
  and (
    occurrence.occurrence_key like 'community_thursday_wednesday_guest_rooms:%'
    or occurrence.occurrence_key like 'community_thursday_wednesday_coffee_water:%'
    or occurrence.occurrence_key like 'community_thursday_wednesday_kitchen_trash:%'
  )
  and not exists (
    select 1
    from atlas.tasks existing
    where existing.planned_occurrence_id = occurrence.id
      and existing.status in ('open','blocked')
  );

update atlas.planned_work_occurrences occurrence
set state = 'released',
    released_at = coalesce(occurrence.released_at,task.released_at,now()),
    released_task_id = task.id,
    metadata = coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
      'releasedBy','thursday_morning_prep_clusters_v1',
      'releasedLane','required',
      'releasedExecutionDate',occurrence.planned_due_date
    ),
    updated_at = now()
from atlas.tasks task
where task.planned_occurrence_id = occurrence.id
  and task.status in ('open','blocked')
  and occurrence.state = 'releasing';

select atlas.restore_task_relation_payload_v1(task.id,coalesce(occurrence.relation_payload,'{}'::jsonb))
from atlas.tasks task
join atlas.planned_work_occurrences occurrence on occurrence.id = task.planned_occurrence_id
where task.status in ('open','blocked')
  and (
    occurrence.occurrence_key like 'community_thursday_wednesday_guest_rooms:%'
    or occurrence.occurrence_key like 'community_thursday_wednesday_coffee_water:%'
    or occurrence.occurrence_key like 'community_thursday_wednesday_kitchen_trash:%'
  );

insert into atlas.task_release_events (
  farm_id, occurrence_id, release_policy_id, task_id, release_reason, metadata
)
select
  task.farm_id,
  occurrence.id,
  occurrence.release_policy_id,
  task.id,
  'committed_window',
  jsonb_build_object(
    'workLane','required',
    'commitmentKind','hard_date',
    'effortUnits',task.effort_units,
    'executionDate',task.due_date,
    'source','thursday_morning_prep_clusters_v1'
  )
from atlas.tasks task
join atlas.planned_work_occurrences occurrence on occurrence.id = task.planned_occurrence_id
where task.status in ('open','blocked')
  and (
    occurrence.occurrence_key like 'community_thursday_wednesday_guest_rooms:%'
    or occurrence.occurrence_key like 'community_thursday_wednesday_coffee_water:%'
    or occurrence.occurrence_key like 'community_thursday_wednesday_kitchen_trash:%'
  )
on conflict (occurrence_id,task_id) do nothing;

select set_config('atlas.release_engine_active','off',true);

select atlas.seed_task_execution_checklist_v1(task.id)
from atlas.tasks task
where task.status in ('open','blocked')
  and task.task_series_key in (
    'community_thursday_wednesday_farm_close',
    'community_thursday_wednesday_guest_rooms',
    'community_thursday_wednesday_coffee_water',
    'community_thursday_wednesday_kitchen_trash'
  );

do $verify$
declare
  v_current_date date;
  v_task_count integer;
  v_occurrence_problem_count integer;
  v_capacity_minutes integer;
begin
  select min(task.due_date)
  into v_current_date
  from atlas.tasks task
  where task.status in ('open','blocked')
    and task.task_series_key in (
      'community_thursday_wednesday_farm_close',
      'community_thursday_wednesday_guest_rooms',
      'community_thursday_wednesday_coffee_water',
      'community_thursday_wednesday_kitchen_trash'
    );

  if v_current_date is not null then
    select count(*)::integer
    into v_task_count
    from atlas.tasks task
    where task.status in ('open','blocked')
      and task.due_date = v_current_date
      and task.task_series_key in (
        'community_thursday_wednesday_farm_close',
        'community_thursday_wednesday_guest_rooms',
        'community_thursday_wednesday_coffee_water',
        'community_thursday_wednesday_kitchen_trash'
      );

    if v_task_count <> 4 then
      raise exception 'Thursday morning preparation did not resolve to four current tasks: % found.',v_task_count;
    end if;

    select coalesce(sum(profile.expected_active_minutes),0)::integer
    into v_capacity_minutes
    from atlas.tasks task
    join atlas.task_capacity_profiles profile on profile.task_id = task.id
    where task.status in ('open','blocked')
      and task.due_date = v_current_date
      and task.task_series_key in (
        'community_thursday_wednesday_farm_close',
        'community_thursday_wednesday_guest_rooms',
        'community_thursday_wednesday_coffee_water',
        'community_thursday_wednesday_kitchen_trash'
      );

    if v_capacity_minutes <> 120 then
      raise exception 'Thursday morning preparation capacity must total 120 private minutes: % found.',v_capacity_minutes;
    end if;
  end if;

  select count(*)::integer
  into v_occurrence_problem_count
  from (
    select occurrence.farm_id, occurrence.planned_due_date, count(*)::integer as cluster_count
    from atlas.planned_work_occurrences occurrence
    where occurrence.occurrence_key like 'community_thursday_wednesday_farm_close:%'
       or occurrence.occurrence_key like 'community_thursday_wednesday_guest_rooms:%'
       or occurrence.occurrence_key like 'community_thursday_wednesday_coffee_water:%'
       or occurrence.occurrence_key like 'community_thursday_wednesday_kitchen_trash:%'
    group by occurrence.farm_id, occurrence.planned_due_date
    having count(*) <> 4
  ) broken_dates;

  if v_occurrence_problem_count <> 0 then
    raise exception 'Every regular Thursday morning must have four Wednesday preparation occurrences.';
  end if;

  if exists (
    select 1
    from atlas.tasks task
    where task.status in ('open','blocked')
      and task.task_series_key = 'community_thursday_wednesday_setup'
  ) then
    raise exception 'The monolithic Thursday preparation task is still active.';
  end if;
end;
$verify$;

commit;
