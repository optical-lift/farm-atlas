create or replace function atlas.community_event_worker_display_name_v1(p_event_kind text)
returns text
language sql
immutable
set search_path to 'pg_catalog','atlas'
as $$
  select case p_event_kind
    when 'ticketed_seasonal_evening' then 'Thursdays at Elm'
    when 'free_community_morning' then 'Community Thursday'
    else 'Community Event'
  end;
$$;

create or replace function atlas.community_event_worker_time_label_v1(p_event_date date,p_start time without time zone,p_end time without time zone)
returns text
language sql
immutable
set search_path to 'pg_catalog','atlas'
as $$
  select concat(
    to_char(p_event_date,'Dy Mon FMDD'),
    case when p_start is not null then ' · '||to_char(p_start,'FMHH12:MI AM') else '' end,
    case when p_end is not null then '–'||to_char(p_end,'FMHH12:MI AM') else '' end
  );
$$;

create or replace function atlas.sync_community_event_worker_identity_v1(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_event atlas.community_events%rowtype;
  v_name text;
  v_time_label text;
  v_count integer:=0;
begin
  select * into v_event from atlas.community_events where id=p_event_id;
  if v_event.id is null then return jsonb_build_object('state','event_missing'); end if;
  if v_event.event_kind not in ('free_community_morning','ticketed_seasonal_evening') then
    return jsonb_build_object('state','not_applicable','eventId',p_event_id);
  end if;

  v_name:=atlas.community_event_worker_display_name_v1(v_event.event_kind);
  v_time_label:=atlas.community_event_worker_time_label_v1(v_event.event_date,v_event.start_local_time,v_event.end_local_time);

  update atlas.planned_work_occurrences o
  set title=initcap(coalesce(o.metadata->>'venueCycleStage','prep'))||' '||v_name,
      task_payload=jsonb_set(
        jsonb_set(
          coalesce(o.task_payload,'{}'::jsonb),
          '{title}',to_jsonb(initcap(coalesce(o.metadata->>'venueCycleStage','prep'))||' '||v_name),true
        ),
        '{metadata}',
        coalesce(o.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'community_event_display_title',v_name,
          'community_event_start_local_time',v_event.start_local_time,
          'community_event_end_local_time',v_event.end_local_time,
          'display_due_label',v_time_label,
          'display_subject',v_name,
          'collection_label',v_name
        ),true
      ),
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
        'communityEventDisplayTitle',v_name,
        'displayDueLabel',v_time_label
      ),
      updated_at=now()
  where o.source_kind='community_event'
    and o.source_id=p_event_id
    and o.metadata->>'venueCycleContract'='community_thursday_venue_cycle_v1'
    and o.state<>'cancelled';
  get diagnostics v_count=row_count;

  update atlas.tasks t
  set title=initcap(coalesce(t.metadata->>'venue_cycle_stage','prep'))||' '||v_name,
      metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'community_event_display_title',v_name,
        'community_event_start_local_time',v_event.start_local_time,
        'community_event_end_local_time',v_event.end_local_time,
        'display_due_label',v_time_label,
        'display_subject',v_name,
        'collection_label',v_name
      ),
      updated_at=now()
  where t.metadata->>'community_event_id'=p_event_id::text
    and t.metadata->>'venue_cycle_contract'='community_thursday_venue_cycle_v1'
    and t.status<>'archived';

  return jsonb_build_object('state','synced','eventId',p_event_id,'displayTitle',v_name,'timeLabel',v_time_label,'occurrenceCount',v_count);
end;
$function$;

create or replace function atlas.seed_community_thursday_venue_cycle_checklist_v1(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
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
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return 0; end if;
  v_template:=coalesce(v_task.metadata->>'execution_checklist_template_key','');
  if v_template not in ('community_thursday_venue_tidy_v1','community_thursday_venue_prep_v1','community_thursday_venue_host_v1') then return 0; end if;

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
    ('community_thursday_venue_host_v1','yellow_door','open_event','Open the event','Open the yellow door',30,true,'action')
  ) x(template_key,item_key,section_key,section_label,item_label,sort_order,required,interaction)
  where x.template_key=v_template
  on conflict (task_id,item_key) do update set section_key=excluded.section_key,section_label=excluded.section_label,item_label=excluded.item_label,
    sort_order=excluded.sort_order,required=excluded.required,metadata=atlas.task_execution_checklist_items.metadata||excluded.metadata;
  get diagnostics v_count=row_count;

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

create or replace function atlas.sync_community_event_worker_identity_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  perform atlas.sync_community_event_worker_identity_v1(new.id);
  return new;
end;
$function$;

drop trigger if exists zz_sync_community_event_worker_identity_v1 on atlas.community_events;
create trigger zz_sync_community_event_worker_identity_v1
after insert or update of event_kind,event_date,start_local_time,end_local_time,status on atlas.community_events
for each row when (new.event_kind in ('free_community_morning','ticketed_seasonal_evening'))
execute function atlas.sync_community_event_worker_identity_trigger_v1();

create or replace function atlas.sync_event_blooms_from_flower_task_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_event_id uuid;
  v_metadata jsonb;
  v_type text;
  r record;
begin
  if tg_op='DELETE' then
    v_metadata:=old.metadata;
    v_type:=old.task_type;
  else
    v_metadata:=new.metadata;
    v_type:=new.task_type;
  end if;

  if v_type not in ('flower_preparation','flower_fulfillment')
     and coalesce(v_metadata->>'task_style','') not in ('flower_preparation','flower_fulfillment') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  begin
    v_event_id:=nullif(v_metadata->>'community_event_id','')::uuid;
  exception when invalid_text_representation then
    v_event_id:=null;
  end;
  if v_event_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  for r in select id from atlas.tasks
    where metadata->>'community_event_id'=v_event_id::text
      and metadata->>'execution_checklist_template_key'='community_thursday_venue_prep_v1'
      and status<>'archived'
  loop
    perform atlas.seed_community_thursday_venue_cycle_checklist_v1(r.id);
  end loop;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

drop trigger if exists sync_event_blooms_from_flower_task_v1 on atlas.tasks;
create trigger sync_event_blooms_from_flower_task_v1
after insert or update of metadata,status,title or delete on atlas.tasks
for each row execute function atlas.sync_event_blooms_from_flower_task_v1();

do $$
declare r record;
begin
  for r in select id from atlas.community_events
    where event_kind in ('free_community_morning','ticketed_seasonal_evening')
      and event_date >= (now() at time zone 'America/Chicago')::date
  loop
    perform atlas.sync_community_event_worker_identity_v1(r.id);
  end loop;

  for r in select id from atlas.tasks
    where metadata->>'execution_checklist_template_key'='community_thursday_venue_prep_v1'
      and status<>'archived'
  loop
    perform atlas.seed_community_thursday_venue_cycle_checklist_v1(r.id);
  end loop;
end $$;
