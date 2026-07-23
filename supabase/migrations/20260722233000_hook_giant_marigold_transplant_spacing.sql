do $migration$
declare
  v_profile_id uuid;
  v_task_id uuid;
  v_occurrence_id uuid;
begin
  insert into atlas.crop_profiles(
    stable_key,crop_label,variety,crop_family,life_cycle,
    default_planting_method,rows_per_3ft_bed,in_row_spacing_in,metadata
  )
  values(
    'giant_marigold','Giant Marigold','Elm Farm seed-saved giant marigold',
    'Asteraceae','annual','transplant',2,24,
    jsonb_build_object(
      'use_tags',jsonb_build_array('cut_flower','focal_flower','seed_saved','cut_and_come_again'),
      'best_zones',jsonb_build_array('field_rows','entry_billboard_garden'),
      'spacing_lines',jsonb_build_array('2 rows per 3 ft bed','24 in apart'),
      'default_rows_per_bed_label','2 rows',
      'default_in_row_spacing_label','24″ apart',
      'germination_workflow_enabled',true,
      'source_note','Elm Farm established giant marigold line'
    )
  )
  on conflict(stable_key)
  do update set
    crop_label=excluded.crop_label,
    variety=excluded.variety,
    crop_family=excluded.crop_family,
    life_cycle=excluded.life_cycle,
    default_planting_method=excluded.default_planting_method,
    rows_per_3ft_bed=excluded.rows_per_3ft_bed,
    in_row_spacing_in=excluded.in_row_spacing_in,
    metadata=atlas.crop_profiles.metadata||excluded.metadata,
    updated_at=now()
  returning id into v_profile_id;

  if not exists(
    select 1 from atlas.crop_profile_aliases
    where crop_profile_id=v_profile_id
      and atlas.identity_token(alias_label)=atlas.identity_token('Marigolds')
      and alias_variety is null
  ) then
    insert into atlas.crop_profile_aliases(
      crop_profile_id,alias_label,alias_variety,priority,active,note
    ) values(
      v_profile_id,'Marigolds',null,10,true,
      'Elm Farm plural task-language alias for Giant Marigold.'
    );
  end if;

  if not exists(
    select 1 from atlas.crop_profile_aliases
    where crop_profile_id=v_profile_id
      and atlas.identity_token(alias_label)=atlas.identity_token('Giant Marigold')
      and alias_variety is null
  ) then
    insert into atlas.crop_profile_aliases(
      crop_profile_id,alias_label,alias_variety,priority,active,note
    ) values(
      v_profile_id,'Giant Marigold',null,1,true,
      'Canonical Elm Farm giant marigold alias.'
    );
  end if;

  select t.id,t.planned_occurrence_id
  into v_task_id,v_occurrence_id
  from atlas.tasks t
  where t.farm_id=(select id from atlas.farms where stable_key='elm_farm')
    and t.metadata->>'task_key'='anna_20260722_transplant_marigolds_fr3'
  order by t.created_at desc
  limit 1;

  if v_task_id is not null then
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'crop_profile_id',v_profile_id,
          'crop_profile_stable_key','giant_marigold',
          'crop_label','Giant Marigold',
          'variety','Elm Farm seed-saved giant marigold',
          'rows_per_3ft_bed',2,
          'in_row_spacing_in',24,
          'spacing_lines',jsonb_build_array('2 rows per 3 ft bed','24 in apart'),
          'plant_spacing_lines',jsonb_build_array('2 rows','24″ spacing'),
          'plant_spacing_source','crop_profile_spacing_lines',
          'display_detail','Plant the hardened-off marigolds in Field Row 3 · 24″ apart · 2 rows.',
          'detail_lines',jsonb_build_array('Field Row 3','24″ apart','2 rows'),
          'crop_data_linked',true
        ),
        updated_at=now()
    where id=v_task_id;

    perform atlas.sync_task_crop_cycle_links_v1(v_task_id);
  end if;

  if v_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set task_payload=jsonb_set(
          coalesce(task_payload,'{}'::jsonb),
          '{metadata}',
          coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
            'crop_profile_id',v_profile_id,
            'crop_profile_stable_key','giant_marigold',
            'crop_label','Giant Marigold',
            'variety','Elm Farm seed-saved giant marigold',
            'rows_per_3ft_bed',2,
            'in_row_spacing_in',24,
            'spacing_lines',jsonb_build_array('2 rows per 3 ft bed','24 in apart'),
            'plant_spacing_lines',jsonb_build_array('2 rows','24″ spacing'),
            'plant_spacing_source','crop_profile_spacing_lines',
            'display_detail','Plant the hardened-off marigolds in Field Row 3 · 24″ apart · 2 rows.',
            'detail_lines',jsonb_build_array('Field Row 3','24″ apart','2 rows'),
            'crop_data_linked',true
          ),
          true
        ),
        updated_at=now()
    where id=v_occurrence_id;
  end if;
