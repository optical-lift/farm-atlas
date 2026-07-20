create or replace function atlas.mirror_task_spacing_lines()
returns trigger
language plpgsql
set search_path to 'atlas','public'
as $function$
declare
  v_profile atlas.crop_profiles%rowtype;
  v_lines jsonb;
  v_rows text;
  v_spacing text;
begin
  if new.metadata is null then return new; end if;

  if lower(concat_ws(' ',new.task_type,new.action_key,new.metadata->>'work_route',new.metadata->>'display_action',new.title)) !~ '(sow|seed|patch)' then
    return new;
  end if;

  v_lines := case
    when jsonb_typeof(new.metadata->'spacing_lines')='array' and jsonb_array_length(new.metadata->'spacing_lines')>0
      then new.metadata->'spacing_lines'
    when jsonb_typeof(new.metadata->'plant_spacing_lines')='array' and jsonb_array_length(new.metadata->'plant_spacing_lines')>0
      then new.metadata->'plant_spacing_lines'
    else null
  end;

  if v_lines is null then
    if nullif(new.metadata->>'crop_profile_id','') is not null then
      select * into v_profile from atlas.crop_profiles where id=(new.metadata->>'crop_profile_id')::uuid limit 1;
    elsif nullif(new.metadata->>'crop_profile_stable_key','') is not null then
      select * into v_profile from atlas.crop_profiles where stable_key=new.metadata->>'crop_profile_stable_key' order by created_at desc limit 1;
    end if;
    if v_profile.id is not null and jsonb_typeof(v_profile.metadata->'spacing_lines')='array' then
      v_lines := v_profile.metadata->'spacing_lines';
    end if;
  end if;

  if v_lines is not null then
    select value #>> '{}' into v_rows
    from jsonb_array_elements(v_lines)
    where lower(value #>> '{}') like '%row%'
    limit 1;
    select value #>> '{}' into v_spacing
    from jsonb_array_elements(v_lines)
    where lower(value #>> '{}') ~ '(spacing|apart)'
    limit 1;

    v_rows := regexp_replace(coalesce(v_rows,''), '\s*per\s+3\s*ft\s*bed.*$', '', 'i');
    v_rows := regexp_replace(v_rows, '^\s*([0-9]+)\s+rows?.*$', '\1 rows', 'i');
    v_spacing := regexp_replace(coalesce(v_spacing,''), '^\s*([0-9]+)\s*(in|inch|inches|″|")\s+spacing.*$', '\1″ spacing', 'i');
    v_spacing := regexp_replace(v_spacing, '^\s*([0-9]+)\s*(in|inch|inches|″|")\s+apart.*$', '\1″ spacing', 'i');

    new.metadata := jsonb_set(new.metadata,'{plant_spacing_lines}',
      (select jsonb_agg(x) from unnest(array[v_rows,v_spacing]) x where nullif(trim(x),'') is not null),true);
    new.metadata := jsonb_set(new.metadata,'{plant_spacing_source}',
      case when v_profile.id is not null then '"crop_profile_spacing_lines"'::jsonb else '"task_spacing_lines"'::jsonb end,true);
  end if;
  return new;
end;
$function$;
