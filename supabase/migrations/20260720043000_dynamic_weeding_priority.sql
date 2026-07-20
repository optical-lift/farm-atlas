-- Dynamic weeding priority and July heat capacity.
-- Production database migration applied through Supabase on 2026-07-20.

create or replace function atlas.recalculate_weeding_priorities(
  p_farm_key text default 'elm_farm',
  p_as_of date default current_date
)
returns integer
language plpgsql
security definer
set search_path = atlas, public
as $$
declare
  v_farm_id uuid;
  v_field_rows_incomplete boolean;
  v_updated integer := 0;
begin
  select id into v_farm_id from atlas.farms where stable_key = p_farm_key;
  if v_farm_id is null then raise exception 'Unknown farm key: %', p_farm_key; end if;

  select exists(
    select 1
    from atlas.maintenance_objects mo
    join atlas.growing_objects go on go.id = mo.object_id
    left join atlas.zones z on z.id = mo.zone_id
    where mo.farm_id = v_farm_id
      and mo.maintenance_type = 'weed'
      and mo.active
      and z.stable_key = 'field_rows'
      and mo.last_completed_at is null
  ) into v_field_rows_incomplete;

  update atlas.maintenance_objects mo
  set
    next_eligible_date = case
      when z.stable_key = 'field_rows' then
        case when mo.last_completed_at is null then p_as_of
             else greatest(p_as_of, mo.last_completed_at::date + coalesce(mo.normal_return_interval_days,21)) end
      when z.stable_key = 'berry_walk_flower_rows' then
        greatest(p_as_of, coalesce(mo.last_completed_at::date,p_as_of) + coalesce(mo.normal_return_interval_days,21))
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'summer_flower_priority' then p_as_of
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'after_field_rows' and v_field_rows_incomplete then p_as_of + 30
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'after_field_rows' then
        greatest(p_as_of, coalesce(mo.last_completed_at::date,p_as_of) + coalesce(mo.normal_return_interval_days,21))
      else greatest(p_as_of, coalesce(mo.last_completed_at::date,p_as_of) + coalesce(mo.normal_return_interval_days,21))
    end,
    priority_score = case
      when z.stable_key = 'field_rows' and mo.last_completed_at is null then 300
      when z.stable_key = 'field_rows' then 140
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'summer_flower_priority' then 260
      when z.stable_key = 'berry_walk_flower_rows' then 120
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'after_field_rows' then 10
      when z.stable_key like 'barn%' then 80
      else greatest(20,mo.priority_score)
    end,
    owner_priority = case
      when coalesce(mo.metadata->>'manual_schedule_lock','false') = 'true' then greatest(mo.owner_priority,200)
      when z.stable_key = 'field_rows' and mo.last_completed_at is null then greatest(mo.owner_priority,100)
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'summer_flower_priority' then greatest(mo.owner_priority,90)
      when z.stable_key = 'u_pick' and coalesce(mo.metadata->>'rotation_lane','') = 'after_field_rows' then least(mo.owner_priority,5)
      else case when coalesce(mo.metadata->>'owner_priority_expires','') <> ''
                     and (mo.metadata->>'owner_priority_expires')::date < p_as_of
                then 0 else mo.owner_priority end
    end,
    metadata = coalesce(mo.metadata,'{}'::jsonb) || jsonb_build_object(
      'dynamic_weeding_priority',true,
      'priority_recalculated_at',now(),
      'priority_age_days',greatest(0,p_as_of-coalesce(mo.last_completed_at::date,p_as_of)),
      'field_rows_incomplete_gate',case when z.stable_key='u_pick' and coalesce(mo.metadata->>'rotation_lane','')='after_field_rows' then v_field_rows_incomplete else false end,
      'priority_reason',case
        when z.stable_key='field_rows' and mo.last_completed_at is null then 'Unfinished Field Row'
        when z.stable_key='u_pick' and coalesce(mo.metadata->>'rotation_lane','')='summer_flower_priority' then 'Summer flower production bed'
        when z.stable_key='u_pick' and coalesce(mo.metadata->>'rotation_lane','')='after_field_rows' and v_field_rows_incomplete then 'Held until Field Rows are finished'
        when z.stable_key='berry_walk_flower_rows' then 'Age-based Berry Walk rotation'
        else 'Age-based maintenance rotation'
      end
    ),
    updated_at = now()
  from atlas.growing_objects go, atlas.zones z
  where go.id = mo.object_id
    and z.id = mo.zone_id
    and mo.farm_id = v_farm_id
    and mo.maintenance_type = 'weed'
    and mo.active;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Keep hot-weather scheduling to one primary assignment plus the existing
-- 20-minute light pass. Positive values are required by table constraints.
update atlas.maintenance_scheduler_settings
set evening_minutes = 1,
    light_day_evening_minutes = 1,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'july_heat_mode',true,
      'july_heat_daily_pattern','one primary bed plus one 20-minute light pass',
      'july_heat_mode_set_at',now()
    ),
    updated_at = now()
where maintenance_type = 'weed';
