create or replace function atlas.normalize_clock_mowing_card_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_object atlas.growing_objects%rowtype;
  v_state_id uuid;
  v_equipment text;
  v_height_text text;
  v_height_label text;
begin
  v_state_id := atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');

  if coalesce(new.metadata->>'rhythm_key','') = 'mowing'
     and v_state_id is not null then
    select go.* into v_object
    from atlas.rhythm_state rs
    join atlas.growing_objects go on go.id = rs.subject_id
    where rs.id = v_state_id
      and rs.subject_kind = 'growing_object';

    if v_object.id is not null then
      v_equipment := nullif(v_object.metadata->>'equipment_group','');
      v_height_text := nullif(v_object.metadata->>'target_cut_height_inches','');
      if v_height_text ~ '^\d+(\.\d+)?$' then
        v_height_label := to_char(v_height_text::numeric,'FM999990.##');
      else
        v_height_label := v_height_text;
      end if;

      new.title := 'Mow — ' || coalesce(nullif(v_object.label,''),'Mowing route');
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'display_action','Mow',
        'display_subject',coalesce(nullif(v_object.label,''),'Mowing route'),
        'display_detail',case
          when v_equipment is not null and v_height_label is not null then v_equipment || ' · target ' || v_height_label || ' in'
          when v_equipment is not null then v_equipment
          when v_height_label is not null then 'Target ' || v_height_label || ' in'
          else null
        end,
        'equipment_group',v_equipment,
        'target_cut_height_inches',v_height_text
      ));
    end if;
  end if;
  return new;
end;
$$;

update atlas.tasks
set title=title,metadata=metadata,updated_at=now()
where id='f711b291-58b0-47e7-81f2-ea6500bd5b6e';
