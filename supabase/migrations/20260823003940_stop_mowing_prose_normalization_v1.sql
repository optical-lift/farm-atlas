create or replace function atlas.normalize_clock_mowing_card_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_state_id uuid;
  v_equipment text;
  v_required_keys jsonb;
begin
  new.metadata:=coalesce(new.metadata,'{}'::jsonb);

  if new.task_type='mowing' then
    -- Mowing instructions are data: equipment + numeric cut height. Never
    -- manufacture a sentence such as "Cut to 3 in." from these values.
    new.metadata:=(new.metadata
      -'mower_setting'
      -'cut_height_label'
      -'execution_do'
      -'execution_how'
      -'execution_done_when')
      ||jsonb_build_object(
        'target_cut_height_inches','3',
        'structured_execution_contract','work_execution_components_v1',
        'prose_retired',true
      );
  end if;

  v_state_id:=atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');

  if coalesce(new.metadata->>'rhythm_key','')='mowing' and v_state_id is not null then
    select go.* into v_object
    from atlas.rhythm_state rs
    join atlas.growing_objects go on go.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='growing_object';
  end if;

  v_equipment:=coalesce(
    nullif(v_object.metadata->>'equipment_group',''),
    nullif(new.metadata->>'equipment_group','')
  );

  if new.task_type='mowing' then
    new.metadata:=new.metadata-'battery_resource_key'-'riding_mower_resource_key';
    v_required_keys:=case
      when jsonb_typeof(coalesce(new.metadata->'required_resource_keys','[]'::jsonb))='array'
        then coalesce(new.metadata->'required_resource_keys','[]'::jsonb)
      else '[]'::jsonb
    end;

    select coalesce(jsonb_agg(value),'[]'::jsonb)
      into v_required_keys
    from jsonb_array_elements(v_required_keys) value
    where trim(both '"' from value::text) not in ('battery_push_mower_battery_set','cub_cadet_lawn_mower');

    if lower(replace(coalesce(v_equipment,''),'_',' ')) in ('push mower','battery push mower') then
      v_equipment:='Battery push mower';
      v_required_keys:=v_required_keys||jsonb_build_array('battery_push_mower_battery_set');
      new.metadata:=jsonb_set(new.metadata,'{battery_resource_key}',to_jsonb('battery_push_mower_battery_set'::text),true);
    elsif lower(replace(coalesce(v_equipment,''),'_',' ')) in ('riding mower','riding lawn mower') then
      v_equipment:='Riding mower';
      v_required_keys:=v_required_keys||jsonb_build_array('cub_cadet_lawn_mower');
      new.metadata:=jsonb_set(new.metadata,'{riding_mower_resource_key}',to_jsonb('cub_cadet_lawn_mower'::text),true);
    end if;

    new.metadata:=jsonb_set(new.metadata,'{required_resource_keys}',v_required_keys,true);

    if v_equipment is not null then
      new.metadata:=jsonb_set(new.metadata,'{equipment_group}',to_jsonb(v_equipment),true);
      -- display_detail may hold the compact equipment name; never a method sentence.
      new.metadata:=jsonb_set(new.metadata,'{display_detail}',to_jsonb(v_equipment),true);
    end if;
  end if;

  if v_object.id is not null then
    new.title:='Mow — '||coalesce(nullif(v_object.label,''),'Mowing route');
    new.metadata:=new.metadata||jsonb_strip_nulls(jsonb_build_object(
      'display_action','Mow',
      'display_subject',coalesce(nullif(v_object.label,''),'Mowing route'),
      'display_detail',v_equipment,
      'equipment_group',v_equipment,
      'target_cut_height_inches','3',
      'structured_execution_contract','work_execution_components_v1',
      'prose_retired',true
    ));
  end if;

  return new;
end;
$function$;