end
$migration$;

create or replace function atlas.mirror_task_spacing_lines()
returns trigger
language plpgsql
set search_path = atlas, public
as $function$
declare
  v_profile atlas.crop_profiles%rowtype;
  v_lines jsonb;
  v_rows text;
  v_spacing text;
  v_profile_id uuid;
begin
  new.metadata:=coalesce(new.metadata,'{}'::jsonb);

  if lower(concat_ws(' ',new.task_type,new.action_key,new.metadata->>'work_route',new.metadata->>'display_action',new.title)) !~ '(sow|seed|patch|plant|transplant)' then
    return new;
  end if;

  v_lines:=case
    when jsonb_typeof(new.metadata->'spacing_lines')='array' and jsonb_array_length(new.metadata->'spacing_lines')>0
      then new.metadata->'spacing_lines'
    when jsonb_typeof(new.metadata->'plant_spacing_lines')='array' and jsonb_array_length(new.metadata->'plant_spacing_lines')>0
      then new.metadata->'plant_spacing_lines'
    else null
  end;

  if v_lines is null then
    if coalesce(new.metadata->>'crop_profile_id','') ~* '^[0-9a-f-]{36}$' then
      v_profile_id:=(new.metadata->>'crop_profile_id')::uuid;
    elsif nullif(new.metadata->>'crop_profile_stable_key','') is not null then
      select id into v_profile_id
      from atlas.crop_profiles
      where stable_key=new.metadata->>'crop_profile_stable_key'
      order by created_at desc
      limit 1;
    elsif nullif(new.metadata->>'crop_label','') is not null then
      v_profile_id:=atlas.resolve_crop_profile_id_v1(
        new.metadata->>'crop_label',
        coalesce(new.metadata->>'variety',new.metadata->>'crop_variety')
      );
    end if;

    if v_profile_id is not null then
      select * into v_profile from atlas.crop_profiles where id=v_profile_id limit 1;
    end if;

    if v_profile.id is not null then
      if jsonb_typeof(v_profile.metadata->'spacing_lines')='array'
         and jsonb_array_length(v_profile.metadata->'spacing_lines')>0 then
        v_lines:=v_profile.metadata->'spacing_lines';
      elsif v_profile.rows_per_3ft_bed is not null or v_profile.in_row_spacing_in is not null then
        v_lines:=jsonb_strip_nulls(jsonb_build_array(
          case when v_profile.rows_per_3ft_bed is null then null else trim(to_char(v_profile.rows_per_3ft_bed,'FM999990.##'))||' rows per 3 ft bed' end,
          case when v_profile.in_row_spacing_in is null then null else trim(to_char(v_profile.in_row_spacing_in,'FM999990.##'))||' in apart' end
        ));
      end if;
    end if;
  end if;

  if v_lines is not null and jsonb_typeof(v_lines)='array' then
    select value#>>'{}' into v_rows
    from jsonb_array_elements(v_lines)
    where lower(value#>>'{}') like '%row%'
    limit 1;

    select value#>>'{}' into v_spacing
    from jsonb_array_elements(v_lines)
    where lower(value#>>'{}') ~ '(spacing|apart)'
    limit 1;

    v_rows:=regexp_replace(coalesce(v_rows,''),'\s*per\s+3\s*ft\s*bed.*$','','i');
    v_rows:=regexp_replace(v_rows,'^\s*([0-9]+(?:\.[0-9]+)?)\s+rows?.*$','\1 rows','i');
    v_spacing:=regexp_replace(coalesce(v_spacing,''),'^\s*([0-9]+(?:\.[0-9]+)?)\s*(in|inch|inches|″|")\s+(spacing|apart).*$','\1″ spacing','i');

    new.metadata:=jsonb_set(
      new.metadata,
      '{plant_spacing_lines}',
      coalesce((select jsonb_agg(x) from unnest(array[v_rows,v_spacing]) x where nullif(trim(x),'') is not null),'[]'::jsonb),
      true
    );
    new.metadata:=jsonb_set(
      new.metadata,
      '{plant_spacing_source}',
      case when v_profile.id is not null then '"crop_profile_spacing_lines"'::jsonb else '"task_spacing_lines"'::jsonb end,
      true
    );

    if v_profile.id is not null then
      new.metadata:=new.metadata||jsonb_strip_nulls(jsonb_build_object(
        'crop_profile_id',v_profile.id,
        'crop_profile_stable_key',v_profile.stable_key,
        'crop_label',v_profile.crop_label,
        'variety',v_profile.variety,
        'rows_per_3ft_bed',v_profile.rows_per_3ft_bed,
        'in_row_spacing_in',v_profile.in_row_spacing_in
      ));
    end if;
  end if;

  return new;
end;
$function$;