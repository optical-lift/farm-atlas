create or replace function atlas.shared_production_plans_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.user_id = v_user_id
      and fm.farm_id = p_farm_id
      and fm.active = true
  ) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(plan_row.payload order by plan_row.season_year, plan_row.first_window_start, plan_row.created_at),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      pp.season_year,
      pp.first_window_start,
      pp.created_at,
      jsonb_build_object(
        'id', pp.id,
        'stable_key', pp.stable_key,
        'season_year', pp.season_year,
        'plan_label', pp.plan_label,
        'plan_kind', pp.plan_kind,
        'first_window_start', pp.first_window_start,
        'succession_count', pp.succession_count,
        'spacing_days', pp.spacing_days,
        'window_length_days', pp.window_length_days,
        'late_window_days', pp.late_window_days,
        'missed_strategy', pp.missed_strategy,
        'intended_uses', pp.intended_uses,
        'protect_final_succession', pp.protect_final_succession,
        'final_biological_sow_date', pp.final_biological_sow_date,
        'notes', pp.notes,
        'metadata', pp.metadata,
        'crop_profiles', case
          when cp.id is null then null
          else jsonb_build_object(
            'crop_label', cp.crop_label,
            'variety', cp.variety
          )
        end,
        'production_successions', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', ps.id,
              'sequence_number', ps.sequence_number,
              'planned_window_start', ps.planned_window_start,
              'planned_window_end', ps.planned_window_end,
              'late_window_end', ps.late_window_end,
              'skip_after_date', ps.skip_after_date,
              'actual_sow_date', ps.actual_sow_date,
              'projected_germination_start', ps.projected_germination_start,
              'projected_germination_end', ps.projected_germination_end,
              'projected_harvest_start', ps.projected_harvest_start,
              'projected_harvest_end', ps.projected_harvest_end,
              'projected_clear_date', ps.projected_clear_date,
              'state', ps.state,
              'crop_cycle_id', ps.crop_cycle_id,
              'sow_task_id', ps.sow_task_id,
              'metadata', ps.metadata
            )
            order by ps.sequence_number
          )
          from atlas.production_successions ps
          where ps.production_plan_id = pp.id
        ), '[]'::jsonb)
      ) as payload
    from atlas.production_plans pp
    left join atlas.crop_profiles cp on cp.id = pp.crop_profile_id
    where pp.farm_id = p_farm_id
      and pp.active = true
  ) plan_row;

  return v_result;
end;
$function$;

create or replace function atlas.farm_snapshot_for_member_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_year_start date := date_trunc('year', current_date)::date;
  v_total_beds integer := 0;
  v_growing_beds integer := 0;
  v_active_sqft numeric := 0;
  v_sowing_events integer := 0;
  v_sowing_logs integer := 0;
  v_stems_logged numeric := 0;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.user_id = v_user_id
      and fm.farm_id = p_farm_id
      and fm.active = true
  ) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select count(*)::integer
  into v_total_beds
  from atlas.growing_objects go
  where go.farm_id = p_farm_id
    and go.object_type = 'bed';

  with active_objects as (
    select distinct oc.object_id
    from atlas.object_contents oc
    join atlas.growing_objects go on go.id = oc.object_id
    where oc.farm_id = p_farm_id
      and go.farm_id = p_farm_id
      and oc.status is not null
      and lower(oc.status) not in ('archived', 'cleared', 'dead', 'empty', 'failed', 'removed')
  )
  select
    count(*)::integer,
    coalesce(sum(coalesce(go.area_sqft, go.length_ft * go.width_ft, 0)), 0)
  into v_growing_beds, v_active_sqft
  from active_objects ao
  join atlas.growing_objects go on go.id = ao.object_id;

  select count(*)::integer,
         coalesce(sum(case
           when e.event_type = 'harvested' and lower(coalesce(e.unit, '')) like '%stem%'
             then coalesce(e.quantity, 0)
           else 0
         end), 0)
  into v_sowing_events, v_stems_logged
  from atlas.object_activity_events e
  where e.farm_id = p_farm_id
    and e.event_date >= v_year_start
    and (
      e.event_type in ('seeded', 'sowed', 'sowing_recorded')
      or (e.event_type = 'harvested' and lower(coalesce(e.unit, '')) like '%stem%')
    );

  select count(*)::integer
  into v_sowing_logs
  from atlas.field_logs fl
  where fl.farm_id = p_farm_id
    and fl.log_date >= v_year_start
    and exists (
      select 1
      from unnest(coalesce(fl.action_types, array[]::text[])) action_type
      where lower(action_type) like '%sow%'
         or lower(action_type) like '%seed%'
    );

  return jsonb_build_object(
    'totalBeds', v_total_beds,
    'growingBeds', v_growing_beds,
    'activeSqft', round(v_active_sqft),
    'sowingsLogged', v_sowing_events + v_sowing_logs,
    'stemsLogged', round(v_stems_logged)
  );
end;
$function$;

revoke all on function atlas.shared_production_plans_v1(uuid) from public;
revoke all on function atlas.shared_production_plans_v1(uuid) from anon;
grant execute on function atlas.shared_production_plans_v1(uuid) to authenticated;

revoke all on function atlas.farm_snapshot_for_member_v1(uuid) from public;
revoke all on function atlas.farm_snapshot_for_member_v1(uuid) from anon;
grant execute on function atlas.farm_snapshot_for_member_v1(uuid) to authenticated;

comment on function atlas.shared_production_plans_v1(uuid) is
  'Shared Elm Farm production plan and succession reader for any active farm member; mutation authority remains separate.';

comment on function atlas.farm_snapshot_for_member_v1(uuid) is
  'Shared Elm Farm snapshot metrics reader for any active farm member.';
