-- Event-derived Community Thursday worker cycle: Tidy -> Prep -> Host.
-- Both free mornings and ticketed evenings derive work from atlas.community_events.

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
    ('community_thursday_venue_prep_v1','blooms_posies','blooms','Blooms','12 posies',80,false,'resource'),
    ('community_thursday_venue_prep_v1','blooms_bouquets','blooms','Blooms','6 bouquets',90,false,'resource'),
    ('community_thursday_venue_host_v1','ice_maker','open_event','Open the event','Turn on the ice maker',10,true,'action'),
    ('community_thursday_venue_host_v1','open_sign','open_event','Open the event','Turn on the OPEN sign',20,true,'action'),
    ('community_thursday_venue_host_v1','yellow_door','open_event','Open the event','Open the yellow door',30,true,'action')
  ) x(template_key,item_key,section_key,section_label,item_label,sort_order,required,interaction)
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

create or replace function atlas.seed_community_thursday_venue_cycle_checklist_trigger_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$ begin perform atlas.seed_community_thursday_venue_cycle_checklist_v1(new.id); return new; end; $function$;

create or replace function atlas.ensure_community_thursday_venue_cycle_v1(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_event atlas.community_events%rowtype; v_farm atlas.farms%rowtype; v_anna atlas.farm_memberships%rowtype; v_owner atlas.farm_memberships%rowtype;
  v_stage text; v_due date; v_title text; v_template text; v_interaction text; v_day_order integer; v_effort numeric;
  v_occurrence_id uuid; v_ids jsonb:='[]'::jsonb; v_event_active boolean; v_paid boolean; v_task_metadata jsonb; v_payload jsonb;
begin
  select * into v_event from atlas.community_events where id=p_event_id;
  if v_event.id is null then raise exception 'Community event was not found.' using errcode='P0002'; end if;
  if v_event.event_kind not in ('free_community_morning','ticketed_seasonal_evening') then
    return jsonb_build_object('contractVersion','community_thursday_venue_cycle_v1','eventId',v_event.id,'state','not_applicable');
  end if;
  select * into v_farm from atlas.farms where id=v_event.farm_id;
  select * into v_anna from atlas.farm_memberships where farm_id=v_event.farm_id and active and worker_key='anna' order by created_at limit 1;
  select * into v_owner from atlas.farm_memberships where farm_id=v_event.farm_id and active and role='owner' order by created_at limit 1;
  if v_anna.id is null then return jsonb_build_object('contractVersion','community_thursday_venue_cycle_v1','eventId',v_event.id,'state','anna_membership_missing'); end if;

  v_event_active:=v_event.status in ('planned','scheduled'); v_paid:=v_event.event_kind='ticketed_seasonal_evening';
  if not v_event_active then
    update atlas.planned_work_occurrences set state='cancelled',released_task_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','community_thursday_venue_cycle_v1','cancelledAt',now(),'eventStatus',v_event.status),updated_at=now()
    where farm_id=v_event.farm_id and source_kind='community_event' and source_id=v_event.id and metadata->>'venueCycleContract'='community_thursday_venue_cycle_v1' and state not in ('completed','cancelled');
    update atlas.tasks set status='archived',visibility_scope='system_internal',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('archivedBy','community_thursday_venue_cycle_v1','archivedAt',now(),'eventStatus',v_event.status),updated_at=now()
    where farm_id=v_event.farm_id and status in ('open','blocked') and metadata->>'community_event_id'=v_event.id::text and metadata->>'venue_cycle_contract'='community_thursday_venue_cycle_v1';
    return jsonb_build_object('contractVersion','community_thursday_venue_cycle_v1','eventId',v_event.id,'state','cancelled');
  end if;

  foreach v_stage in array array['tidy','prep','host'] loop
    if v_stage='tidy' then v_due:=v_event.event_date-1;v_title:='Tidy Community Thursday';v_template:='community_thursday_venue_tidy_v1';v_interaction:='resource';v_day_order:=910;v_effort:=0.20;
    elsif v_stage='prep' then v_due:=v_event.event_date-1;v_title:='Prep Community Thursday';v_template:='community_thursday_venue_prep_v1';v_interaction:='resource';v_day_order:=920;v_effort:=0.20;
    else v_due:=v_event.event_date;v_title:='Host Community Thursday';v_template:='community_thursday_venue_host_v1';v_interaction:='execution';v_day_order:=930;v_effort:=0.10; end if;

    v_task_metadata:=jsonb_build_object(
      'task_key','anna_'||replace(v_due::text,'-','')||'_community_thursday_'||v_stage||'_'||replace(v_event.id::text,'-',''),
      'anna_task',true,'owner_task',false,'marshall_task',false,'assigned_to','Anna','assignee_key','anna','executor_worker_key','anna','executor_membership_id',v_anna.id,
      'work_route','prepare','work_rhythm','Venue','collection_zone','Venue','collection_label','Community Thursday','display_action',initcap(v_stage),'display_subject','Community Thursday','display_location',v_farm.name,
      'day_order',v_day_order,'hide_details',true,'community_event_id',v_event.id,'community_event_key',v_event.stable_key,'community_event_date',v_event.event_date,'community_event_kind',v_event.event_kind,
      'venue_cycle_stage',v_stage,'venue_cycle_contract','community_thursday_venue_cycle_v1','venue_interaction_method',v_interaction,'execution_checklist_template_key',v_template,
      'checklist_visibility','fully_visible_on_task_card','paid_event_scope',v_paid,'mirrors_free_morning_design',true,
      'truthBoundary','Free morning and ticketed evening intentionally share the same initial Venue card grammar until owner review.'
    );
    v_payload:=jsonb_build_object(
      'farm_id',v_event.farm_id,'organization_id',v_farm.organization_id,'title',v_title,'task_type','event_setup','status','open','priority','high','due_date',v_due,
      'action_key','prepare','work_class','light','task_scope','farm_operation','origin_kind','owner_assigned','visibility_scope','assigned_worker',
      'assigned_membership_id',v_anna.id,'assigned_user_id',v_anna.user_id,'created_by_user_id',v_owner.user_id,
      'task_series_key','community_thursday_venue_'||v_stage,'engine_instance_key','community_event:'||v_event.id::text||':'||v_stage||':'||v_due::text,'metadata',v_task_metadata
    );
    v_occurrence_id:=atlas.plan_work_occurrence_v1(v_event.farm_id,'community_thursday_venue:'||v_stage||':v1','community_thursday_venue:'||v_stage||':v1:time_window',
      'community_thursday_venue:'||v_event.id::text||':'||v_stage||':'||v_due::text,v_title,'event_setup',v_due,'community_event',v_event.id,'time_window',30,8,v_payload,
      jsonb_build_object('community_event_id',v_event.id,'community_event_key',v_event.stable_key,'community_event_date',v_event.event_date,'venue_cycle_stage',v_stage),
      jsonb_build_object('automatic',true,'source_kind','community_event','venueCycleStage',v_stage),v_due,
      jsonb_build_object('venueCycleContract','community_thursday_venue_cycle_v1','venueCycleStage',v_stage,'eventKind',v_event.event_kind,'mirrorsFreeMorningDesign',true));
    update atlas.planned_work_occurrences set source_event_key=v_event.stable_key,work_lane='required',commitment_kind='hard_date',effort_units=v_effort,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('venueCycleContract','community_thursday_venue_cycle_v1','venueCycleStage',v_stage,'eventKind',v_event.event_kind,'mirrorsFreeMorningDesign',true),updated_at=now()
    where id=v_occurrence_id;
    v_ids:=v_ids||jsonb_build_array(v_occurrence_id);
  end loop;
  return jsonb_build_object('contractVersion','community_thursday_venue_cycle_v1','eventId',v_event.id,'eventKind',v_event.event_kind,'occurrenceIds',v_ids);
end;
$function$;

create or replace function atlas.sync_community_thursday_venue_cycle_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$ begin if new.event_kind in ('free_community_morning','ticketed_seasonal_evening') then perform atlas.ensure_community_thursday_venue_cycle_v1(new.id); end if; return new; end; $function$;

drop trigger if exists sync_community_thursday_venue_cycle_v1 on atlas.community_events;
create trigger sync_community_thursday_venue_cycle_v1
after insert or update of event_kind,event_date,status,start_local_time,end_local_time on atlas.community_events
for each row execute function atlas.sync_community_thursday_venue_cycle_v1();

drop trigger if exists seed_community_thursday_venue_cycle_checklist_v1 on atlas.tasks;
create trigger seed_community_thursday_venue_cycle_checklist_v1
after insert or update of metadata on atlas.tasks
for each row when ((new.metadata->>'execution_checklist_template_key')=any(array['community_thursday_venue_tidy_v1','community_thursday_venue_prep_v1','community_thursday_venue_host_v1']))
execute function atlas.seed_community_thursday_venue_cycle_checklist_trigger_v1();

-- Retire the superseded free-morning three-station recurrence for future dates.
update atlas.planned_work_occurrences
set state='cancelled',released_task_id=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','community_thursday_venue_cycle_v1','cancelledAt',now(),'supersededBy','event_derived_venue_cycle'),
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and planned_due_date>=(now() at time zone 'America/Chicago')::date
  and occurrence_key like any(array['community_thursday_wednesday_outdoor:%','community_thursday_wednesday_coffee_water:%','community_thursday_wednesday_rooms:%'])
  and state not in ('completed','cancelled');

do $$ declare r record; begin
  for r in select id from atlas.community_events where event_kind in ('free_community_morning','ticketed_seasonal_evening') and event_date>=(now() at time zone 'America/Chicago')::date loop
    perform atlas.ensure_community_thursday_venue_cycle_v1(r.id);
  end loop;
end $$;
