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
  v_event_id uuid;
  v_bloom_count integer:=0;
  v_paid boolean:=false;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return 0; end if;
  v_template:=coalesce(v_task.metadata->>'execution_checklist_template_key','');
  if v_template not in ('community_thursday_venue_tidy_v1','community_thursday_venue_prep_v1','community_thursday_venue_host_v1') then return 0; end if;
  v_paid:=coalesce((v_task.metadata->>'paid_event_scope')::boolean,false);

  insert into atlas.task_execution_checklist_items(farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,metadata)
  select v_task.farm_id,v_task.id,x.item_key,x.section_key,x.section_label,x.item_label,x.sort_order,x.required,
         jsonb_build_object('templateKey',x.template_key,'venueCycleStage',v_task.metadata->>'venue_cycle_stage','interaction',x.interaction)
  from (values
    ('community_thursday_venue_tidy_v1','entry_closet','entry','Entry','Closet closed',10,false,'reminder'),
    ('community_thursday_venue_tidy_v1','kitchen_trash','kitchen','Kitchen','Empty trash',20,false,'reminder'),
    ('community_thursday_venue_tidy_v1','kitchen_counters','kitchen','Kitchen','Clean counters',30,false,'reminder'),
    ('community_thursday_venue_tidy_v1','conference_chairs','conference_room','Conference room','Tidy chairs',40,false,'reminder'),
    ('community_thursday_venue_tidy_v1','conference_windows','conference_room','Conference room','Clean windows',50,false,'reminder'),
    ('community_thursday_venue_tidy_v1','library_chairs','library','Library','Tidy chairs',60,false,'reminder'),
    ('community_thursday_venue_tidy_v1','library_rug','library','Library','Beat rug outside',70,false,'reminder'),
    ('community_thursday_venue_tidy_v1','library_windows','library','Library','Clean windows',80,false,'reminder'),
    ('community_thursday_venue_prep_v1','coffee_keuring','coffee_bar','Coffee bar','Keurig',10,false,'resource'),
    ('community_thursday_venue_prep_v1','coffee_grounds','coffee_bar','Coffee bar','Coffee grounds',20,false,'resource'),
    ('community_thursday_venue_prep_v1','coffee_milk','coffee_bar','Coffee bar','Milk',30,false,'resource'),
    ('community_thursday_venue_prep_v1','coffee_syrup','coffee_bar','Coffee bar','Flavored syrup',40,false,'resource'),
    ('community_thursday_venue_prep_v1','coffee_mug_hutch','coffee_bar','Coffee bar','Mug hutch',50,false,'information'),
    ('community_thursday_venue_prep_v1','water_dispenser','water','Water','Confirm the water dispenser is full',60,true,'action'),
    ('community_thursday_venue_prep_v1','water_cups','water','Water','Clear cups',70,false,'resource'),
    ('community_thursday_venue_host_v1','ice_maker','open_event','Open the event','Turn on the ice maker',10,true,'action'),
    ('community_thursday_venue_host_v1','open_sign','open_event','Open the event','Turn on the OPEN sign',20,true,'action'),
    ('community_thursday_venue_host_v1','yellow_door','open_event','Open the yellow door',30,true,'action')
  ) x(template_key,item_key,section_key,section_label,item_label,sort_order,required,interaction)
  where x.template_key=v_template
  on conflict (task_id,item_key) do update set section_key=excluded.section_key,section_label=excluded.section_label,item_label=excluded.item_label,
    sort_order=excluded.sort_order,required=excluded.required,metadata=atlas.task_execution_checklist_items.metadata||excluded.metadata;
  get diagnostics v_count=row_count;

  if v_template='community_thursday_venue_prep_v1' and v_paid then
    delete from atlas.task_execution_checklist_items
    where task_id=v_task.id and item_key='coffee_mug_hutch';

    update atlas.task_execution_checklist_items
    set section_key='drinkware',
        section_label='Drinkware',
        item_label='Clear plastic disposable cups',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('paidEventVariant',true,'interaction','resource'),
        updated_at=now()
    where task_id=v_task.id and item_key='water_cups';

    insert into atlas.task_execution_checklist_items(
      farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,metadata
    ) values (
      v_task.farm_id,v_task.id,'coffee_paper_disposable_cups','drinkware','Drinkware','Paper disposable cups',50,false,
      jsonb_build_object('templateKey',v_template,'venueCycleStage','prep','interaction','resource','paidEventVariant',true)
    )
    on conflict (task_id,item_key) do update set
      section_key=excluded.section_key,section_label=excluded.section_label,item_label=excluded.item_label,
      sort_order=excluded.sort_order,required=excluded.required,
      metadata=atlas.task_execution_checklist_items.metadata||excluded.metadata;
  elsif v_template='community_thursday_venue_prep_v1' then
    delete from atlas.task_execution_checklist_items
    where task_id=v_task.id and item_key='coffee_paper_disposable_cups';
  end if;

  if v_template='community_thursday_venue_prep_v1' then
    delete from atlas.task_execution_checklist_items
    where task_id=v_task.id
      and (item_key in ('blooms_posies','blooms_bouquets','blooms_unscheduled') or item_key like 'event_bloom_%');

    begin
      v_event_id:=nullif(v_task.metadata->>'community_event_id','')::uuid;
    exception when invalid_text_representation then
      v_event_id:=null;
    end;

    if v_event_id is not null then
      insert into atlas.task_execution_checklist_items(farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,metadata)
      select v_task.farm_id,v_task.id,'event_bloom_'||replace(ft.id::text,'-',''),'blooms','Blooms',
        coalesce(nullif(ft.metadata->>'display_detail',''),nullif(ft.metadata->>'display_subject',''),ft.title),
        80+row_number() over(order by ft.due_date nulls last,ft.created_at),false,
        jsonb_build_object('templateKey',v_template,'venueCycleStage','prep','interaction','linked_task','linkedTaskId',ft.id)
      from atlas.tasks ft
      where ft.farm_id=v_task.farm_id
        and ft.status not in ('archived','skipped')
        and (ft.task_type in ('flower_preparation','flower_fulfillment') or ft.metadata->>'task_style' in ('flower_preparation','flower_fulfillment'))
        and ft.metadata->>'community_event_id'=v_event_id::text;
      get diagnostics v_bloom_count=row_count;
    end if;

    if v_bloom_count=0 then
      insert into atlas.task_execution_checklist_items(farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,metadata)
      values(v_task.farm_id,v_task.id,'blooms_unscheduled','blooms','Blooms','Unscheduled',80,false,
        jsonb_build_object('templateKey',v_template,'venueCycleStage','prep','interaction','information','source','no_event_linked_flower_work'))
      on conflict (task_id,item_key) do update set item_label='Unscheduled',section_key='blooms',section_label='Blooms',sort_order=80,required=false,
        metadata=atlas.task_execution_checklist_items.metadata||excluded.metadata;
    end if;
  end if;

  if v_template='community_thursday_venue_tidy_v1' then v_minutes:=35;v_load:='moderate';v_round:='community_thursday_tidy';
  elsif v_template='community_thursday_venue_prep_v1' then v_minutes:=25;v_load:='light';v_round:='community_thursday_prep';
  else v_minutes:=10;v_load:='light';v_round:='community_thursday_host'; end if;

  insert into atlas.task_capacity_profiles(task_id,farm_id,expected_active_minutes,physical_load,base_obligation_class,micro_round_key,estimate_source,estimate_confidence,owner_locked,owner_note,metadata)
  values(v_task.id,v_task.farm_id,v_minutes,v_load,'hard_window',v_round,'template:'||v_template,'rule',false,'Event-derived Venue cycle estimate.',jsonb_build_object('templateKey',v_template,'venueCycle',true))
  on conflict (task_id) do update set expected_active_minutes=excluded.expected_active_minutes,physical_load=excluded.physical_load,
    base_obligation_class=excluded.base_obligation_class,micro_round_key=excluded.micro_round_key,estimate_source=excluded.estimate_source,
    estimate_confidence=excluded.estimate_confidence,owner_note=excluded.owner_note,metadata=atlas.task_capacity_profiles.metadata||excluded.metadata,updated_at=now()
  where not atlas.task_capacity_profiles.owner_locked;
  return v_count+v_bloom_count;
end;
$function$;

comment on function atlas.seed_community_thursday_venue_cycle_checklist_v1(uuid) is
'Thursdays at Elm Venue checklist seeder. Paid evening prep substitutes paper and clear plastic disposable drinkware for the free-morning mug-hutch presentation while retaining event-instance requirements. The seeder does not mutate its parent task, avoiding task-trigger recursion.';