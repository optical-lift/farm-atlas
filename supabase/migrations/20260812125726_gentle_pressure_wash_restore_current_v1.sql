do $block$
declare
  v_queue_key constant text := 'anna_gentle_pressure_wash_aug_2026';
  v_occ atlas.planned_work_occurrences%rowtype;
  v_template atlas.tasks%rowtype;
  v_task_id uuid;
  v_today date := '2026-08-12'::date;
begin
  select o.* into v_occ
  from atlas.planned_work_occurrences o
  where o.task_payload->'metadata'->>'task_key'='anna_20260811_gentle_pressure_wash_detached_garage_face'
  order by o.created_at desc
  limit 1
  for update;

  if v_occ.id is null then
    raise exception 'Current detached-garage pressure-wash occurrence is missing.';
  end if;

  if exists(
    select 1
    from atlas.task_release_queue_items qi
    join atlas.tasks t on t.id=qi.task_id
    where qi.farm_id=v_occ.farm_id
      and qi.queue_key=v_queue_key
      and qi.state='active'
      and t.status in ('open','blocked')
  ) then
    return;
  end if;

  select * into v_template
  from jsonb_populate_record(null::atlas.tasks,v_occ.task_payload);

  update atlas.planned_work_occurrences
  set planned_due_date=v_today,
      not_before_date=v_today,
      state='releasing',
      gate_satisfied_at=now(),
      released_at=null,
      released_task_id=null,
      task_payload=jsonb_set(
        jsonb_set(
          coalesce(task_payload,'{}'::jsonb),
          '{metadata}',
          (coalesce(task_payload->'metadata','{}'::jsonb)-'release_deferred'-'release_duplicate'-'scheduled_to_appear_on_due_date'-'date_commitment')
            ||jsonb_build_object(
              'pressure_wash_release_mode','completion_gated_serial',
              'release_queue_key',v_queue_key,
              'release_queue_position',1,
              'release_queue_state','active',
              'release_timing','next_workday',
              'commitment_kind','persistent',
              'execution_date',v_today
            ),
          true
        ),
        '{due_date}',to_jsonb(v_today),true
      ),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'pressureWashSerialCurrentRestored',true,
        'pressureWashSerialCurrentRestoredAt',now()
      ),
      updated_at=now()
  where id=v_occ.id;

  select o.* into v_occ from atlas.planned_work_occurrences o where o.id=v_occ.id;
  select * into v_template from jsonb_populate_record(null::atlas.tasks,v_occ.task_payload);

  insert into atlas.tasks(
    farm_id,zone_id,title,task_type,status,priority,due_date,unlock_text,blocker_text,note,metadata,
    action_key,work_class,parent_task_id,task_series_key,engine_instance_key,visibility_scope,
    assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,task_scope,
    planned_occurrence_id,release_policy_id,released_at,release_reason,organization_id,
    work_lane,commitment_kind,effort_units
  ) values (
    v_occ.farm_id,
    v_template.zone_id,
    coalesce(nullif(v_template.title,''),v_occ.title),
    coalesce(nullif(v_template.task_type,''),'exterior_cleaning'),
    'open',
    coalesce(nullif(v_template.priority,''),'normal'),
    v_today,
    v_template.unlock_text,
    null,
    v_template.note,
    (coalesce(v_template.metadata,'{}'::jsonb)-'release_deferred'-'release_duplicate')||jsonb_build_object(
      'pressure_wash_release_mode','completion_gated_serial',
      'release_queue_key',v_queue_key,
      'release_queue_position',1,
      'release_queue_state','active',
      'release_timing','next_workday',
      'execution_date',v_today
    ),
    coalesce(nullif(v_template.action_key,''),'pressure_wash'),
    coalesce(nullif(v_template.work_class,''),'standard'),
    null,
    v_template.task_series_key,
    v_template.engine_instance_key,
    coalesce(nullif(v_template.visibility_scope,''),'assigned_worker'),
    v_template.assigned_membership_id,
    v_template.assigned_user_id,
    v_template.created_by_user_id,
    case when v_template.origin_kind in ('legacy','owner_assigned','contributor_created','generated') then v_template.origin_kind else 'owner_assigned' end,
    coalesce(nullif(v_template.task_scope,''),'farm_operation'),
    v_occ.id,
    v_occ.release_policy_id,
    now(),
    'process_continuation',
    v_template.organization_id,
    'process_continuation',
    'persistent',
    coalesce(v_template.effort_units,1)
  ) returning id into v_task_id;

  perform atlas.restore_task_relation_payload_v1(v_task_id,v_occ.relation_payload);
  perform atlas.attach_released_task_to_source_v1(v_occ.id,v_task_id);

  update atlas.planned_work_occurrences
  set state='released',released_task_id=v_task_id,released_at=now(),updated_at=now()
  where id=v_occ.id;

  update atlas.task_release_queue_items
  set task_id=v_task_id,
      state='active',
      activated_at=now(),
      completed_at=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'migrated_to_occurrence')||jsonb_build_object(
        'policy','completion_gated_serial',
        'release_timing','next_workday',
        'restored_current_task_id',v_task_id,
        'restored_current_at',now()
      ),
      updated_at=now()
  where farm_id=v_occ.farm_id
    and queue_key=v_queue_key
    and planned_occurrence_id=v_occ.id;

  perform atlas.sync_task_release_queue_summary_v1(v_occ.farm_id,v_queue_key);
end;
$block$;
