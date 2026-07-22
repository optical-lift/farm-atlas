create or replace function atlas.normalize_germination_next_stage_task()
returns trigger
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  profile atlas.crop_profiles%rowtype;
  source_task atlas.tasks%rowtype;
  anchor_date date;
  window_min integer;
  window_max integer;
  workflow_kind text;
  crop_name text;
  crop_display_name text;
  canonical_crop_cycle_id uuid;
  canonical_crop_label text;
  canonical_variety text;
begin
  if new.generated_from is distinct from 'germination_harvest_watch' then
    return new;
  end if;

  select * into source_task from atlas.tasks where id = new.generated_from_id;
  select * into profile
  from atlas.crop_profiles
  where id = nullif(new.metadata->>'crop_profile_id','')::uuid;

  select
    cc.id,
    coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,'')),
    coalesce(nullif(cc.variety,''), nullif(oc.variety,''))
  into canonical_crop_cycle_id, canonical_crop_label, canonical_variety
  from atlas.task_crop_cycles tcc
  join atlas.crop_cycles cc on cc.id = tcc.crop_cycle_id
  left join atlas.object_contents oc on oc.id = cc.object_content_id
  where tcc.task_id = source_task.id
  order by
    case tcc.role when 'creates' then 0 when 'affects' then 1 when 'observes' then 2 else 3 end,
    case tcc.confidence when 'confirmed' then 0 else 1 end,
    tcc.created_at
  limit 1;

  anchor_date := coalesce(
    nullif(source_task.metadata->>'actual_sow_date','')::date,
    nullif(source_task.metadata->>'source_sown_date','')::date,
    nullif(new.metadata->>'source_sown_date','')::date,
    source_task.due_date,
    current_date
  );

  workflow_kind := coalesce(profile.metadata->>'workflow_kind','');
  crop_name := coalesce(
    canonical_variety,
    nullif(source_task.metadata->>'crop_variety',''),
    nullif(source_task.metadata->>'variety',''),
    nullif(new.metadata->>'variety',''),
    nullif(profile.variety,''),
    canonical_crop_label,
    profile.crop_label,
    'Crop'
  );

  if lower(crop_name) like '%' || lower(coalesce(canonical_crop_label, profile.crop_label, '')) || '%' then
    crop_display_name := crop_name;
  elsif coalesce(canonical_crop_label, profile.crop_label, '') <> '' then
    crop_display_name := crop_name || ' ' || lower(coalesce(canonical_crop_label, profile.crop_label));
  else
    crop_display_name := crop_name;
  end if;

  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'crop_cycle_id', canonical_crop_cycle_id,
      'crop', coalesce(canonical_crop_label, profile.crop_label),
      'variety', canonical_variety,
      'crop_variety', canonical_variety
    ));

  if workflow_kind = 'transplant_start' then
    window_min := coalesce(nullif(profile.metadata->>'transplant_ready_days_min','')::integer, 25);
    window_max := coalesce(nullif(profile.metadata->>'transplant_ready_days_max','')::integer, window_min + 10);

    new.task_type := 'transplant_readiness';
    new.title := 'Open transplant readiness window — ' || crop_display_name || ' — ' || coalesce(new.metadata->>'display_detail','Elm Farm');
    new.due_date := anchor_date + window_min;
    new.metadata := jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(new.metadata,'{}'::jsonb), '{task_style}', '"transplant_readiness"'::jsonb, true),
            '{display_subject}', to_jsonb(crop_display_name || ' transplant readiness'), true),
          '{source_sown_date}', to_jsonb(anchor_date::text), true),
        '{window_start}', to_jsonb((anchor_date + window_min)::text), true),
      '{window_end}', to_jsonb((anchor_date + window_max)::text), true
    );
  elsif profile.days_to_harvest_watch_min is not null then
    window_min := profile.days_to_harvest_watch_min;
    window_max := coalesce(profile.days_to_harvest_watch_max, window_min);

    new.task_type := 'harvest_window';
    new.title := 'Open harvest window — ' || crop_display_name || ' — ' || coalesce(new.metadata->>'display_detail','Elm Farm');
    new.due_date := anchor_date + window_min;
    new.metadata := jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(new.metadata,'{}'::jsonb), '{task_style}', '"harvest_window"'::jsonb, true),
            '{display_subject}', to_jsonb(crop_display_name || ' harvest window'), true),
          '{source_sown_date}', to_jsonb(anchor_date::text), true),
        '{window_start}', to_jsonb((anchor_date + window_min)::text), true),
      '{window_end}', to_jsonb((anchor_date + window_max)::text), true
    );
  else
    new.status := 'archived';
    new.due_date := null;
    new.metadata := jsonb_set(coalesce(new.metadata,'{}'::jsonb), '{archived_reason}', '"No valid next-stage window exists on crop profile"'::jsonb, true);
  end if;

  return new;
