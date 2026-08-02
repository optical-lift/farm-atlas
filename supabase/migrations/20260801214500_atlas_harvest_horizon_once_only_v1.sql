-- Keep each grouped Harvest Horizon entry stable after its first Bell appearance.

create or replace function atlas.harvest_horizon_tick_v1(
  p_farm_id uuid default null,
  p_as_of date default (now() at time zone 'America/Chicago')::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_wave record;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_event_key text;
  v_inserted integer := 0;
  v_as_of date := coalesce(p_as_of, (now() at time zone 'America/Chicago')::date);
begin
  for v_wave in
    with horizon as (
      select
        forecast.farm_id,
        farm.organization_id,
        forecast.crop_cycle_id,
        forecast.object_id,
        coalesce(nullif(forecast.object_label, ''), 'Growing area') as object_label,
        coalesce(
          nullif(forecast.crop_profile_stable_key, ''),
          regexp_replace(lower(coalesce(nullif(forecast.crop_label, ''), 'crop')), '[^a-z0-9]+', '_', 'g')
        ) as crop_key,
        coalesce(nullif(forecast.crop_label, ''), 'Crop') as crop_label,
        nullif(forecast.variety, '') as variety,
        forecast.expected_harvest_watch_start as window_start,
        coalesce(forecast.expected_harvest_watch_end, forecast.expected_harvest_watch_start + 21) as window_end
      from atlas.crop_cycle_yield_forecast forecast
      join atlas.farms farm on farm.id = forecast.farm_id
      where forecast.lifecycle_status = 'active'
        and forecast.expected_harvest_watch_start is not null
        and forecast.expected_harvest_watch_start <= v_as_of + 21
        and coalesce(forecast.expected_harvest_watch_end, forecast.expected_harvest_watch_start + 21) >= v_as_of
        and (p_farm_id is null or forecast.farm_id = p_farm_id)
        and coalesce(forecast.object_stable_key, '') not like 'grow_room_%'
        and lower(coalesce(forecast.cycle_state, '')) not in ('failed', 'cleared', 'finished', 'finished_harvest')
    )
    select
      farm_id,
      organization_id,
      crop_key,
      min(crop_label) as crop_label,
      variety,
      window_start,
      window_end,
      (array_agg(crop_cycle_id order by crop_cycle_id::text))[1] as source_cycle_id,
      (array_agg(object_id order by object_label, object_id::text) filter (where object_id is not null))[1] as source_object_id,
      array_agg(crop_cycle_id order by crop_cycle_id::text) as crop_cycle_ids,
      array_agg(distinct object_label order by object_label) as object_labels,
      count(*)::integer as cycle_count
    from horizon
    group by farm_id, organization_id, crop_key, variety, window_start, window_end
  loop
    v_event_key := left(
      'harvest-horizon:' || v_wave.crop_key || ':' ||
      regexp_replace(lower(coalesce(v_wave.variety, 'general')), '[^a-z0-9]+', '_', 'g') || ':' ||
      v_wave.window_start::text || ':' || v_wave.window_end::text,
      240
    );

    select event.id into v_existing_event_id
    from atlas.journal_event_index event
    where event.farm_id = v_wave.farm_id
      and event.event_key = v_event_key
    limit 1;

    if v_existing_event_id is not null then
      continue;
    end if;

    v_event_id := atlas.upsert_journal_event_v1(
      p_organization_id => v_wave.organization_id,
      p_farm_id => v_wave.farm_id,
      p_event_key => v_event_key,
      p_event_kind => 'production_change',
      p_source_kind => 'crop_cycle',
      p_source_id => v_wave.source_cycle_id,
      p_source_event => 'harvest_horizon_entry',
      p_occurred_at => make_timestamptz(
        extract(year from v_as_of)::integer,
        extract(month from v_as_of)::integer,
        extract(day from v_as_of)::integer,
        6, 0, 0,
        'America/Chicago'
      ),
      p_journal_date => v_as_of,
      p_title => coalesce(v_wave.variety, v_wave.crop_label) || ' entered the harvest horizon',
      p_detail => array_to_string(v_wave.object_labels, ' · ') ||
        ' · expected ' || to_char(v_wave.window_start, 'Mon FMDD') ||
        '–' || to_char(v_wave.window_end, 'Mon FMDD'),
      p_visibility_scope => 'farm_shared',
      p_importance => 'attention',
      p_object_id => v_wave.source_object_id,
      p_crop_cycle_id => v_wave.source_cycle_id,
      p_payload => jsonb_build_object(
        'deepLink', '/harvest',
        'surface', 'harvest_horizon',
        'cropKey', v_wave.crop_key,
        'cropLabel', v_wave.crop_label,
        'variety', v_wave.variety,
        'windowStart', v_wave.window_start,
        'windowEnd', v_wave.window_end,
        'cropCycleIds', to_jsonb(v_wave.crop_cycle_ids),
        'objectLabels', to_jsonb(v_wave.object_labels),
        'cycleCount', v_wave.cycle_count,
        'timeClaimsPhysicalCondition', false
      ),
      p_provenance => jsonb_build_object(
        'contractVersion', 'harvest_horizon_v1',
        'source', 'crop_cycle_yield_forecast',
        'grouping', 'crop_profile_variety_window'
      )
    );
    if v_event_id is not null then v_inserted := v_inserted + 1; end if;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'harvest_horizon_v1',
    'asOf', v_as_of,
    'farmId', p_farm_id,
    'newWaves', v_inserted
  );
end;
$function$;
