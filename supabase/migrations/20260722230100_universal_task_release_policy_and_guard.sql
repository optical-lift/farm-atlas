-- Policy construction, occurrence planning, relation capture, and the hard
-- database boundary that prevents generated work from entering atlas.tasks
-- before the central release engine approves it.

create or replace function atlas.capture_task_relation_payload_v1(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $fn$
select jsonb_build_object(
  'task_objects', coalesce((
    select jsonb_agg(to_jsonb(x)-'task_id'-'created_at' order by x.object_id)
    from atlas.task_objects x where x.task_id=p_task_id
  ),'[]'::jsonb),
  'task_crop_cycles', coalesce((
    select jsonb_agg(to_jsonb(x)-'task_id'-'created_at' order by x.crop_cycle_id,x.role)
    from atlas.task_crop_cycles x where x.task_id=p_task_id
  ),'[]'::jsonb),
  'task_resource_requirements', coalesce((
    select jsonb_agg(
      to_jsonb(x)-'id'-'task_id'-'created_at'-'updated_at'
      order by x.requirement_role,x.resource_id
    )
    from atlas.task_resource_requirements x where x.task_id=p_task_id
  ),'[]'::jsonb),
  'production_lot_tasks', coalesce((
    select jsonb_agg(
      to_jsonb(x)-'id'-'task_id'-'created_at'-'updated_at'
      order by x.production_lot_id,x.link_role
    )
    from atlas.production_lot_tasks x where x.task_id=p_task_id
  ),'[]'::jsonb),
  'production_harvest_lot_tasks', coalesce((
    select jsonb_agg(
      to_jsonb(x)-'id'-'task_id'-'created_at'-'updated_at'
      order by x.harvest_lot_id,x.link_role
    )
    from atlas.production_harvest_lot_tasks x where x.task_id=p_task_id
  ),'[]'::jsonb)
);
$fn$;

create or replace function atlas.restore_task_relation_payload_v1(
  p_task_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare x jsonb;
begin
  for x in
    select value
    from jsonb_array_elements(coalesce(p_payload->'task_objects','[]'::jsonb))
  loop
    insert into atlas.task_objects(task_id,object_id,role)
    values(
      p_task_id,
      (x->>'object_id')::uuid,
      coalesce(nullif(x->>'role',''),'target')
    )
    on conflict(task_id,object_id)
    do update set role=excluded.role;
  end loop;

  for x in
    select value
    from jsonb_array_elements(coalesce(p_payload->'task_crop_cycles','[]'::jsonb))
  loop
    insert into atlas.task_crop_cycles(
      task_id,crop_cycle_id,role,confidence,source,metadata
    )
    values(
      p_task_id,
      (x->>'crop_cycle_id')::uuid,
      coalesce(nullif(x->>'role',''),'affects'),
      coalesce(nullif(x->>'confidence',''),'confirmed'),
      coalesce(nullif(x->>'source',''),'release_engine'),
      coalesce(x->'metadata','{}'::jsonb)
    )
    on conflict(task_id,crop_cycle_id,role)
    do update set
      confidence=excluded.confidence,
      source=excluded.source,
      metadata=atlas.task_crop_cycles.metadata||excluded.metadata;
  end loop;

  for x in
    select value
    from jsonb_array_elements(
      coalesce(p_payload->'task_resource_requirements','[]'::jsonb)
    )
  loop
    insert into atlas.task_resource_requirements(
      task_id,resource_id,template_id,requirement_role,requirement_source,
      quantity_needed,unit,status,note,metadata
    )
    values(
      p_task_id,
      case when nullif(x->>'resource_id','') is null
        then null else (x->>'resource_id')::uuid end,
      case when nullif(x->>'template_id','') is null
        then null else (x->>'template_id')::uuid end,
      coalesce(nullif(x->>'requirement_role',''),'required'),
      coalesce(nullif(x->>'requirement_source',''),'system_generated'),
      case when nullif(x->>'quantity_needed','') is null
        then null else (x->>'quantity_needed')::numeric end,
      nullif(x->>'unit',''),
      coalesce(nullif(x->>'status',''),'needed'),
      nullif(x->>'note',''),
      coalesce(x->'metadata','{}'::jsonb)
    );
  end loop;

  for x in
    select value
    from jsonb_array_elements(coalesce(p_payload->'production_lot_tasks','[]'::jsonb))
  loop
    insert into atlas.production_lot_tasks(
      production_lot_id,task_id,link_role,source,metadata
    )
    values(
      (x->>'production_lot_id')::uuid,
      p_task_id,
      coalesce(nullif(x->>'link_role',''),'generated'),
      coalesce(nullif(x->>'source',''),'release_engine'),
      coalesce(x->'metadata','{}'::jsonb)
    )
    on conflict(production_lot_id,task_id,link_role)
    do update set
      source=excluded.source,
      metadata=atlas.production_lot_tasks.metadata||excluded.metadata;
  end loop;

  for x in
    select value
    from jsonb_array_elements(
      coalesce(p_payload->'production_harvest_lot_tasks','[]'::jsonb)
    )
  loop
    insert into atlas.production_harvest_lot_tasks(
      harvest_lot_id,task_id,link_role,source,metadata
    )
    values(
      (x->>'harvest_lot_id')::uuid,
      p_task_id,
      coalesce(nullif(x->>'link_role',''),'container_assignment'),
      coalesce(nullif(x->>'source',''),'release_engine'),
      coalesce(x->'metadata','{}'::jsonb)
    )
    on conflict(harvest_lot_id,task_id,link_role)
    do update set
      metadata=atlas.production_harvest_lot_tasks.metadata||excluded.metadata;
  end loop;
end;
$fn$;

create or replace function atlas.ensure_auto_release_policy_v1(
  p_farm_id uuid,
  p_generated_from text,
  p_task_type text,
  p_task_series_key text,
  p_action_key text,
  p_status text,
  p_metadata jsonb
)
returns table(
  work_definition_id uuid,
  release_policy_id uuid,
  horizon_days integer,
  gate_type text
)
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_source text := coalesce(nullif(p_generated_from,''),'manual');
  v_series text := coalesce(
    nullif(p_task_series_key,''),nullif(p_action_key,''),
    nullif(p_task_type,''),'general'
  );
  v_definition_key text;
  v_policy_key text;
  v_default_horizon integer;
  v_default_gate text;
  v_default_max_active integer;
  v_definition_id uuid;
  v_policy_id uuid;
  v_effective_horizon integer;
  v_effective_gate text;
  v_farm_max integer;
begin
  insert into atlas.farm_task_release_settings(farm_id)
  values(p_farm_id)
  on conflict(farm_id) do nothing;

  select maximum_task_horizon_days
  into v_farm_max
  from atlas.farm_task_release_settings
  where farm_id=p_farm_id;

  v_default_horizon := case
    when p_task_type='chore'
      or lower(coalesce(p_metadata->>'work_rhythm',''))='kid chore' then 7
    when p_generated_from is null then v_farm_max
    when p_generated_from='recurring_task' then 14
    when p_generated_from like 'maintenance_%'
      or p_generated_from like 'weeding_%' then 21
    when p_generated_from in (
      'crop_cycle_milestone','crop_cycle_followup','germination_workflow',
      'germination_harvest_watch','germination_thinning','germination_patch'
    ) then 30
    when p_generated_from in (
      'production_succession','production_bed_assignment',
      'spring_snapdragon_stagger_2027','propagation_followup',
      'propagation_split','production_tray_batch','production_transplant_gate',
      'production_harvest_gate','production_postharvest_gate'
    ) then 45
    when p_generated_from in ('workflow_handoff','triggered_sequence')
      then v_farm_max
    else (
      select default_generated_horizon_days
      from atlas.farm_task_release_settings
      where farm_id=p_farm_id
    )
  end;
  v_default_horizon := least(v_default_horizon,v_farm_max);

  v_default_gate := case
    when p_task_type='chore'
      or lower(coalesce(p_metadata->>'work_rhythm',''))='kid chore'
      then 'time_window'
    when p_generated_from is null then 'immediate'
    when p_generated_from in ('workflow_handoff','triggered_sequence')
      then 'event'
    when p_status='blocked' then 'state'
    else 'time_window'
  end;

  v_default_max_active := case
    when p_task_type='chore'
      or lower(coalesce(p_metadata->>'work_rhythm',''))='kid chore' then 7
    when p_generated_from='recurring_task' then 7
    when p_generated_from like 'maintenance_%'
      or p_generated_from like 'weeding_%' then 50
    when p_generated_from='production_succession' then 12
    else 50
  end;

  v_definition_key := left(
    'auto:' || regexp_replace(lower(v_source),'[^a-z0-9]+','_','g') || ':' ||
    regexp_replace(lower(v_series),'[^a-z0-9]+','_','g'),
    120
  ) || ':' || substr(md5(v_source || ':' || v_series),1,12);
  v_policy_key := v_definition_key || ':default';

  insert into atlas.work_definitions(
    farm_id,stable_key,title_template,task_type,source_kind,action_key,work_class,
    default_priority,default_visibility_scope,metadata
  )
  values(
    p_farm_id,
    v_definition_key,
    coalesce(nullif(p_metadata->>'display_title',''),v_series),
    coalesce(nullif(p_task_type,''),'general'),
    p_generated_from,
    p_action_key,
    nullif(p_metadata->>'effort_band',''),
    coalesce(nullif(p_metadata->>'priority',''),'normal'),
    coalesce(nullif(p_metadata->>'visibility_scope',''),'farm_shared'),
    jsonb_build_object(
      'created_by','automatic_release_gate',
      'series_key',p_task_series_key
    )
  )
  on conflict(farm_id,stable_key)
  do update set
    task_type=excluded.task_type,
    source_kind=coalesce(excluded.source_kind,atlas.work_definitions.source_kind),
    action_key=coalesce(excluded.action_key,atlas.work_definitions.action_key),
    updated_at=now()
  returning id into v_definition_id;

  -- Existing farm/policy overrides are authoritative. New occurrences never
  -- silently raise a configured horizon or capacity ceiling.
  insert into atlas.work_release_policies(
    farm_id,work_definition_id,stable_key,gate_type,horizon_days,
    maximum_active_instances,gate_config,metadata
  )
  values(
    p_farm_id,v_definition_id,v_policy_key,v_default_gate,v_default_horizon,
    v_default_max_active,
    jsonb_build_object('automatic',true,'source_kind',p_generated_from),
    jsonb_build_object('created_by','automatic_release_gate')
  )
  on conflict(farm_id,stable_key)
  do update set
    work_definition_id=excluded.work_definition_id,
    gate_config=atlas.work_release_policies.gate_config || jsonb_build_object(
      'automatic',true,
      'source_kind',coalesce(
        p_generated_from,
        atlas.work_release_policies.gate_config->>'source_kind'
      )
    ),
    updated_at=now()
  returning id into v_policy_id;

  select p.horizon_days,p.gate_type
  into v_effective_horizon,v_effective_gate
  from atlas.work_release_policies p
  where p.id=v_policy_id;

  return query
  select v_definition_id,v_policy_id,v_effective_horizon,v_effective_gate;
end;
$fn$;

create or replace function atlas.plan_work_occurrence_v1(
  p_farm_id uuid,
  p_definition_key text,
  p_policy_key text,
  p_occurrence_key text,
  p_title text,
  p_task_type text,
  p_due_date date,
  p_source_kind text,
  p_source_id uuid,
  p_gate_type text,
  p_horizon_days integer,
  p_maximum_active_instances integer,
  p_task_payload jsonb,
  p_relation_payload jsonb default '{}'::jsonb,
  p_gate_config jsonb default '{}'::jsonb,
  p_not_before_date date default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_definition_id uuid;
  v_policy_id uuid;
  v_occurrence_id uuid;
  v_farm_max integer;
begin
  if p_farm_id is null
     or nullif(btrim(p_definition_key),'') is null
     or nullif(btrim(p_policy_key),'') is null
     or nullif(btrim(p_occurrence_key),'') is null
     or nullif(btrim(p_title),'') is null
  then
    raise exception
      'Farm, definition key, policy key, occurrence key, and title are required.'
      using errcode='22023';
  end if;

  insert into atlas.farm_task_release_settings(farm_id)
  values(p_farm_id)
  on conflict(farm_id) do nothing;

  select maximum_task_horizon_days
  into v_farm_max
  from atlas.farm_task_release_settings
  where farm_id=p_farm_id;

  insert into atlas.work_definitions(
    farm_id,stable_key,title_template,task_type,source_kind,action_key,work_class,
    default_priority,default_visibility_scope,metadata
  )
  values(
    p_farm_id,p_definition_key,p_title,
    coalesce(nullif(p_task_type,''),'general'),p_source_kind,
    p_task_payload->>'action_key',p_task_payload->>'work_class',
    coalesce(nullif(p_task_payload->>'priority',''),'normal'),
    coalesce(nullif(p_task_payload->>'visibility_scope',''),'farm_shared'),
    jsonb_build_object('created_by','plan_work_occurrence_v1')
  )
  on conflict(farm_id,stable_key)
  do update set
    title_template=excluded.title_template,
    task_type=excluded.task_type,
    source_kind=coalesce(excluded.source_kind,atlas.work_definitions.source_kind),
    updated_at=now()
  returning id into v_definition_id;

  insert into atlas.work_release_policies(
    farm_id,work_definition_id,stable_key,gate_type,horizon_days,
    maximum_active_instances,gate_config,metadata
  )
  values(
    p_farm_id,v_definition_id,p_policy_key,p_gate_type,
    least(greatest(0,p_horizon_days),v_farm_max),
    greatest(1,p_maximum_active_instances),
    coalesce(p_gate_config,'{}'::jsonb),
    jsonb_build_object('created_by','plan_work_occurrence_v1')
  )
  on conflict(farm_id,stable_key)
  do update set
    work_definition_id=excluded.work_definition_id,
    gate_type=excluded.gate_type,
    horizon_days=excluded.horizon_days,
    maximum_active_instances=excluded.maximum_active_instances,
    gate_config=atlas.work_release_policies.gate_config||excluded.gate_config,
    updated_at=now()
  returning id into v_policy_id;

  insert into atlas.planned_work_occurrences(
    farm_id,work_definition_id,release_policy_id,occurrence_key,
    source_kind,source_id,title,planned_due_date,not_before_date,state,
    task_payload,relation_payload,metadata
  )
  values(
    p_farm_id,v_definition_id,v_policy_id,p_occurrence_key,
    p_source_kind,p_source_id,p_title,p_due_date,p_not_before_date,'planned',
    coalesce(p_task_payload,'{}'::jsonb),
    coalesce(p_relation_payload,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(farm_id,work_definition_id,occurrence_key)
  do update set
    release_policy_id=excluded.release_policy_id,
    source_kind=excluded.source_kind,
    source_id=excluded.source_id,
    title=excluded.title,
    planned_due_date=excluded.planned_due_date,
    not_before_date=excluded.not_before_date,
    task_payload=excluded.task_payload,
    relation_payload=case
      when excluded.relation_payload='{}'::jsonb
        then atlas.planned_work_occurrences.relation_payload
      else excluded.relation_payload
    end,
    metadata=atlas.planned_work_occurrences.metadata||excluded.metadata,
    state=case
      when atlas.planned_work_occurrences.state in ('released','completed')
        then atlas.planned_work_occurrences.state
      else 'planned'
    end,
    updated_at=now()
  returning id into v_occurrence_id;

  return v_occurrence_id;
end;
$fn$;

create or replace function atlas.install_task_release_gate_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_policy record;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_occurrence_key text;
  v_original_payload jsonb;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_gate_ready boolean := false;
  v_should_defer boolean := false;
  v_existing_active_task uuid;
  v_original_status text := new.status;
begin
  if new.status not in ('open','blocked') then
    return new;
  end if;

  -- The central engine supplies both keys. No generator may impersonate this
  -- path without a real occurrence and policy that validate against its farm.
  if new.planned_occurrence_id is not null
     and new.release_policy_id is not null
  then
    new.released_at := coalesce(new.released_at,now());
    new.release_reason := coalesce(
      new.release_reason,'central_release_engine'
    );
    new.metadata := coalesce(new.metadata,'{}'::jsonb) ||
      jsonb_build_object(
        'release_gate_installed',true,
        'planned_occurrence_id',new.planned_occurrence_id,
        'release_policy_id',new.release_policy_id,
        'released_at',new.released_at,
        'release_reason',new.release_reason
      );
    return new;
  end if;

  select * into v_policy
  from atlas.ensure_auto_release_policy_v1(
    new.farm_id,new.generated_from,new.task_type,new.task_series_key,
    new.action_key,new.status,coalesce(new.metadata,'{}'::jsonb)
  );

  v_occurrence_key := coalesce(
    nullif(new.engine_instance_key,''),
    case
      when nullif(new.task_series_key,'') is not null
       and new.due_date is not null
      then new.task_series_key || ':' || new.due_date::text
    end,
    coalesce(new.generated_from,'manual') || ':' ||
      coalesce(new.generated_from_id::text,new.id::text) || ':' ||
      coalesce(new.due_date::text,'undated') || ':' ||
      substr(md5(lower(new.title)),1,12)
  );

  v_original_payload := to_jsonb(new)
    - 'id' - 'created_at' - 'updated_at'
    - 'planned_occurrence_id' - 'release_policy_id'
    - 'released_at' - 'release_reason';

  v_gate_ready :=
    v_policy.gate_type in ('immediate','time_window','serial_queue')
    and v_original_status<>'blocked'
    and (
      new.due_date is null
      or new.due_date<=v_today+v_policy.horizon_days
    );

  -- Generated work and every non-immediate policy always enter the occurrence
  -- layer. Manual immediate work is the only direct execution path.
  v_should_defer :=
    new.generated_from is not null
    or v_policy.gate_type<>'immediate';

  if new.generated_from is null
     and v_policy.gate_type='immediate'
     and new.due_date is not null
     and new.due_date>v_today+v_policy.horizon_days
  then
    raise exception
      'Manual tasks cannot be released more than % days ahead. Store this as planned work instead.',
      v_policy.horizon_days
      using errcode='22023';
  end if;

  insert into atlas.planned_work_occurrences(
    farm_id,work_definition_id,release_policy_id,occurrence_key,
    source_kind,source_id,title,planned_due_date,not_before_date,state,
    gate_satisfied_at,task_payload,metadata
  )
  values(
    new.farm_id,v_policy.work_definition_id,v_policy.release_policy_id,
    v_occurrence_key,new.generated_from,new.generated_from_id,new.title,
    new.due_date,
    case when new.due_date is null
      then v_today else new.due_date-v_policy.horizon_days end,
    case when v_gate_ready then 'eligible' else 'planned' end,
    case when v_gate_ready then now() else null end,
    v_original_payload,
    jsonb_build_object(
      'created_by','task_insert_gate',
      'original_task_id',new.id
    )
  )
  on conflict(farm_id,work_definition_id,occurrence_key)
  do update set
    release_policy_id=excluded.release_policy_id,
    source_kind=excluded.source_kind,
    source_id=excluded.source_id,
    title=excluded.title,
    planned_due_date=excluded.planned_due_date,
    not_before_date=excluded.not_before_date,
    task_payload=excluded.task_payload,
    state=case
      when atlas.planned_work_occurrences.state in ('released','completed')
        then atlas.planned_work_occurrences.state
      when v_gate_ready then 'eligible'
      else 'planned'
    end,
    gate_satisfied_at=case
      when atlas.planned_work_occurrences.state in ('released','completed')
        then atlas.planned_work_occurrences.gate_satisfied_at
      when v_gate_ready then now()
      else null
    end,
    metadata=atlas.planned_work_occurrences.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_occurrence;

  if v_occurrence.state='released'
     and v_occurrence.released_task_id is not null
  then
    select t.id into v_existing_active_task
    from atlas.tasks t
    where t.id=v_occurrence.released_task_id
      and t.status in ('open','blocked');

    if v_existing_active_task is not null then
      v_should_defer := true;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) ||
        jsonb_build_object(
          'release_duplicate',true,
          'canonical_task_id',v_existing_active_task
        );
    end if;
  end if;

  new.planned_occurrence_id := v_occurrence.id;
  new.release_policy_id := v_policy.release_policy_id;

  if v_should_defer then
    new.status := 'archived';
    new.due_date := null;
    new.completed_at := null;
    new.completed_by := null;
    new.engine_instance_key := null;
    new.visibility_scope := 'system_internal';
    new.released_at := null;
    new.release_reason := null;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) ||
      jsonb_build_object(
        'release_deferred',true,
        'release_gate_installed',true,
        'planned_occurrence_id',v_occurrence.id,
        'release_policy_id',v_policy.release_policy_id,
        'deferred_at',now(),
        'deferred_reason',case
          when not v_gate_ready then 'release_gate_not_satisfied'
          else 'awaiting_central_release'
        end
      );
  else
    new.released_at := now();
    new.release_reason := 'manual_immediate';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) ||
      jsonb_build_object(
        'release_gate_installed',true,
        'planned_occurrence_id',v_occurrence.id,
        'release_policy_id',v_policy.release_policy_id,
        'released_at',new.released_at,
        'release_reason',new.release_reason
      );
  end if;

  return new;
end;
$fn$;

create or replace function atlas.validate_active_task_release_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_horizon integer;
  v_occurrence_farm uuid;
  v_policy_farm uuid;
begin
  if new.status not in ('open','blocked') then
    return new;
  end if;

  if new.planned_occurrence_id is null
     or new.release_policy_id is null
     or new.released_at is null
  then
    raise exception
      'Active tasks require a planned occurrence, release policy, and release timestamp.'
      using errcode='23514';
  end if;

  select o.farm_id,p.farm_id,
         least(p.horizon_days,s.maximum_task_horizon_days)
  into v_occurrence_farm,v_policy_farm,v_horizon
  from atlas.planned_work_occurrences o
  join atlas.work_release_policies p on p.id=new.release_policy_id
  join atlas.farm_task_release_settings s on s.farm_id=new.farm_id
  where o.id=new.planned_occurrence_id
    and o.release_policy_id=p.id;

  if v_occurrence_farm is distinct from new.farm_id
     or v_policy_farm is distinct from new.farm_id
  then
    raise exception
      'Task release gate does not belong to the task farm.'
      using errcode='23514';
  end if;

  if new.due_date is not null
     and new.due_date>v_today+v_horizon
  then
    raise exception
      'Task due date exceeds its % day release horizon.',v_horizon
      using errcode='23514';
  end if;

  return new;
end;
$fn$;

create or replace function atlas.finalize_task_release_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
begin
  if new.status not in ('open','blocked')
     or new.planned_occurrence_id is null
  then
    return new;
  end if;

  update atlas.planned_work_occurrences
  set
    state='released',
    released_at=coalesce(released_at,new.released_at,now()),
    released_task_id=new.id,
    updated_at=now(),
    metadata=metadata||jsonb_build_object('last_released_task_id',new.id)
  where id=new.planned_occurrence_id;

  insert into atlas.task_release_events(
    farm_id,occurrence_id,release_policy_id,task_id,
    release_reason,released_at,metadata
  )
  values(
    new.farm_id,new.planned_occurrence_id,new.release_policy_id,new.id,
    coalesce(new.release_reason,'release_gate'),coalesce(new.released_at,now()),
    jsonb_build_object(
      'generated_from',new.generated_from,
      'generated_from_id',new.generated_from_id
    )
  )
  on conflict(occurrence_id,task_id) do nothing;

  return new;
end;
$fn$;

create or replace function atlas.capture_deferred_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare v_payload jsonb;
begin
  if coalesce(new.metadata->>'release_deferred','false')<>'true' then
    return null;
  end if;

  if coalesce(new.metadata->>'release_duplicate','false')<>'true' then
    v_payload := atlas.capture_task_relation_payload_v1(new.id);
    update atlas.planned_work_occurrences
    set
      relation_payload=case
        when v_payload='{}'::jsonb then relation_payload
        else v_payload
      end,
      updated_at=now()
    where id=new.planned_occurrence_id;
  end if;

  update atlas.workflow_handoffs
  set target_occurrence_id=new.planned_occurrence_id,
      target_task_id=null,
      updated_at=now()
  where target_task_id=new.id;

  update atlas.task_release_queue_items
  set planned_occurrence_id=new.planned_occurrence_id,
      task_id=null,
      updated_at=now()
  where task_id=new.id;

  delete from atlas.tasks where id=new.id;
  return null;
end;
$fn$;

create or replace function atlas.attach_released_task_to_source_v1(
  p_occurrence_id uuid,
  p_task_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  o atlas.planned_work_occurrences%rowtype;
  t atlas.tasks%rowtype;
begin
  select * into o
  from atlas.planned_work_occurrences
  where id=p_occurrence_id;
  select * into t from atlas.tasks where id=p_task_id;
  if o.id is null or t.id is null then return; end if;

  if o.source_kind='production_succession' and o.source_id is not null then
    update atlas.production_successions
    set sow_task_id=p_task_id,updated_at=now()
    where id=o.source_id;
  elsif o.source_kind='workflow_handoff' and o.source_id is not null then
    update atlas.workflow_handoffs
    set target_task_id=p_task_id,updated_at=now()
    where id=o.source_id;
  elsif o.source_kind='production_transplant_gate'
        and o.source_id is not null
        and t.task_type='production_transplant' then
    update atlas.production_transplant_gates
    set transplant_task_id=p_task_id,updated_at=now()
    where id=o.source_id;
  elsif o.source_kind='production_harvest_gate' and o.source_id is not null then
    if t.task_type='production_harvest_readiness' then
      update atlas.production_harvest_gates
      set harvest_readiness_task_id=p_task_id,
          harvest_task_id=p_task_id,
          updated_at=now()
      where id=o.source_id;
    elsif t.task_type='production_harvest' then
      update atlas.production_harvest_gates
      set harvest_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    end if;
  elsif o.source_kind='production_postharvest_gate'
        and o.source_id is not null then
    if t.task_type='postharvest_container_assignment' then
      update atlas.production_postharvest_gates
      set owner_assignment_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    elsif t.task_type='production_postharvest_conditioning' then
      update atlas.production_postharvest_gates
      set conditioning_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    elsif t.task_type='production_postharvest_cooling' then
      update atlas.production_postharvest_gates
      set cooling_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    elsif t.task_type='postharvest_container_wash' then
      update atlas.production_postharvest_gates
      set wash_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    end if;
  end if;
end;
$fn$;

revoke all on function atlas.capture_task_relation_payload_v1(uuid)
  from public,anon,authenticated;
revoke all on function atlas.restore_task_relation_payload_v1(uuid,jsonb)
  from public,anon,authenticated;
revoke all on function atlas.ensure_auto_release_policy_v1(
  uuid,text,text,text,text,text,jsonb
) from public,anon,authenticated;
revoke all on function atlas.plan_work_occurrence_v1(
  uuid,text,text,text,text,text,date,text,uuid,text,integer,integer,
  jsonb,jsonb,jsonb,date,jsonb
) from public,anon,authenticated;
