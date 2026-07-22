-- Preserve protected active Field Row queue tasks while rebuilding the wider
-- generated Weeding collection. Reuse an existing open identity instead of
-- attempting to insert a duplicate task behind the unique identity guard.

create or replace function atlas.refresh_weeding_collection_tasks(
  p_start_date date default current_date,
  p_days integer default 14
)
returns integer
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_farm_id uuid;
  v_count integer := 0;
  v_is_light boolean;
  r record;
  v_task_id uuid;
  v_last_weeded date;
  v_last_weeded_source text;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm not found';
  end if;

  update atlas.tasks
  set status = 'archived',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_reason', 'Replaced by intelligent Weeding collection refresh',
        'archived_at', now()
      )
  where status in ('open', 'blocked')
    and generated_from = 'maintenance_weeding_collection';

  for r in
    select *
    from atlas.preview_intelligent_weeding_schedule('elm_farm', p_start_date, p_days)
  loop
    v_is_light := r.condition = 'light';
    v_task_id := null;

    select
      coalesce(
        os.last_weeded_at,
        mo.last_completed_at::date,
        nullif(mo.metadata ->> 'last_weeded_at', '')::date
      ),
      coalesce(
        os.metadata ->> 'last_weeded_source',
        mo.metadata ->> 'last_weeded_source'
      )
    into v_last_weeded, v_last_weeded_source
    from atlas.maintenance_objects mo
    left join atlas.object_state os on os.object_id = mo.object_id
    where mo.id = r.maintenance_object_id;

    select t.id
    into v_task_id
    from atlas.tasks t
    where t.farm_id = v_farm_id
      and t.generated_from = 'maintenance_weeding_collection'
      and t.generated_from_id = r.maintenance_object_id
      and atlas.identity_token(t.title) = atlas.identity_token('Weed ' || r.object_label)
      and coalesce(t.due_date, date '0001-01-01') = coalesce(r.schedule_date, date '0001-01-01')
      and t.status in ('open', 'blocked')
    order by t.created_at
    limit 1;

    if v_task_id is null then
      insert into atlas.tasks (
        farm_id,
        zone_id,
        title,
        task_type,
        status,
        priority,
        due_date,
        unlock_text,
        generated_from,
        generated_from_id,
        note,
        metadata
      )
      values (
        v_farm_id,
        (select zone_id from atlas.maintenance_objects where id = r.maintenance_object_id),
        'Weed ' || r.object_label,
        'maintenance',
        'open',
        case when r.must_precede_task then 'high' else 'normal' end,
        r.schedule_date,
        case
          when cardinality(r.dependent_task_labels) > 0
            then 'Prepares for ' || array_to_string(r.dependent_task_labels, ' · ')
          else null
        end,
        'maintenance_weeding_collection',
        r.maintenance_object_id,
        null,
        jsonb_build_object(
          'work_collection_key', 'weeding',
          'collection_member_key', r.maintenance_object_id::text,
          'maintenance_object_id', r.maintenance_object_id,
          'maintenance_type', 'weed',
          'work_route', 'weed',
          'work_rhythm', 'Weeding',
          'display_action', 'Weed',
          'display_subject', r.object_label,
          'display_title', 'Weed ' || r.object_label,
          'display_detail', case
            when v_is_light then 'Maintenance hoe · protect this bed'
            when r.must_precede_task then r.estimated_minutes::text || ' min · ready before planting'
            else r.estimated_minutes::text || ' min · win back this bed'
          end,
          'collection_zone', coalesce(r.zone_label, 'Elm Farm'),
          'collection_label', r.object_label,
          'estimated_minutes', r.estimated_minutes,
          'condition', r.condition,
          'effort_band', case when v_is_light then 'light' else 'heavy' end,
          'window_key', r.window_key,
          'day_order', case when v_is_light then 2200 else 1200 end,
          'day_work_order', case when v_is_light then 2200 else 1200 end,
          'run_sheet_order', case when v_is_light then 2200 else 1200 end,
          'priority_reasons', to_jsonb(r.priority_reasons),
          'dependent_task_labels', to_jsonb(r.dependent_task_labels),
          'dependent_task_ids', to_jsonb(r.dependent_task_ids),
          'light_maintenance_pass', v_is_light,
          'daily_weeding_lane', case when v_is_light then 'protect' else 'recover' end,
          'bed_ready_by_date', case when r.must_precede_task then r.schedule_date else null end,
          'last_weeded_at', v_last_weeded,
          'last_weeded_source', v_last_weeded_source,
          'dynamic_priority_score', r.effective_priority_score,
          'canonical_maintenance_delivery', true
        )
      )
      returning id into v_task_id;
    end if;

    insert into atlas.task_objects (task_id, object_id, role)
    values (v_task_id, r.object_id, 'target')
    on conflict (task_id, object_id) do update
    set role = excluded.role;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
