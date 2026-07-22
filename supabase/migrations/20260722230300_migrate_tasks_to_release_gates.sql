-- Backfill current execution work, move unreleased work out of atlas.tasks,
-- replace the weeding refresher, and activate the universal enforcement layer.

create or replace function atlas.task_has_authoritative_history_v1(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $fn$
select
  exists(select 1 from atlas.task_outcome_events x where x.task_id=p_task_id)
  or exists(select 1 from atlas.task_transitions x where x.task_id=p_task_id)
  or exists(select 1 from atlas.maintenance_history x where x.source_task_id=p_task_id)
  or exists(select 1 from atlas.production_tray_batches x where x.source_task_id=p_task_id)
  or exists(select 1 from atlas.seed_allocation_consumptions x where x.source_task_id=p_task_id)
  or exists(select 1 from atlas.production_stage_observations x where x.task_id=p_task_id)
  or exists(select 1 from atlas.production_transplant_placements x where x.source_task_id=p_task_id)
  or exists(select 1 from atlas.production_readiness_observations x where x.task_id=p_task_id)
  or exists(select 1 from atlas.production_field_observations x where x.task_id=p_task_id)
  or exists(select 1 from atlas.production_harvest_lots x where x.source_task_id=p_task_id)
  or exists(select 1 from atlas.production_lot_events x where x.task_id=p_task_id)
  or exists(select 1 from atlas.postharvest_container_events x where x.task_id=p_task_id);
$fn$;

create or replace function atlas.backfill_active_task_release_gates_v1()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  t atlas.tasks%rowtype;
  v_policy record;
  v_occurrence_id uuid;
  v_count integer := 0;
begin
  for t in
    select *
    from atlas.tasks
    where status in ('open','blocked')
    order by created_at,id
    for update
  loop
    select * into v_policy
    from atlas.ensure_auto_release_policy_v1(
      t.farm_id,t.generated_from,t.task_type,t.task_series_key,
      t.action_key,t.status,coalesce(t.metadata,'{}'::jsonb)
    );

    insert into atlas.planned_work_occurrences(
      farm_id,work_definition_id,release_policy_id,occurrence_key,
      source_kind,source_id,title,planned_due_date,not_before_date,state,
      gate_satisfied_at,released_at,released_task_id,task_payload,
      relation_payload,metadata
    )
    values(
      t.farm_id,v_policy.work_definition_id,v_policy.release_policy_id,
      'legacy-task:'||t.id::text,t.generated_from,t.generated_from_id,t.title,
      t.due_date,
      case when t.due_date is null
        then null else t.due_date-v_policy.horizon_days end,
      'released',now(),coalesce(t.created_at,now()),t.id,
      to_jsonb(t)-'id'-'created_at'-'updated_at'
        -'planned_occurrence_id'-'release_policy_id'-'released_at'-'release_reason',
      atlas.capture_task_relation_payload_v1(t.id),
      jsonb_build_object(
        'backfilled_from_task_id',t.id,
        'backfilled_at',now()
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
      state='released',
      released_at=coalesce(
        atlas.planned_work_occurrences.released_at,excluded.released_at
      ),
      released_task_id=t.id,
      task_payload=excluded.task_payload,
      relation_payload=excluded.relation_payload,
      metadata=atlas.planned_work_occurrences.metadata||excluded.metadata,
      updated_at=now()
    returning id into v_occurrence_id;

    update atlas.tasks
    set
      planned_occurrence_id=v_occurrence_id,
      release_policy_id=v_policy.release_policy_id,
      released_at=coalesce(released_at,created_at,now()),
      release_reason=coalesce(release_reason,'legacy_active_backfill'),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'release_gate_installed',true,
        'planned_occurrence_id',v_occurrence_id,
        'release_policy_id',v_policy.release_policy_id,
        'release_reason','legacy_active_backfill'
      ),
      updated_at=now()
    where id=t.id;

    insert into atlas.task_release_events(
      farm_id,occurrence_id,release_policy_id,task_id,
      release_reason,released_at,metadata
    )
    values(
      t.farm_id,v_occurrence_id,v_policy.release_policy_id,t.id,
      'legacy_active_backfill',coalesce(t.created_at,now()),
      jsonb_build_object('backfilled',true)
    )
    on conflict(occurrence_id,task_id) do nothing;

    v_count := v_count+1;
  end loop;

  update atlas.planned_work_occurrences child
  set parent_occurrence_id=parent_task.planned_occurrence_id,
      updated_at=now()
  from atlas.tasks child_task
  join atlas.tasks parent_task on parent_task.id=child_task.parent_task_id
  where child.released_task_id=child_task.id
    and child.parent_occurrence_id
      is distinct from parent_task.planned_occurrence_id;

  update atlas.workflow_handoffs h
  set target_occurrence_id=target_task.planned_occurrence_id,
      updated_at=now()
  from atlas.tasks target_task
  where h.target_task_id=target_task.id
    and target_task.planned_occurrence_id is not null;

  update atlas.workflow_handoffs h
  set source_occurrence_id=source_task.planned_occurrence_id,
      updated_at=now()
  from atlas.tasks source_task
  where h.source_kind='task'
    and h.source_id=source_task.id
    and source_task.planned_occurrence_id is not null;

  update atlas.task_release_queue_items q
  set planned_occurrence_id=linked_task.planned_occurrence_id,
      updated_at=now()
  from atlas.tasks linked_task
  where q.task_id=linked_task.id
    and linked_task.planned_occurrence_id is not null;

  return v_count;
end;
$fn$;

create or replace function atlas.defer_existing_task_to_occurrence_v1(
  p_task_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  t atlas.tasks%rowtype;
  o atlas.planned_work_occurrences%rowtype;
  p atlas.work_release_policies%rowtype;
  v_history boolean;
  v_relation jsonb;
begin
  select * into t
  from atlas.tasks
  where id=p_task_id
  for update;

  if t.id is null or t.status not in ('open','blocked') then
    return 'skipped';
  end if;

  select * into o
  from atlas.planned_work_occurrences
  where id=t.planned_occurrence_id
  for update;
  select * into p
  from atlas.work_release_policies
  where id=t.release_policy_id;

  if o.id is null or p.id is null then
    raise exception 'Task % is missing its release gate.',p_task_id
      using errcode='23514';
  end if;

  v_relation := atlas.capture_task_relation_payload_v1(t.id);
  v_history := atlas.task_has_authoritative_history_v1(t.id);

  update atlas.planned_work_occurrences
  set
    state='planned',
    gate_satisfied_at=null,
    released_at=null,
    released_task_id=null,
    not_before_date=case when t.due_date is null
      then not_before_date else t.due_date-p.horizon_days end,
    task_payload=(
      to_jsonb(t)-'id'-'created_at'-'updated_at'
        -'planned_occurrence_id'-'release_policy_id'-'released_at'-'release_reason'
    ) || jsonb_build_object('status','open','blocker_text',null),
    relation_payload=case when v_relation='{}'::jsonb
      then relation_payload else v_relation end,
    metadata=metadata||jsonb_build_object(
      'migrated_out_of_task_table',true,
      'migration_reason',p_reason,
      'migrated_from_task_id',t.id,
      'migrated_at',now()
    ),
    updated_at=now()
  where id=o.id;

  update atlas.workflow_handoffs h
  set
    target_occurrence_id=case
      when h.target_task_id=t.id then o.id else h.target_occurrence_id end,
    target_task_id=case
      when h.target_task_id=t.id then null else h.target_task_id end,
    source_occurrence_id=case
      when h.source_kind='task' and h.source_id=t.id
        then o.id else h.source_occurrence_id end,
    updated_at=now()
  where h.target_task_id=t.id
     or (h.source_kind='task' and h.source_id=t.id);

  update atlas.task_release_queue_items
  set
    planned_occurrence_id=o.id,
    task_id=null,
    state=case when state='active' then 'queued' else state end,
    activated_at=null,
    updated_at=now(),
    metadata=metadata||jsonb_build_object(
      'migrated_to_occurrence',true,
      'migrated_at',now()
    )
  where task_id=t.id;

  if v_history then
    update atlas.tasks
    set
      status='archived',
      due_date=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'archived_reason','Replaced by gated planned occurrence',
        'planned_occurrence_id',o.id,
        'migration_reason',p_reason,
        'archived_at',now()
      ),
      updated_at=now()
    where id=t.id;
    return 'archived_history';
  end if;

  delete from atlas.tasks where id=t.id;
  return 'deleted_redundant';
end;
$fn$;

create or replace function atlas.refresh_weeding_collection_occurrences_v1(
  p_farm_key text,
  p_start_date date default current_date,
  p_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_farm_id uuid;
  v_count integer := 0;
  v_occurrence_id uuid;
  v_definition_key text;
  v_policy_key text;
  v_gate_type text;
  v_max_active integer;
  v_zone_key text;
  v_zone_id uuid;
  v_is_light boolean;
  v_last_weeded date;
  v_last_weeded_source text;
  r record;
begin
  if p_days<1 or p_days>62 then
    raise exception 'Weeding planning window must be between 1 and 62 days.'
      using errcode='22023';
  end if;

  select id into v_farm_id
  from atlas.farms
  where stable_key=p_farm_key;
  if v_farm_id is null then
    raise exception 'Farm % was not found.',p_farm_key using errcode='P0002';
  end if;

  create temporary table if not exists
    pg_temp.atlas_weeding_refresh_occurrences(
      occurrence_id uuid primary key
    ) on commit drop;
  truncate pg_temp.atlas_weeding_refresh_occurrences;

  for r in
    select *
    from atlas.preview_intelligent_weeding_schedule(
      p_farm_key,p_start_date,p_days
    )
  loop
    select
      mo.zone_id,
      z.stable_key,
      coalesce(
        os.last_weeded_at,
        mo.last_completed_at::date,
        nullif(mo.metadata->>'last_weeded_at','')::date
      ),
      coalesce(
        os.metadata->>'last_weeded_source',
        mo.metadata->>'last_weeded_source'
      )
    into v_zone_id,v_zone_key,v_last_weeded,v_last_weeded_source
    from atlas.maintenance_objects mo
    left join atlas.zones z on z.id=mo.zone_id
    left join atlas.object_state os on os.object_id=mo.object_id
    where mo.id=r.maintenance_object_id;

    v_is_light := r.condition='light';
    v_definition_key := 'maintenance:weeding:'||coalesce(v_zone_key,'farm');
    v_policy_key := v_definition_key ||
      case when v_zone_key='field_rows' then ':serial' else ':window' end;
    v_gate_type := case when v_zone_key='field_rows'
      then 'serial_queue' else 'time_window' end;
    v_max_active := case when v_zone_key='field_rows' then 2 else 4 end;

    v_occurrence_id := atlas.plan_work_occurrence_v1(
      v_farm_id,
      v_definition_key,
      v_policy_key,
      'weeding:'||r.maintenance_object_id::text||':'||r.schedule_date::text,
      'Weed '||r.object_label,
      'maintenance',
      r.schedule_date,
      'maintenance_weeding_collection',
      r.maintenance_object_id,
      v_gate_type,
      14,
      v_max_active,
      jsonb_build_object(
        'farm_id',v_farm_id,
        'zone_id',v_zone_id,
        'title','Weed '||r.object_label,
        'task_type','maintenance',
        'status','open',
        'priority',case when r.must_precede_task then 'high' else 'normal' end,
        'due_date',r.schedule_date,
        'unlock_text',case
          when cardinality(r.dependent_task_labels)>0
            then 'Prepares for '||array_to_string(r.dependent_task_labels,' · ')
          else null
        end,
        'generated_from','maintenance_weeding_collection',
        'generated_from_id',r.maintenance_object_id,
        'metadata',jsonb_strip_nulls(jsonb_build_object(
          'work_collection_key','weeding',
          'collection_member_key',r.maintenance_object_id::text,
          'maintenance_object_id',r.maintenance_object_id,
          'maintenance_type','weed',
          'work_route','weed',
          'work_rhythm','Weeding',
          'display_action','Weed',
          'display_subject',r.object_label,
          'display_title','Weed '||r.object_label,
          'display_detail',case
            when v_is_light then 'Maintenance hoe · protect this bed'
            when r.must_precede_task
              then r.estimated_minutes::text||' min · ready before planting'
            else r.estimated_minutes::text||' min · win back this bed'
          end,
          'collection_zone',coalesce(r.zone_label,'Elm Farm'),
          'collection_label',r.object_label,
          'estimated_minutes',r.estimated_minutes,
          'condition',r.condition,
          'effort_band',case when v_is_light then 'light' else 'heavy' end,
          'window_key',r.window_key,
          'day_order',case when v_is_light then 2200 else 1200 end,
          'day_work_order',case when v_is_light then 2200 else 1200 end,
          'run_sheet_order',case when v_is_light then 2200 else 1200 end,
          'priority_reasons',to_jsonb(r.priority_reasons),
          'dependent_task_labels',to_jsonb(r.dependent_task_labels),
          'dependent_task_ids',to_jsonb(r.dependent_task_ids),
          'light_maintenance_pass',v_is_light,
          'daily_weeding_lane',case when v_is_light
            then 'protect' else 'recover' end,
          'bed_ready_by_date',case when r.must_precede_task
            then r.schedule_date else null end,
          'last_weeded_at',v_last_weeded,
          'last_weeded_source',v_last_weeded_source,
          'dynamic_priority_score',r.effective_priority_score,
          'canonical_maintenance_delivery',true
        )),
        'visibility_scope','assigned_worker'
      ),
      jsonb_build_object(
        'task_objects',jsonb_build_array(
          jsonb_build_object('object_id',r.object_id,'role','target')
        )
      ),
      jsonb_build_object(
        'maintenance_object_id',r.maintenance_object_id,
        'zone_key',v_zone_key
      ),
      r.schedule_date-14,
      jsonb_build_object(
        'planned_by','refresh_weeding_collection_occurrences_v1',
        'condition',r.condition
      )
    );

    insert into pg_temp.atlas_weeding_refresh_occurrences(occurrence_id)
    values(v_occurrence_id)
    on conflict do nothing;
    v_count := v_count+1;
  end loop;

  update atlas.planned_work_occurrences o
  set
    state='cancelled',
    updated_at=now(),
    metadata=metadata||jsonb_build_object(
      'cancelled_by_refresh',true,
      'cancelled_at',now()
    )
  where o.farm_id=v_farm_id
    and o.source_kind='maintenance_weeding_collection'
    and o.state in ('planned','eligible','failed')
    and o.planned_due_date between p_start_date and p_start_date+p_days-1
    and not exists(
      select 1
      from pg_temp.atlas_weeding_refresh_occurrences k
      where k.occurrence_id=o.id
    );

  perform atlas.release_eligible_work_v1(v_farm_id,p_start_date,null);
  return v_count;
end;
$fn$;

create or replace function atlas.refresh_weeding_collection_tasks(
  p_start_date date default current_date,
  p_days integer default 14
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
begin
  return atlas.refresh_weeding_collection_occurrences_v1(
    'elm_farm',p_start_date,least(p_days,62)
  );
end;
$fn$;

-- Give every currently active row a policy and occurrence before enforcement.
select atlas.backfill_active_task_release_gates_v1();

-- Preserve the existing Field Row completion-gated behavior as one shared
-- serial policy with at most two released rows.
do $do$
declare
  v_farm_id uuid;
  v_definition_id uuid;
  v_policy_id uuid;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key='elm_farm';
  if v_farm_id is null then return; end if;

  insert into atlas.work_definitions(
    farm_id,stable_key,title_template,task_type,source_kind,
    action_key,work_class,default_priority,default_visibility_scope,metadata
  )
  values(
    v_farm_id,'maintenance:weeding:field_rows','Weed Field Row',
    'maintenance','maintenance_weeding_collection','weed','maintenance',
    'normal','assigned_worker',
    jsonb_build_object('canonical',true,'scope','field_rows')
  )
  on conflict(farm_id,stable_key)
  do update set updated_at=now(),active=true
  returning id into v_definition_id;

  insert into atlas.work_release_policies(
    farm_id,work_definition_id,stable_key,gate_type,horizon_days,
    maximum_active_instances,gate_config,metadata
  )
  values(
    v_farm_id,v_definition_id,'maintenance:weeding:field_rows:serial',
    'serial_queue',14,2,
    jsonb_build_object('completion_gated',true),
    jsonb_build_object('canonical',true)
  )
  on conflict(farm_id,stable_key)
  do update set
    work_definition_id=excluded.work_definition_id,
    gate_type='serial_queue',
    horizon_days=14,
    maximum_active_instances=2,
    active=true,
    updated_at=now()
  returning id into v_policy_id;

  update atlas.planned_work_occurrences o
  set work_definition_id=v_definition_id,
      release_policy_id=v_policy_id,
      updated_at=now()
  from atlas.tasks task_row
  join atlas.zones z on z.id=task_row.zone_id
  where o.id=task_row.planned_occurrence_id
    and task_row.farm_id=v_farm_id
    and task_row.status in ('open','blocked')
    and task_row.generated_from='maintenance_weeding_collection'
    and z.stable_key='field_rows';

  update atlas.tasks task_row
  set
    release_policy_id=v_policy_id,
    metadata=task_row.metadata||jsonb_build_object(
      'release_policy','completion_gated_serial',
      'release_policy_id',v_policy_id
    ),
    updated_at=now()
  from atlas.zones z
  where z.id=task_row.zone_id
    and task_row.farm_id=v_farm_id
    and task_row.status in ('open','blocked')
    and task_row.generated_from='maintenance_weeding_collection'
    and z.stable_key='field_rows';
end;
$do$;

-- Blocked generated rows and rows outside their own release horizons are plans,
-- not tasks.
do $do$
declare r record;
begin
  for r in
    select
      task_row.id,
      case
        when task_row.generated_from is not null
         and task_row.status='blocked'
          then 'generated_gate_not_satisfied'
        else 'outside_release_horizon'
      end as reason
    from atlas.tasks task_row
    join atlas.work_release_policies p on p.id=task_row.release_policy_id
    join atlas.farm_task_release_settings s on s.farm_id=task_row.farm_id
    where task_row.status in ('open','blocked')
      and (
        (task_row.generated_from is not null and task_row.status='blocked')
        or (
          task_row.due_date is not null
          and task_row.due_date>
            ((now() at time zone s.timezone_name)::date +
             least(p.horizon_days,s.maximum_task_horizon_days))
        )
      )
    order by task_row.due_date nulls last,task_row.created_at,task_row.id
  loop
    perform atlas.defer_existing_task_to_occurrence_v1(r.id,r.reason);
  end loop;
end;
$do$;

-- Normalize every farm to its configured active top-level ceiling. Keep the
-- nearest and highest-priority work released; move the farthest normal work
-- back into occurrences without deleting its plan or relationships.
do $do$
declare
  f record;
  r record;
  v_active integer;
  v_excess integer;
begin
  for f in
    select s.*
    from atlas.farm_task_release_settings s
    where s.active
  loop
    select count(*)::integer into v_active
    from atlas.tasks t
    where t.farm_id=f.farm_id
      and t.status in ('open','blocked')
      and t.parent_task_id is null;

    v_excess := greatest(0,v_active-f.maximum_active_top_level_tasks);
    if v_excess=0 then continue; end if;

    for r in
      select t.id
      from atlas.tasks t
      where t.farm_id=f.farm_id
        and t.status in ('open','blocked')
        and t.parent_task_id is null
        and not exists(
          select 1 from atlas.tasks child
          where child.parent_task_id=t.id
            and child.status in ('open','blocked')
        )
        and not exists(
          select 1 from atlas.task_release_queue_items q
          where q.task_id=t.id and q.state='active'
        )
      order by
        case t.priority
          when 'low' then 0
          when 'normal' then 1
          when 'high' then 2
          when 'urgent' then 3
          else 1
        end,
        t.due_date desc nulls first,
        t.created_at desc
      limit v_excess
    loop
      perform atlas.defer_existing_task_to_occurrence_v1(
        r.id,'Farm active-task ceiling normalization'
      );
    end loop;
  end loop;
end;
$do$;

-- Install enforcement only after legacy rows have been backfilled.
drop trigger if exists aa_install_task_release_gate_v1 on atlas.tasks;
drop trigger if exists zy_install_task_release_gate_v1 on atlas.tasks;
create trigger zy_install_task_release_gate_v1
before insert on atlas.tasks
for each row execute function atlas.install_task_release_gate_v1();

drop trigger if exists ab_validate_active_task_release_v1 on atlas.tasks;
drop trigger if exists zz_validate_active_task_release_v1 on atlas.tasks;
create trigger zz_validate_active_task_release_v1
before insert or update of
  status,due_date,planned_occurrence_id,release_policy_id,released_at
on atlas.tasks
for each row execute function atlas.validate_active_task_release_v1();

drop trigger if exists zz_finalize_task_release_v1 on atlas.tasks;
create trigger zz_finalize_task_release_v1
after insert on atlas.tasks
for each row execute function atlas.finalize_task_release_v1();

drop trigger if exists zz_capture_deferred_task_v1 on atlas.tasks;
create constraint trigger zz_capture_deferred_task_v1
after insert on atlas.tasks
deferrable initially deferred
for each row execute function atlas.capture_deferred_task_v1();

drop trigger if exists zz_release_after_task_terminal_v1 on atlas.tasks;
create trigger zz_release_after_task_terminal_v1
after update of status on atlas.tasks
for each row
when(old.status is distinct from new.status)
execute function atlas.release_after_task_terminal_v1();

-- Retire the old architecture that activated pre-created task rows.
drop trigger if exists trg_enqueue_new_field_row_weeding_task_v1 on atlas.tasks;
drop trigger if exists a_protect_active_release_queue_task_from_refresh_v1 on atlas.tasks;
drop trigger if exists trg_advance_task_release_queue_v1 on atlas.tasks;

create extension if not exists pg_cron;

do $do$
declare r record;
begin
  for r in
    select jobid from cron.job
    where jobname='atlas-release-eligible-work'
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  -- Time windows are measured in days. Event/state signals release immediately;
  -- this hourly sweep is only the safety net for time-window gates.
  perform cron.schedule(
    'atlas-release-eligible-work',
    '5 * * * *',
    'select atlas.release_all_farms_v1();'
  );
end;
$do$;

-- Convert the canonical weeding plan without archive-and-recreate churn.
do $do$
begin
  if exists(select 1 from atlas.farms where stable_key='elm_farm') then
    perform atlas.refresh_weeding_collection_occurrences_v1(
      'elm_farm',
      (now() at time zone 'America/Chicago')::date,
      30
    );
  end if;
end;
$do$;

select atlas.release_all_farms_v1();

revoke all on function atlas.task_has_authoritative_history_v1(uuid)
  from public,anon,authenticated;
revoke all on function atlas.backfill_active_task_release_gates_v1()
  from public,anon,authenticated;
revoke all on function atlas.defer_existing_task_to_occurrence_v1(uuid,text)
  from public,anon,authenticated;
revoke all on function atlas.refresh_weeding_collection_occurrences_v1(
  text,date,integer
) from public,anon,authenticated;