end;
$function$;

create or replace function atlas.record_germination_check_for_member_v1(
  p_farm_id uuid,
  p_task_id uuid default null::uuid,
  p_task_title text default null::text,
  p_action text default null::text,
  p_spacing_outcome text default null::text,
  p_target_spacing_inches numeric default null::numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_task atlas.tasks%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_object_id uuid;
  v_object_label text := 'Unassigned growing area';
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_now timestamptz := now();
  v_next_date date;
  v_transition_result jsonb;
  v_target_spacing numeric;
  v_source_sown_date date;
  v_crop_name text;
  v_crop_display_name text;
  v_canonical_crop_label text;
  v_canonical_variety text;
  v_outcome_label text;
  v_summary text;
  v_result_metadata jsonb;
  v_harvest_due date;
  v_harvest_task_id uuid;
  v_action_task_id uuid;
  v_crop_cycle_id uuid;
  v_assigned_membership_id uuid;
  v_visibility_scope text;
  v_worker_key text;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select t.* into v_task
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.status in ('open','blocked','done')
    and (
      (p_task_id is not null and t.id = p_task_id)
      or (p_task_id is null and nullif(btrim(p_task_title),'') is not null and lower(t.title) = lower(btrim(p_task_title)))
    )
  order by t.due_date nulls last
  limit 1
  for update;

  if v_task.id is null then
    raise exception 'Germination check task was not found.' using errcode = 'P0002';
  end if;

  if v_role = 'farm_hand' and (
    v_task.visibility_scope <> 'assigned_worker'
    or v_task.assigned_membership_id <> v_membership_id
  ) then
    raise exception 'This germination task is not assigned to the signed-in Farm Hand.' using errcode = '42501';
  end if;

  if coalesce(v_task.metadata->>'task_style','') <> 'germination_check'
     and v_task.task_type <> 'germination_check' then
    raise exception 'This task is not a germination check.' using errcode = '22023';
  end if;

  select task_link.object_id, go.label
  into v_object_id, v_object_label
  from atlas.task_objects task_link
  join atlas.growing_objects go on go.id = task_link.object_id
  where task_link.task_id = v_task.id
  order by case when task_link.role in ('primary_location','target') then 0 else 1 end, go.sort_order
  limit 1;

  select cp.* into v_profile
  from atlas.crop_profiles cp
  where (
    nullif(v_task.metadata->>'crop_profile_id','')::uuid = cp.id
    or (
      nullif(v_task.metadata->>'crop_profile_id','') is null
      and nullif(v_task.metadata->>'crop_profile_stable_key','') = cp.stable_key
    )
  )
  limit 1;

  if v_profile.id is null then
    raise exception 'This germination task is missing its seed profile.' using errcode = '22023';
  end if;

  select
    cc.id,
    coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,'')),
    coalesce(nullif(cc.variety,''), nullif(oc.variety,''))
  into v_crop_cycle_id, v_canonical_crop_label, v_canonical_variety
  from atlas.task_crop_cycles tcc
  join atlas.crop_cycles cc on cc.id = tcc.crop_cycle_id
  left join atlas.object_contents oc on oc.id = cc.object_content_id
  where tcc.task_id = v_task.id
  order by
    case tcc.role when 'creates' then 0 when 'affects' then 1 when 'observes' then 2 else 3 end,
    case tcc.confidence when 'confirmed' then 0 else 1 end,
    tcc.created_at
  limit 1;

  if v_crop_cycle_id is null and v_object_id is not null then
    select
      cc.id,
      coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,'')),
      coalesce(nullif(cc.variety,''), nullif(oc.variety,''))
    into v_crop_cycle_id, v_canonical_crop_label, v_canonical_variety
    from atlas.crop_cycles cc
    left join atlas.object_contents oc on oc.id = cc.object_content_id
    where cc.farm_id = p_farm_id
      and cc.object_id = v_object_id
      and cc.crop_profile_id = v_profile.id
      and cc.lifecycle_status = 'active'
    order by cc.created_at desc
    limit 1;
  end if;

  v_crop_name := coalesce(
    v_canonical_variety,
    nullif(v_task.metadata->>'crop_variety',''),
    nullif(v_task.metadata->>'variety',''),
    nullif(v_profile.variety,''),
    v_canonical_crop_label,
    v_profile.crop_label
  );

  if lower(v_crop_name) like '%' || lower(coalesce(v_canonical_crop_label, v_profile.crop_label, '')) || '%' then
    v_crop_display_name := v_crop_name;
  elsif coalesce(v_canonical_crop_label, v_profile.crop_label, '') <> '' then
    v_crop_display_name := v_crop_name || ' ' || lower(coalesce(v_canonical_crop_label, v_profile.crop_label));
  else
    v_crop_display_name := v_crop_name;
  end if;

  if p_action = 'not_yet' then
    if v_task.status = 'done' then
      return jsonb_build_object('action','not_yet','taskId',v_task.id,'nextDate',v_task.due_date,'deduplicated',true);
    end if;
    v_next_date := greatest(coalesce(v_task.due_date, v_today), v_today) + 1;
    v_transition_result := atlas.record_task_transition_v1_internal(
      v_task.id,
      'rescheduled',
      left('germination:not-yet:' || v_task.id::text || ':' || v_today::text, 160),
      v_next_date,
      'Not germinated yet.',
      'Not germinated yet.',
      'maintain',
      'germination_check',
      jsonb_build_object('germination_action','not_yet','actor_membership_id',v_membership_id,'actor_role',v_role),
      null
    );
    if not coalesce((v_transition_result->>'deduplicated')::boolean,false) then
      update atlas.tasks
      set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'not_yet_count', coalesce(nullif(metadata->>'not_yet_count','')::integer,0) + 1,
            'last_not_yet_at', v_now
          ),
          updated_at = v_now
      where id = v_task.id;
    end if;
    return jsonb_build_object('action','not_yet','taskId',v_task.id,'nextDate',v_next_date,'deduplicated',coalesce((v_transition_result->>'deduplicated')::boolean,false));
  end if;

  if p_action <> 'germinated' then
    raise exception 'Action must be not_yet or germinated.' using errcode = '22023';
  end if;
  if p_spacing_outcome not in ('thin','on_target','patch') then
    raise exception 'Choose thin, on_target, or patch.' using errcode = '22023';
  end if;

  v_target_spacing := coalesce(
    case when coalesce(v_profile.metadata->>'target_spacing_inches','') ~ '^\d+(\.\d+)?$' then (v_profile.metadata->>'target_spacing_inches')::numeric end,
    v_profile.in_row_spacing_in,
    p_target_spacing_inches
  );
  if v_target_spacing is not null and (v_target_spacing <= 0 or v_target_spacing > 120) then
    raise exception 'Target spacing is outside the supported range.' using errcode = '22023';
  end if;

  v_source_sown_date := coalesce(
    case when coalesce(v_task.metadata->>'source_sown_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (v_task.metadata->>'source_sown_date')::date end,
    case when coalesce(v_task.metadata->>'trigger_anchor_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (v_task.metadata->>'trigger_anchor_date')::date end,
    v_today
  );
  v_outcome_label := case p_spacing_outcome
    when 'thin' then 'dense stand; thinning required'
    when 'patch' then 'sparse stand; patch seeding required'
    else 'stand on target; no action required'
  end;
  v_summary := v_crop_display_name || ' germinated in ' || v_object_label || ' · ' || v_outcome_label
    || case when v_target_spacing is not null then ' · ' || trim(to_char(v_target_spacing,'FM999990.##')) || '-inch target' else '' end;
  v_result_metadata := jsonb_build_object(
    'target_spacing_inches', v_target_spacing,
    'spacing_outcome', p_spacing_outcome,
    'spacing_action_required', case when p_spacing_outcome='on_target' then null else p_spacing_outcome end,
    'spacing_measurement_kind', 'crop_target_band'
  );

  v_transition_result := atlas.record_task_transition_v1_internal(
    v_task.id,
    'done',
    left('germination:done:' || v_task.id::text, 160),
    null,
    v_summary,
    null,
    'maintain',
    'germination_check',
    v_result_metadata || jsonb_build_object(
      'object_id', v_object_id,
      'crop_profile_id', v_profile.id,
      'crop_cycle_id', v_crop_cycle_id,
      'actor_membership_id', v_membership_id,
      'actor_role', v_role
    ),
    null
  );

  if not coalesce((v_transition_result->>'deduplicated')::boolean,false) then
    update atlas.tasks
    set metadata = coalesce(metadata,'{}'::jsonb) || v_result_metadata || jsonb_strip_nulls(jsonb_build_object(
          'crop_cycle_id', v_crop_cycle_id,
          'crop_variety', v_canonical_variety,
          'germination_logged_at', v_now,
          'germination_logged_by_membership_id', v_membership_id
        )),
        updated_at = v_now
    where id = v_task.id;

    if v_object_id is not null then
      if v_crop_cycle_id is not null then
        update atlas.crop_cycles
        set germination_checked_date = v_today,
            cycle_state = 'germinated',
            metadata = coalesce(metadata,'{}'::jsonb) || v_result_metadata,
            updated_at = v_now
        where id = v_crop_cycle_id;
      end if;
      update atlas.object_state
      set last_checked_at = v_today,
          metadata = coalesce(metadata,'{}'::jsonb) || v_result_metadata || jsonb_build_object('germination_status','germinated','germination_logged_at',v_now),
          updated_at = v_now
      where farm_id = p_farm_id and object_id = v_object_id;
    end if;
  end if;

  v_assigned_membership_id := coalesce(v_task.assigned_membership_id, case when v_role='farm_hand' then v_membership_id else null end);
  v_visibility_scope := case when v_assigned_membership_id is not null then 'assigned_worker' else v_task.visibility_scope end;
  select fm.worker_key into v_worker_key from atlas.farm_memberships fm where fm.id = v_assigned_membership_id;

  v_harvest_due := greatest(v_source_sown_date + coalesce(v_profile.days_to_harvest_watch_min,0), v_today);
  insert into atlas.tasks(
    farm_id,zone_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,
    note,metadata,action_key,work_class,engine_instance_key,visibility_scope,assigned_membership_id
  ) values (
    p_farm_id,v_task.zone_id,'Start harvest watch — '||v_crop_display_name||' — '||v_object_label,
    'harvest_watch','open',coalesce(v_task.priority,'normal'),v_harvest_due,'germination_harvest_watch',v_task.id,null,
    jsonb_strip_nulls(jsonb_build_object(
      'task_key','germination_harvest_watch_'||v_task.id::text,
      'task_style','harvest_watch','crop_profile_id',v_profile.id,'crop_profile_stable_key',v_profile.stable_key,
      'crop',coalesce(v_canonical_crop_label,v_profile.crop_label),'variety',v_canonical_variety,'crop_variety',v_canonical_variety,
      'crop_cycle_id',v_crop_cycle_id,'varieties',coalesce(v_task.metadata->'varieties','[]'::jsonb),
      'display_action','Check','display_subject',v_crop_display_name||' harvest readiness',
      'display_detail',v_object_label,'collection_zone',v_object_label,
      'assigned_to',v_worker_key,'source_germination_task_id',v_task.id,
      'source_sowing_task_id',nullif(v_task.metadata->>'source_sowing_task_id',''),'source_sown_date',v_source_sown_date
    )),
    'harvest','standard','germination_harvest_watch:'||v_task.id::text,v_visibility_scope,v_assigned_membership_id
  ) on conflict do nothing;
  select id into v_harvest_task_id from atlas.tasks
  where farm_id = p_farm_id and engine_instance_key = 'germination_harvest_watch:'||v_task.id::text and status in ('open','blocked') limit 1;
  if v_harvest_task_id is not null and v_object_id is not null then
    insert into atlas.task_objects(task_id,object_id,role) values(v_harvest_task_id,v_object_id,'primary_location') on conflict do nothing;
  end if;
  if v_harvest_task_id is not null and v_crop_cycle_id is not null then
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
    values(v_harvest_task_id,v_crop_cycle_id,'observes','confirmed','germination_generated_task',jsonb_build_object('source_germination_task_id',v_task.id))
    on conflict (task_id,crop_cycle_id,role) do nothing;
  end if;

  if p_spacing_outcome <> 'on_target' then
    insert into atlas.tasks(
      farm_id,zone_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,
      note,metadata,action_key,work_class,engine_instance_key,visibility_scope,assigned_membership_id
    ) values (
      p_farm_id,v_task.zone_id,
      case when p_spacing_outcome='thin' then 'Thin '||v_crop_display_name||' seedlings — '||v_object_label else 'Patch '||v_crop_display_name||' seed — '||v_object_label end,
      case when p_spacing_outcome='thin' then 'thinning' else 'sowing' end,
      'open','high',v_today,
      case when p_spacing_outcome='thin' then 'germination_thinning' else 'germination_patch' end,
      v_task.id,null,
      jsonb_strip_nulls(jsonb_build_object(
        'task_key',(case when p_spacing_outcome='thin' then 'germination_thinning_' else 'germination_patch_' end)||v_task.id::text,
        'task_style',case when p_spacing_outcome='thin' then 'thinning' else 'sowing' end,
        'display_action',case when p_spacing_outcome='thin' then 'Thin' else 'Patch seed' end,
        'display_subject',v_crop_display_name||' stand','display_detail',v_object_label,'collection_zone',v_object_label,
        'assigned_to',v_worker_key,'crop_profile_id',v_profile.id,'crop_profile_stable_key',v_profile.stable_key,
        'crop',coalesce(v_canonical_crop_label,v_profile.crop_label),'variety',v_canonical_variety,'crop_variety',v_canonical_variety,
        'crop_cycle_id',v_crop_cycle_id,'varieties',coalesce(v_task.metadata->'varieties','[]'::jsonb),
        'target_spacing_inches',v_target_spacing,'source_germination_task_id',v_task.id,
        'source_sowing_task_id',nullif(v_task.metadata->>'source_sowing_task_id','')
      )),
      case when p_spacing_outcome='thin' then 'thin' else 'sow' end,'standard',
      (case when p_spacing_outcome='thin' then 'germination_thinning:' else 'germination_patch:' end)||v_task.id::text,
      v_visibility_scope,v_assigned_membership_id
    ) on conflict do nothing;
    select id into v_action_task_id from atlas.tasks
    where farm_id = p_farm_id
      and engine_instance_key = (case when p_spacing_outcome='thin' then 'germination_thinning:' else 'germination_patch:' end)||v_task.id::text
      and status in ('open','blocked') limit 1;
    if v_action_task_id is not null and v_object_id is not null then
      insert into atlas.task_objects(task_id,object_id,role) values(v_action_task_id,v_object_id,'primary_location') on conflict do nothing;
    end if;
    if v_action_task_id is not null and v_crop_cycle_id is not null then
      insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
      values(v_action_task_id,v_crop_cycle_id,'affects','confirmed','germination_generated_task',jsonb_build_object('source_germination_task_id',v_task.id))
      on conflict (task_id,crop_cycle_id,role) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'action','germinated','taskId',v_task.id,'spacingOutcome',p_spacing_outcome,
    'targetSpacingInches',v_target_spacing,'actionTaskId',v_action_task_id,
    'harvestTaskId',v_harvest_task_id,'cropCycleId',v_crop_cycle_id,
    'deduplicated',coalesce((v_transition_result->>'deduplicated')::boolean,false)
  );
end;
$function$;

with canonical_generated as (
  select distinct on (generated.id)
    generated.id as task_id,
    generated.generated_from,
    source.id as source_task_id,
    cc.id as crop_cycle_id,
    coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,'')) as crop_label,
    coalesce(nullif(cc.variety,''), nullif(oc.variety,'')) as variety,
    cc.object_id,
    go.stable_key as object_key,
    go.label as object_label,
    source.metadata->'varieties' as varieties
  from atlas.tasks generated
  join atlas.tasks source on source.id = generated.generated_from_id
  join atlas.task_crop_cycles source_link on source_link.task_id = source.id
  join atlas.crop_cycles cc on cc.id = source_link.crop_cycle_id
  left join atlas.object_contents oc on oc.id = cc.object_content_id
  left join atlas.growing_objects go on go.id = cc.object_id
  where generated.generated_from in ('germination_patch','germination_thinning','germination_harvest_watch')
  order by generated.id,
    case source_link.role when 'creates' then 0 when 'affects' then 1 when 'observes' then 2 else 3 end,
    case source_link.confidence when 'confirmed' then 0 else 1 end,
    source_link.created_at
)
insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
select
  task_id,
  crop_cycle_id,
  case when generated_from = 'germination_harvest_watch' then 'observes' else 'affects' end,
  'confirmed',
  'germination_generated_task_backfill',
  jsonb_build_object('source_germination_task_id',source_task_id)
