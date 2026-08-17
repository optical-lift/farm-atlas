create table if not exists atlas.clock_function_traits (
  stable_key text primary key check (stable_key ~ '^[a-z0-9_]+$'),
  trait_group text not null check (trait_group in ('routine','function','environment_load','timing','interruptibility','fragmentation')),
  label text not null,
  definition text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table atlas.clock_function_traits enable row level security;
revoke all on atlas.clock_function_traits from public, anon, authenticated;
grant select on atlas.clock_function_traits to service_role;

insert into atlas.clock_function_traits(stable_key,trait_group,label,definition)
values
  ('opening_routine','routine','Opening routine','Work intended to anchor the opening portion of a worker day or recurring morning continuity round.'),
  ('field_prep','function','Field preparation','Outdoor preparation or clearing whose function is to make growing space ready for a subsequent production operation.'),
  ('weed','function','Weed','Selective weed removal or weed-suppression work, distinct from crop thinning or general demolition.'),
  ('harvest_cool','timing','Cool-period harvest','Harvest work whose default lawful choreography favors the cool/morning portion of the day unless explicit task truth says otherwise.'),
  ('establish_crop','function','Establish crop','Sow, plant, transplant, pot up, divide/re-establish, or otherwise establish living crop material.'),
  ('irrigate_after_establishment','function','Irrigate after establishment','Water-in or irrigation work structurally tied to a just-completed establishment operation.'),
  ('outdoor_heavy','environment_load','Outdoor heavy','Outdoor work carrying the heavy physical-load class.'),
  ('outdoor_light','environment_load','Outdoor non-heavy','Outdoor work that is not in the heavy physical-load class; includes light and moderate work for Clock choreography.'),
  ('propagation','function','Propagation','Living propagation work such as sowing, germination checks, thinning, potting up, grow-room care, or propagation follow-up.'),
  ('farm_admin_call','function','Farm administration / call','Operator administration that depends on a call, order, vendor/customer contact, pickup coordination, or similar external human dependency.'),
  ('venue_bounded','function','Bounded venue work','Venue or event work with a bounded operational purpose that overlays rather than replaces protected farm work.'),
  ('indoor_clean','function','Indoor cleaning','Cleaning or restoration whose execution environment is indoors.'),
  ('crop_maintenance','function','Crop maintenance','Care, assessment, selective removal, treatment, support, or nourishment of an active crop or living production state.'),
  ('evening_biological','timing','Evening biological','Living establishment or irrigation work whose current day-window contract places it in the evening.'),
  ('interruptible','interruptibility','Interruptible','Work that may usually be paused between meaningful subunits without invalidating the operation.'),
  ('low_interruptibility','interruptibility','Low interruptibility','Work that should normally continue through its operational unit once begun.'),
  ('can_fragment','fragmentation','Can fragment','Work may be divided into multiple Clock blocks while preserving the same task and obligation.'),
  ('should_not_fragment','fragmentation','Should not fragment','Work should normally be placed as one continuous Clock block unless explicit recovery logic says otherwise.')
on conflict (stable_key) do update set
  trait_group=excluded.trait_group,
  label=excluded.label,
  definition=excluded.definition,
  active=true,
  updated_at=now();

create or replace function atlas.task_clock_function_traits_v1(
  p_task_id uuid,
  p_service_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_capacity record;
  v_service_date date:=coalesce(p_service_date,(now() at time zone 'America/Chicago')::date);
  v_operation text;
  v_source_kind text;
  v_action text;
  v_type text;
  v_work_rhythm text;
  v_collection text;
  v_environment text;
  v_environment_source text;
  v_day_window text;
  v_physical_load text;
  v_interruptibility text;
  v_interruptibility_source text;
  v_fragmentation text;
  v_fragmentation_source text;
  v_explicit_fragment text;
  v_explicit_interrupt text;
  v_tags text[]:=array[]::text[];
  v_evidence jsonb:='[]'::jsonb;
  v_unresolved text[]:=array[]::text[];
  v_has_active_crop_object boolean:=false;
  v_is_living_source boolean:=false;
  v_is_propagation boolean:=false;
  v_is_admin_call boolean:=false;
  v_is_venue_bounded boolean:=false;
  v_is_biological_operation boolean:=false;
  v_state text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then
    raise exception 'Task not found.' using errcode='P0002';
  end if;

  if v_task.planned_occurrence_id is not null then
    select * into v_occurrence from atlas.planned_work_occurrences where id=v_task.planned_occurrence_id;
  end if;

  select * into v_capacity from atlas.task_capacity_plan_v1(v_task,v_service_date);

  v_operation:=lower(coalesce(v_task.operation_class,''));
  v_source_kind:=lower(coalesce(v_occurrence.source_kind,''));
  v_action:=lower(coalesce(v_task.action_key,''));
  v_type:=lower(coalesce(v_task.task_type,''));
  v_work_rhythm:=lower(coalesce(v_task.metadata->>'work_rhythm',''));
  v_collection:=lower(coalesce(v_task.metadata->>'work_collection_key',''));
  v_physical_load:=lower(coalesce(v_capacity.physical_load,'moderate'));
  v_day_window:=atlas.worker_task_day_window_v1(v_task.action_key,v_task.task_type,v_task.metadata);

  select exists(
    select 1
    from atlas.task_objects link
    join atlas.crop_cycles cycle on cycle.object_id=link.object_id
    where link.task_id=v_task.id and cycle.lifecycle_status='active'
  ) into v_has_active_crop_object;

  v_is_living_source:=v_source_kind in (
    'production_succession','crop_cycle_milestone','crop_cycle_followup','germination_workflow',
    'germination_thinning','germination_harvest_watch','propagation_followup','propagation_split',
    'sowing_bed_checklist','spring_snapdragon_stagger_2027','retroactive_crop_profile','triggered_sequence'
  );

  v_is_propagation:=
    v_source_kind in ('propagation_followup','propagation_split','germination_workflow','germination_thinning','triggered_sequence','rhythm_state','work_definition')
    and (
      v_type in ('grow_room_care','grow_room_check','germination_check','pot_up','propagation','propagation_start','propagation_readiness','transplant_readiness','thinning','seed_starting','seed_sowing')
      or v_action in ('grow_room_round','grow_room_check','germination_check','pot_up','propagation','propagation_start','thin','thinning','sow','seed')
      or v_work_rhythm in ('grow room care','pot up','seed sowing')
      or lower(coalesce(v_task.metadata->>'collection_zone',''))='grow room'
      or lower(coalesce(v_task.metadata->>'display_location',''))='grow room'
    );

  if not v_is_propagation then
    v_is_propagation:=
      v_type in ('grow_room_care','pot_up','propagation','propagation_start','propagation_readiness')
      or v_action in ('grow_room_round','pot_up','propagation','propagation_start')
      or lower(coalesce(v_task.metadata->>'grow_room_round_linked','false')) in ('true','yes','1')
      or v_work_rhythm in ('grow room care','pot up');
  end if;

  v_is_admin_call:=
    v_action in ('call','contact','order','follow_up','vendor_call','supplier_call','customer_call','schedule_pickup')
    or v_type in ('administrative','network','call','vendor_follow_up','supplier_call','customer_call','farm_admin')
    or lower(coalesce(v_task.metadata->>'external_dependency_kind','')) in ('supplier','vendor','customer','contractor','service','pickup','order','call');

  v_is_venue_bounded:=
    v_source_kind in ('community_event','station_checklist','worker_surface_split')
    or nullif(v_task.metadata->>'event_id','') is not null
    or nullif(v_task.metadata->>'venue_event_id','') is not null
    or lower(coalesce(v_task.metadata->>'work_domain',''))='venue';

  v_is_biological_operation:=v_operation in (
    'establish_aboveground','establish_belowground','divide_reestablish_belowground',
    'water_nourish','harvest_aboveground','harvest_belowground','retain_strengthen',
    'apply_treatment','remove_uproot','inspect_assess'
  ) and (v_is_living_source or v_has_active_crop_object or v_is_propagation);

  if lower(coalesce(v_task.metadata->>'environment','')) in ('indoor','outdoor','either') then
    v_environment:=lower(v_task.metadata->>'environment');
    v_environment_source:='task_explicit_environment';
  elsif v_is_propagation and (
       lower(coalesce(v_task.metadata->>'collection_zone',''))='grow room'
       or lower(coalesce(v_task.metadata->>'display_location',''))='grow room'
       or v_type in ('grow_room_care','grow_room_check','germination_check','pot_up','propagation_readiness')
       or v_work_rhythm in ('grow room care','pot up')
     ) then
    v_environment:='indoor';
    v_environment_source:='propagation_context';
  elsif v_type='exterior_cleaning' then
    v_environment:='outdoor';
    v_environment_source:='task_type_exterior';
  elsif v_operation in (
      'establish_aboveground','establish_belowground','divide_reestablish_belowground',
      'cultivate_prepare','remove_uproot','cut_separate','harvest_aboveground','harvest_belowground',
      'apply_treatment','retain_strengthen','clear_demolish'
    ) then
    v_environment:='outdoor';
    v_environment_source:='operation_default';
  elsif v_operation='clean_restore' and v_type in ('venue_cleaning','interior_cleaning') then
    v_environment:='indoor';
    v_environment_source:='task_type_interior';
  else
    v_environment:='either';
    v_environment_source:='clock_fail_open';
  end if;

  if lower(coalesce(v_task.metadata->>'work_order_anchor','')) in ('top','first','opening')
     or lower(coalesce(v_task.metadata->>'opening_routine','false')) in ('true','yes','1')
     or (v_task.work_lane='rhythm' and v_day_window='morning' and v_work_rhythm='grow room care') then
    v_tags:=array_append(v_tags,'opening_routine');
    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object('trait','opening_routine','source','task_clock_context'));
  end if;

  if v_operation='cultivate_prepare'
     or (v_operation='clear_demolish' and (v_is_living_source or lower(coalesce(v_task.metadata->>'completion_unlocks_sowing','false')) in ('true','yes','1'))) then
    v_tags:=array_append(v_tags,'field_prep');
  end if;

  if v_action in ('weed','weeding') or v_type='weeding' or v_collection='weeding' then
    v_tags:=array_append(v_tags,'weed');
  end if;

  if v_operation in ('harvest_aboveground','harvest_belowground') and v_day_window='morning' then
    v_tags:=array_append(v_tags,'harvest_cool');
  end if;

  if v_operation in ('establish_aboveground','establish_belowground','divide_reestablish_belowground') then
    v_tags:=array_append(v_tags,'establish_crop');
  end if;

  if v_operation='water_nourish' and (
       lower(coalesce(v_task.metadata->>'after_establishment','false')) in ('true','yes','1')
       or lower(coalesce(v_task.metadata->>'irrigate_after_establishment','false')) in ('true','yes','1')
       or nullif(v_task.metadata->>'establishment_task_id','') is not null
       or v_action in ('water_in','irrigate_after_planting')
     ) then
    v_tags:=array_append(v_tags,'irrigate_after_establishment');
  end if;

  if v_environment='outdoor' then
    if v_physical_load='heavy' then
      v_tags:=array_append(v_tags,'outdoor_heavy');
    else
      v_tags:=array_append(v_tags,'outdoor_light');
    end if;
  end if;

  if v_is_propagation then
    v_tags:=array_append(v_tags,'propagation');
  end if;

  if v_is_admin_call then
    v_tags:=array_append(v_tags,'farm_admin_call');
  end if;

  if v_is_venue_bounded then
    v_tags:=array_append(v_tags,'venue_bounded');
  end if;

  if v_operation='clean_restore' and v_environment='indoor' then
    v_tags:=array_append(v_tags,'indoor_clean');
  end if;

  if v_operation in ('remove_uproot','cut_separate','water_nourish','retain_strengthen','apply_treatment','inspect_assess')
     and (v_is_living_source or v_has_active_crop_object or v_is_propagation) then
    v_tags:=array_append(v_tags,'crop_maintenance');
  end if;

  if v_day_window='evening' and v_is_biological_operation then
    v_tags:=array_append(v_tags,'evening_biological');
  end if;

  v_explicit_fragment:=lower(coalesce(v_task.metadata->>'can_fragment',''));
  if v_explicit_fragment in ('true','yes','1') then
    v_fragmentation:='can_fragment';
    v_fragmentation_source:='task_explicit';
  elsif v_explicit_fragment in ('false','no','0') then
    v_fragmentation:='should_not_fragment';
    v_fragmentation_source:='task_explicit';
  elsif v_is_admin_call or v_operation in ('inspect_assess','remove_uproot','cut_separate','clean_restore','cultivate_prepare','repair_restore','build_establish_structure','retain_strengthen','clear_demolish') then
    v_fragmentation:='can_fragment';
    v_fragmentation_source:='operation_default';
  elsif v_operation in ('establish_aboveground','establish_belowground','divide_reestablish_belowground','harvest_aboveground','harvest_belowground','process_postharvest','apply_treatment','water_nourish') then
    v_fragmentation:='should_not_fragment';
    v_fragmentation_source:='operation_default';
  elsif v_is_venue_bounded then
    v_fragmentation:='can_fragment';
    v_fragmentation_source:='venue_default';
  end if;

  if v_fragmentation is not null then
    v_tags:=array_append(v_tags,v_fragmentation);
  else
    v_unresolved:=array_append(v_unresolved,'fragmentation');
  end if;

  v_explicit_interrupt:=lower(coalesce(v_task.metadata->>'interruptibility',''));
  if v_explicit_interrupt in ('interruptible','high','normal') then
    v_interruptibility:='interruptible';
    v_interruptibility_source:='task_explicit';
  elsif v_explicit_interrupt in ('low_interruptibility','low','noninterruptible','not_interruptible') then
    v_interruptibility:='low_interruptibility';
    v_interruptibility_source:='task_explicit';
  elsif v_fragmentation='can_fragment' then
    v_interruptibility:='interruptible';
    v_interruptibility_source:='fragmentation_default';
  elsif v_fragmentation='should_not_fragment' then
    v_interruptibility:='low_interruptibility';
    v_interruptibility_source:='fragmentation_default';
  end if;

  if v_interruptibility is not null then
    v_tags:=array_append(v_tags,v_interruptibility);
  else
    v_unresolved:=array_append(v_unresolved,'interruptibility');
  end if;

  if v_operation='' and not v_is_admin_call and not v_is_venue_bounded then
    v_unresolved:=array_append(v_unresolved,'operation_class');
  end if;

  select coalesce(array_agg(distinct x order by x),array[]::text[])
  into v_tags
  from unnest(v_tags) x;

  select coalesce(array_agg(distinct x order by x),array[]::text[])
  into v_unresolved
  from unnest(v_unresolved) x;

  v_state:=case when coalesce(array_length(v_unresolved,1),0)=0 then 'classified' else 'partial' end;

  return jsonb_build_object(
    'contractVersion','task_clock_function_traits_v1',
    'taskId',v_task.id,
    'serviceDate',v_service_date,
    'state',v_state,
    'operationClass',nullif(v_operation,''),
    'operationClassSource',v_task.operation_class_source,
    'traitKeys',to_jsonb(v_tags),
    'environment',v_environment,
    'environmentSource',v_environment_source,
    'physicalLoad',v_physical_load,
    'dayWindow',v_day_window,
    'interruptibility',v_interruptibility,
    'interruptibilitySource',v_interruptibility_source,
    'fragmentation',v_fragmentation,
    'fragmentationSource',v_fragmentation_source,
    'hasActiveCropObject',v_has_active_crop_object,
    'occurrenceSourceKind',nullif(v_source_kind,''),
    'unresolvedDimensions',to_jsonb(v_unresolved),
    'evidence',v_evidence
  );
end;
$$;

revoke all on function atlas.task_clock_function_traits_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.task_clock_function_traits_v1(uuid,date) to service_role;