create or replace function atlas.seed_community_thursday_venue_cycle_checklist_v1(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_template text;
  v_count integer:=0;
  v_minutes integer;
  v_load text;
  v_round text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return 0; end if;
  v_template:=coalesce(v_task.metadata->>'execution_checklist_template_key','');
  if v_template not in ('community_thursday_venue_tidy_v1','community_thursday_venue_prep_v1','community_thursday_venue_host_v1') then return 0; end if;

  insert into atlas.task_execution_checklist_items(farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,metadata)
  select v_task.farm_id,v_task.id,x.item_key,x.section_key,x.section_label,x.item_label,x.sort_order,x.required,
         jsonb_strip_nulls(jsonb_build_object(
           'templateKey',x.template_key,
           'venueCycleStage',v_task.metadata->>'venue_cycle_stage',
           'interaction',x.interaction,
           'stationLocation',x.station_location,
           'restockLabel',x.restock_label
         ))
  from (values
    ('community_thursday_venue_tidy_v1','entry_closet','entry','Entry','Closet closed',10,false,'reminder',null::text,null::text),
    ('community_thursday_venue_tidy_v1','kitchen_trash','kitchen','Kitchen','Empty trash',20,false,'reminder',null::text,'Trash bags'),
    ('community_thursday_venue_tidy_v1','kitchen_counters','kitchen','Kitchen','Clean counters',30,false,'reminder',null::text,null::text),
    ('community_thursday_venue_tidy_v1','conference_chairs','conference_room','Conference room','Tidy chairs',40,false,'reminder',null::text,null::text),
    ('community_thursday_venue_tidy_v1','conference_windows','conference_room','Conference room','Clean windows',50,false,'reminder',null::text,null::text),
    ('community_thursday_venue_tidy_v1','library_chairs','library','Library','Tidy chairs',60,false,'reminder',null::text,null::text),
    ('community_thursday_venue_tidy_v1','library_rug','library','Library','Beat rug outside',70,false,'reminder',null::text,null::text),
    ('community_thursday_venue_tidy_v1','library_windows','library','Library','Clean windows',80,false,'reminder',null::text,null::text),
    ('community_thursday_venue_prep_v1','coffee_keuring','coffee_bar','Coffee bar','Keurig',10,false,'resource','Dining room',null::text),
    ('community_thursday_venue_prep_v1','coffee_grounds','coffee_bar','Coffee bar','Coffee grounds',20,false,'resource','Dining room','Coffee grounds'),
    ('community_thursday_venue_prep_v1','coffee_milk','coffee_bar','Coffee bar','Milk',30,false,'resource','Dining room','Milk'),
    ('community_thursday_venue_prep_v1','coffee_syrup','coffee_bar','Coffee bar','Flavored syrup',40,false,'resource','Dining room','Flavored syrup'),
    ('community_thursday_venue_prep_v1','coffee_mug_hutch','coffee_bar','Coffee bar','Mug hutch',50,false,'information','Dining room',null::text),
    ('community_thursday_venue_prep_v1','water_dispenser','water','Water','Confirm the water dispenser is full',60,true,'action','Dining room',null::text),
    ('community_thursday_venue_prep_v1','water_cups','water','Water','Clear cups',70,false,'resource','Dining room','Clear cups'),
    ('community_thursday_venue_prep_v1','blooms_posies','blooms','Blooms','12 posies',80,false,'resource','For sale at Community Thursday',null::text),
    ('community_thursday_venue_prep_v1','blooms_bouquets','blooms','Blooms','6 bouquets',90,false,'resource','For sale at Community Thursday',null::text),
    ('community_thursday_venue_host_v1','ice_maker','open_event','Open the event','Turn on the ice maker',10,true,'action',null::text,null::text),
    ('community_thursday_venue_host_v1','open_sign','open_event','Open the event','Turn on the OPEN sign',20,true,'action',null::text,null::text),
    ('community_thursday_venue_host_v1','yellow_door','open_event','Open the event','Open the yellow door',30,true,'action',null::text,null::text)
  ) x(template_key,item_key,section_key,section_label,item_label,sort_order,required,interaction,station_location,restock_label)
  where x.template_key=v_template
  on conflict (task_id,item_key) do update set section_key=excluded.section_key,section_label=excluded.section_label,item_label=excluded.item_label,
    sort_order=excluded.sort_order,required=excluded.required,metadata=atlas.task_execution_checklist_items.metadata||excluded.metadata;
  get diagnostics v_count=row_count;

  if v_template='community_thursday_venue_tidy_v1' then v_minutes:=35;v_load:='moderate';v_round:='community_thursday_tidy';
  elsif v_template='community_thursday_venue_prep_v1' then v_minutes:=25;v_load:='light';v_round:='community_thursday_prep';
  else v_minutes:=10;v_load:='light';v_round:='community_thursday_host'; end if;

  insert into atlas.task_capacity_profiles(task_id,farm_id,expected_active_minutes,physical_load,base_obligation_class,micro_round_key,estimate_source,estimate_confidence,owner_locked,owner_note,metadata)
  values(v_task.id,v_task.farm_id,v_minutes,v_load,'hard_window',v_round,'template:'||v_template,'rule',false,'Community Thursday Venue cycle estimate.',jsonb_build_object('templateKey',v_template,'venueCycle',true))
  on conflict (task_id) do update set expected_active_minutes=excluded.expected_active_minutes,physical_load=excluded.physical_load,
    base_obligation_class=excluded.base_obligation_class,micro_round_key=excluded.micro_round_key,estimate_source=excluded.estimate_source,
    estimate_confidence=excluded.estimate_confidence,owner_note=excluded.owner_note,metadata=atlas.task_capacity_profiles.metadata||excluded.metadata,updated_at=now()
  where not atlas.task_capacity_profiles.owner_locked;
  return v_count;
end;
$function$;

do $$
declare r record;
begin
  for r in select id from atlas.tasks where metadata->>'execution_checklist_template_key' in ('community_thursday_venue_tidy_v1','community_thursday_venue_prep_v1','community_thursday_venue_host_v1') loop
    perform atlas.seed_community_thursday_venue_cycle_checklist_v1(r.id);
  end loop;
end $$;

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
        'crossedOut', coalesce((item.metadata ->> 'crossedOut')::boolean,false),
        'interaction', nullif(item.metadata->>'interaction',''),
        'stationLocation', nullif(item.metadata->>'stationLocation',''),
        'restockLabel', nullif(item.metadata->>'restockLabel','')
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
