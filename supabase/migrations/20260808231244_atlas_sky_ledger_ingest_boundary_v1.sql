create or replace function atlas.ingest_sky_ledger_v1(
  p_farm_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_calculation_version text,
  p_samples jsonb,
  p_windows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_role text;
  v_sample_count integer := 0;
  v_window_count integer := 0;
  v_item jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role not in ('owner','manager') then
    raise exception 'Owner or manager membership required.' using errcode='42501';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'Valid sky ledger range required.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_calculation_version,'')),'') is null then
    raise exception 'Calculation version required.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_samples,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_windows,'[]'::jsonb)) <> 'array' then
    raise exception 'Sky samples and windows must be JSON arrays.' using errcode='22023';
  end if;

  delete from atlas.sky_windows
  where farm_id=p_farm_id
    and calculation_version=p_calculation_version
    and starts_at < p_range_end
    and ends_at > p_range_start;

  for v_item in select value from jsonb_array_elements(coalesce(p_samples,'[]'::jsonb))
  loop
    insert into atlas.sky_state_samples(
      farm_id,service_date,sampled_at,timezone_name,frame,zodiac_basis,
      moon_longitude_deg,sun_longitude_deg,moon_sign,moon_sign_mode,
      phase_angle_deg,illumination_fraction,phase_state,
      source_provider,source_version,calculation_version,metadata
    ) values (
      p_farm_id,
      (v_item->>'service_date')::date,
      (v_item->>'sampled_at')::timestamptz,
      v_item->>'timezone_name',
      coalesce(v_item->>'frame','geocentric'),
      coalesce(v_item->>'zodiac_basis','tropical_true_ecliptic_of_date'),
      (v_item->>'moon_longitude_deg')::numeric,
      (v_item->>'sun_longitude_deg')::numeric,
      v_item->>'moon_sign',
      v_item->>'moon_sign_mode',
      (v_item->>'phase_angle_deg')::numeric,
      (v_item->>'illumination_fraction')::numeric,
      v_item->>'phase_state',
      v_item->>'source_provider',
      v_item->>'source_version',
      p_calculation_version,
      coalesce(v_item->'metadata','{}'::jsonb)
    )
    on conflict (farm_id,service_date,calculation_version) do update
    set sampled_at=excluded.sampled_at,
        timezone_name=excluded.timezone_name,
        frame=excluded.frame,
        zodiac_basis=excluded.zodiac_basis,
        moon_longitude_deg=excluded.moon_longitude_deg,
        sun_longitude_deg=excluded.sun_longitude_deg,
        moon_sign=excluded.moon_sign,
        moon_sign_mode=excluded.moon_sign_mode,
        phase_angle_deg=excluded.phase_angle_deg,
        illumination_fraction=excluded.illumination_fraction,
        phase_state=excluded.phase_state,
        source_provider=excluded.source_provider,
        source_version=excluded.source_version,
        metadata=excluded.metadata,
        generated_at=now();
    v_sample_count := v_sample_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_windows,'[]'::jsonb))
  loop
    insert into atlas.sky_windows(
      farm_id,window_kind,value_key,starts_at,ends_at,timezone_name,frame,zodiac_basis,
      source_provider,source_version,calculation_version,value_payload,metadata
    ) values (
      p_farm_id,
      v_item->>'window_kind',
      v_item->>'value_key',
      (v_item->>'starts_at')::timestamptz,
      (v_item->>'ends_at')::timestamptz,
      v_item->>'timezone_name',
      coalesce(v_item->>'frame','geocentric'),
      nullif(v_item->>'zodiac_basis',''),
      v_item->>'source_provider',
      v_item->>'source_version',
      p_calculation_version,
      coalesce(v_item->'value_payload','{}'::jsonb),
      coalesce(v_item->'metadata','{}'::jsonb)
    )
    on conflict (farm_id,window_kind,starts_at,calculation_version) do update
    set value_key=excluded.value_key,
        ends_at=excluded.ends_at,
        timezone_name=excluded.timezone_name,
        frame=excluded.frame,
        zodiac_basis=excluded.zodiac_basis,
        source_provider=excluded.source_provider,
        source_version=excluded.source_version,
        value_payload=excluded.value_payload,
        metadata=excluded.metadata,
        generated_at=now();
    v_window_count := v_window_count + 1;
  end loop;

  return jsonb_build_object(
    'contractVersion','ingest_sky_ledger_v1',
    'farmId',p_farm_id,
    'calculationVersion',p_calculation_version,
    'samplesWritten',v_sample_count,
    'windowsWritten',v_window_count,
    'rangeStart',p_range_start,
    'rangeEnd',p_range_end
  );
end;
$function$;

revoke all on function atlas.ingest_sky_ledger_v1(uuid,timestamptz,timestamptz,text,jsonb,jsonb) from public;
grant execute on function atlas.ingest_sky_ledger_v1(uuid,timestamptz,timestamptz,text,jsonb,jsonb) to authenticated;
