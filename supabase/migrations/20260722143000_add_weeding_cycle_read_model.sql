create or replace function atlas.weeding_cycle_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_result jsonb;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_membership_id := atlas.current_membership_id(p_farm_id);

  with hierarchy(rank, key, label, mode) as (
    values
      (1, 'field_rows', 'Field Rows', 'weeding'),
      (2, 'main_garden', 'Main Garden', 'weeding'),
      (3, 'berry_walk_flower_rows', 'Berry Walk', 'weeding'),
      (4, 'berry_walk_crescent_moon', 'Berry Walk Crescent Moon', 'weeding'),
      (5, 'entry_billboard', 'Entry Billboard', 'weeding'),
      (6, 'perennial_landscaping', 'Perennial beds + landscaping', 'weeding'),
      (7, 'barn_beds', 'Barn Beds', 'weeding'),
      (8, 'u_pick', 'U-Pick', 'fall_tillage'),
      (9, 'lilac_haven', 'Lilac Haven', 'weeding')
  ), visible_queue as (
    select
      qi.position,
      qi.state,
      qi.initial_batch,
      t.id as task_id,
      t.title,
      t.status as task_status,
      t.due_date,
      coalesce(
        nullif(t.metadata ->> 'display_subject', ''),
        nullif(t.metadata ->> 'collection_label', ''),
        go.label,
        t.title
      ) as label,
      coalesce(nullif(t.metadata ->> 'condition', ''), 'moderate') as condition,
      case
        when coalesce(t.metadata ->> 'estimated_minutes', '') ~ '^[0-9]+$'
          then (t.metadata ->> 'estimated_minutes')::integer
        else null
      end as estimated_minutes,
      go.stable_key as object_key
    from atlas.task_release_queue_items qi
    join atlas.tasks t on t.id = qi.task_id
    left join atlas.maintenance_objects mo on mo.id = qi.maintenance_object_id
    left join atlas.growing_objects go on go.id = mo.object_id
    where qi.farm_id = p_farm_id
      and qi.queue_key = 'field_rows_weeding_rotation'
      and (
        (v_role = 'owner' and t.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared'))
        or (v_role = 'manager' and t.visibility_scope in ('management', 'assigned_worker', 'farm_shared'))
        or (
          v_role = 'farm_hand'
          and (
            (t.visibility_scope = 'assigned_worker' and t.assigned_membership_id = v_membership_id)
            or t.visibility_scope = 'farm_shared'
          )
        )
      )
  ), stats as (
    select
      coalesce(nullif(mo.metadata ->> 'owner_hierarchy_rank', '')::integer, 99) as rank,
      count(*)::integer as total_objects,
      count(*) filter (where mo.active)::integer as active_objects,
      count(*) filter (
        where mo.active
          and mo.condition in ('heavy', 'reset', 'moderate')
          and coalesce(mo.remaining_effort_minutes, 0) > 0
      )::integer as needs_attention,
      count(*) filter (where mo.active and mo.condition = 'maintained')::integer as maintained,
      count(*) filter (where not mo.active)::integer as inactive
    from atlas.maintenance_objects mo
    where mo.farm_id = p_farm_id
      and mo.maintenance_type = 'weed'
    group by 1
  ), queue_counts as (
    select
      count(*) filter (where state = 'active')::integer as active_count,
      count(*) filter (where state = 'queued')::integer as queued_count,
      count(*) filter (where state = 'completed')::integer as completed_count
    from visible_queue
  ), resolved as (
    select
      case
        when qc.active_count + qc.queued_count > 0 then 1
        else coalesce((
          select min(h.rank)
          from hierarchy h
          left join stats s on s.rank = h.rank
          where h.mode = 'weeding'
            and coalesce(s.needs_attention, 0) > 0
        ), 1)
      end as current_rank,
      qc.active_count,
      qc.queued_count,
      qc.completed_count
    from queue_counts qc
  ), next_rank as (
    select min(h.rank) as rank
    from hierarchy h
    left join stats s on s.rank = h.rank
    cross join resolved r
    where h.rank > r.current_rank
      and h.mode = 'weeding'
      and coalesce(s.needs_attention, 0) > 0
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'current_rank', r.current_rank,
      'current_zone_label', (select label from hierarchy where rank = r.current_rank),
      'next_rank', nr.rank,
      'next_zone_label', (select label from hierarchy where rank = nr.rank),
      'active_count', r.active_count,
      'queued_count', r.queued_count,
      'completed_count', r.completed_count,
      'queue_next_label', (
        select label
        from visible_queue
        where state = 'queued'
        order by position
        limit 1
      )
    ),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', q.position,
        'state', q.state,
        'initial_batch', q.initial_batch,
        'task_id', q.task_id,
        'title', q.title,
        'task_status', q.task_status,
        'due_date', q.due_date,
        'label', q.label,
        'condition', q.condition,
        'estimated_minutes', q.estimated_minutes,
        'object_key', q.object_key
      ) order by q.position)
      from visible_queue q
    ), '[]'::jsonb),
    'hierarchy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', h.rank,
        'key', h.key,
        'label', h.label,
        'mode', h.mode,
        'total_objects', coalesce(s.total_objects, 0),
        'active_objects', coalesce(s.active_objects, 0),
        'needs_attention', coalesce(s.needs_attention, 0),
        'maintained', coalesce(s.maintained, 0),
        'inactive', coalesce(s.inactive, 0),
        'attention_labels', coalesce((
          select jsonb_agg(x.label order by x.owner_priority desc, x.label)
          from (
            select go.label, mo.owner_priority
            from atlas.maintenance_objects mo
            join atlas.growing_objects go on go.id = mo.object_id
            where mo.farm_id = p_farm_id
              and mo.maintenance_type = 'weed'
              and coalesce(nullif(mo.metadata ->> 'owner_hierarchy_rank', '')::integer, 99) = h.rank
              and mo.active
              and mo.condition in ('heavy', 'reset', 'moderate')
              and coalesce(mo.remaining_effort_minutes, 0) > 0
            order by mo.owner_priority desc, go.label
            limit 4
          ) x
        ), '[]'::jsonb)
      ) order by h.rank)
      from hierarchy h
      left join stats s on s.rank = h.rank
    ), '[]'::jsonb)
  )
  into v_result
  from resolved r
  cross join next_rank nr;

  return coalesce(v_result, jsonb_build_object(
    'summary', jsonb_build_object(
      'current_rank', 1,
      'current_zone_label', 'Field Rows',
      'next_rank', 2,
      'next_zone_label', 'Main Garden',
      'active_count', 0,
      'queued_count', 0,
      'completed_count', 0,
      'queue_next_label', null
    ),
    'queue', '[]'::jsonb,
    'hierarchy', '[]'::jsonb
  ));
end;
$function$;

revoke all on function atlas.weeding_cycle_v1(uuid) from public, anon;
grant execute on function atlas.weeding_cycle_v1(uuid) to authenticated, service_role;

comment on function atlas.weeding_cycle_v1(uuid) is
  'Authenticated read model for the Elm Farm weeding page: released work, completion-gated Field Row queue, and owner hierarchy progression.';
