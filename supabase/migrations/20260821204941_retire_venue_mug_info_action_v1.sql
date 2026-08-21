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
      || case
        when template.crossed_out then jsonb_build_object(
          'crossedOut', true,
          'crossedOutReason', 'Bathroom is unfinished and not usable by guests.'
        )
        when template.retired then jsonb_build_object(
          'retired', true,
          'retiredReason', template.retired_reason
        )
        else '{}'::jsonb
      end
  from (values
    ('community_thursday_morning_outdoor_v2','outdoor','store_farm_tools','outdoor','Farm work areas','Store farm tools in their proper places',10,true,false,false,null::text),
    ('community_thursday_morning_outdoor_v2','outdoor','tidy_farm_work_areas','outdoor','Farm work areas','Tidy the farm work areas',20,true,false,false,null::text),
    ('community_thursday_morning_outdoor_v2','outdoor','wash_stage_harvest_buckets','outdoor','Farm work areas','Wash and stage the harvest buckets',30,true,false,false,null::text),
    ('community_thursday_morning_coffee_water_v2','coffee_water','restock_reset_coffee_bar','coffee_water','Coffee + water','Guests choose a real mug from the hutch',20,false,false,true,'Mug selection is station information, not worker action.'),
    ('community_thursday_morning_coffee_water_v2','coffee_water','refill_water_dispenser','coffee_water','Coffee + water','Confirm the water dispenser is full.',30,true,false,false,null::text),
    ('community_thursday_morning_rooms_v2','rooms','bathroom_ready','rooms','Room checks','C̶l̶e̶a̶n̶ ̶a̶n̶d̶ ̶s̶t̶o̶c̶k̶ ̶t̶h̶e̶ ̶b̶a̶t̶h̶r̶o̶o̶m̶',10,false,true,false,null::text),
    ('community_thursday_morning_rooms_v2','rooms','library_ready','rooms','Room checks','Clear and reset the Library until it is visibly guest-ready',20,true,false,false,null::text),
    ('community_thursday_morning_rooms_v2','rooms','meeting_room_ready','rooms','Room checks','Clear and reset the meeting room until it is visibly guest-ready',30,true,false,false,null::text),
    ('community_thursday_morning_rooms_v2','rooms','take_out_kitchen_trash','rooms','Room checks','Take out the kitchen trash',40,true,false,false,null::text)
  ) as template(template_key, cluster_key, item_key, section_key, section_label, item_label, sort_order, required, crossed_out, retired, retired_reason)
  where template.template_key = v_template
  on conflict (task_id, item_key) do update
  set section_key = excluded.section_key,
      section_label = excluded.section_label,
      item_label = excluded.item_label,
      sort_order = excluded.sort_order,
      required = excluded.required,
      metadata = (atlas.task_execution_checklist_items.metadata - 'retired' - 'retiredAt' - 'retiredReason' - 'crossedOut' - 'crossedOutReason') || excluded.metadata,
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

update atlas.task_execution_checklist_items i
set required = false,
    item_label = 'Guests choose a real mug from the hutch',
    metadata = (coalesce(i.metadata, '{}'::jsonb) - 'retiredAt') || jsonb_build_object(
      'retired', true,
      'retiredReason', 'Mug selection is station information, not worker action.'
    ),
    updated_at = now()
from atlas.tasks t
where t.id = i.task_id
  and t.metadata ->> 'execution_checklist_template_key' = 'community_thursday_morning_coffee_water_v2'
  and i.item_key = 'restock_reset_coffee_bar';