from canonical_generated
on conflict (task_id,crop_cycle_id,role) do nothing;

with canonical_generated as (
  select distinct on (generated.id)
    generated.id as task_id,
    generated.generated_from,
    cc.id as crop_cycle_id,
    coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,'')) as crop_label,
    coalesce(nullif(cc.variety,''), nullif(oc.variety,'')) as variety,
    cc.object_id,
    go.stable_key as object_key,
    go.label as object_label,
    source.metadata->'varieties' as varieties,
    case
      when lower(coalesce(nullif(cc.variety,''), nullif(oc.variety,''), cc.crop_label, oc.content_label))
           like '%' || lower(coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,''), '')) || '%'
        then coalesce(nullif(cc.variety,''), nullif(oc.variety,''), cc.crop_label, oc.content_label)
      when coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,''), '') <> ''
        then coalesce(nullif(cc.variety,''), nullif(oc.variety,''), cc.crop_label, oc.content_label)
          || ' ' || lower(coalesce(nullif(cc.crop_label,''), nullif(oc.content_label,'')))
      else coalesce(nullif(cc.variety,''), nullif(oc.variety,''), cc.crop_label, oc.content_label)
    end as display_crop
  from atlas.tasks generated
  join atlas.tasks source on source.id = generated.generated_from_id
  join atlas.task_crop_cycles source_link on source_link.task_id = source.id
  join atlas.crop_cycles cc on cc.id = source_link.crop_cycle_id
  left join atlas.object_contents oc on oc.id = cc.object_content_id
  left join atlas.growing_objects go on go.id = cc.object_id
  where generated.generated_from in ('germination_patch','germination_thinning','germination_harvest_watch')
  order by generated.id,
    case source_link.role when 'creates' then 0 when 'affects' then 1 when 'observes' then 2 else 3 end,
    case source_link.confidence when 'confirmed' then 0 else 1 end,
    source_link.created_at
)
update atlas.tasks t
set title = case cg.generated_from
      when 'germination_patch' then 'Patch ' || cg.display_crop || ' seed — ' || coalesce(cg.object_label,'Elm Farm')
      when 'germination_thinning' then 'Thin ' || cg.display_crop || ' seedlings — ' || coalesce(cg.object_label,'Elm Farm')
      else 'Open harvest window — ' || cg.display_crop || ' — ' || coalesce(cg.object_label,'Elm Farm')
    end,
    metadata = coalesce(t.metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'crop_cycle_id',cg.crop_cycle_id,
      'crop',cg.crop_label,
      'variety',cg.variety,
      'crop_variety',cg.variety,
      'varieties',coalesce(cg.varieties,'[]'::jsonb),
      'object_id',cg.object_id,
      'object_key',cg.object_key,
      'object_label',cg.object_label,
      'display_detail',cg.object_label,
      'collection_zone',cg.object_label,
      'display_subject',case when cg.generated_from='germination_harvest_watch' then cg.display_crop||' harvest window' else cg.display_crop||' stand' end
    )),
    updated_at = now()
from canonical_generated cg
where t.id = cg.task_id;

do $validation$
begin
  if exists (
    select 1
    from atlas.tasks generated
    join atlas.tasks source on source.id = generated.generated_from_id
    join atlas.task_crop_cycles source_link on source_link.task_id = source.id
    where generated.generated_from in ('germination_patch','germination_thinning','germination_harvest_watch')
      and not exists (
        select 1
        from atlas.task_crop_cycles generated_link
        where generated_link.task_id = generated.id
          and generated_link.crop_cycle_id = source_link.crop_cycle_id
      )
  ) then
    raise exception 'Generated germination tasks remain disconnected from their source crop cycle.';
  end if;

  if exists (
    select 1
    from atlas.tasks generated
    join atlas.task_crop_cycles generated_link on generated_link.task_id = generated.id
    join atlas.crop_cycles cc on cc.id = generated_link.crop_cycle_id
    where generated.generated_from in ('germination_patch','germination_thinning','germination_harvest_watch')
      and nullif(cc.variety,'') is not null
      and generated.metadata->>'variety' is distinct from cc.variety
  ) then
    raise exception 'Generated germination task variety metadata does not match its canonical crop cycle.';
  end if;
end;
$validation$;
