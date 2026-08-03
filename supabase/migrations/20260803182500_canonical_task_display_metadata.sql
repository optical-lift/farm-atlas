create or replace function atlas.normalize_task_display_metadata_v1(
  p_metadata jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, atlas
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_action text := btrim(coalesce(p_metadata ->> 'display_action', ''));
  v_subject text := btrim(coalesce(p_metadata ->> 'display_subject', ''));
  v_family text := btrim(coalesce(
    nullif(p_metadata ->> 'display_family', ''),
    nullif(p_metadata ->> 'work_category_label', '')
  ));
  v_location text := btrim(coalesce(
    nullif(p_metadata ->> 'display_location', ''),
    nullif(p_metadata ->> 'location_label', ''),
    nullif(p_metadata ->> 'venue_room_label', ''),
    nullif(p_metadata ->> 'object_label', ''),
    nullif(p_metadata ->> 'collection_label', '')
  ));
begin
  -- Action and subject are separate fields. Do not let presentation data say
  -- "Fix · Fix door hardware" or "Cut · Cut trim".
  if v_action <> ''
     and v_subject <> ''
     and lower(left(v_subject, length(v_action) + 1)) = lower(v_action || ' ') then
    v_subject := btrim(substr(v_subject, length(v_action) + 2));
    if v_subject <> '' then
      v_metadata := jsonb_set(v_metadata, '{display_subject}', to_jsonb(v_subject), true);
    end if;
  end if;

  -- Persist the operational family and location already present in canonical
  -- metadata so clients do not need to infer either one from title prose.
  if v_family <> '' then
    v_metadata := jsonb_set(v_metadata, '{display_family}', to_jsonb(v_family), true);
  end if;

  if v_location <> '' then
    v_metadata := jsonb_set(v_metadata, '{display_location}', to_jsonb(v_location), true);
  end if;

  return v_metadata;
end;
$$;

create or replace function atlas.normalize_task_display_metadata_trigger_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  new.metadata := atlas.normalize_task_display_metadata_v1(new.metadata);
  return new;
end;
$$;

drop trigger if exists normalize_task_display_metadata_v1 on atlas.tasks;
create trigger normalize_task_display_metadata_v1
before insert or update of metadata on atlas.tasks
for each row
execute function atlas.normalize_task_display_metadata_trigger_v1();

-- Normalize the existing task record without changing operational state.
update atlas.tasks
set metadata = atlas.normalize_task_display_metadata_v1(metadata),
    updated_at = updated_at
where metadata ? 'display_action'
   or metadata ? 'display_subject'
   or metadata ? 'work_category_label'
   or metadata ? 'venue_room_label'
   or metadata ? 'location_label';

-- Remaining trim work spans rooms rather than one room object. Its truthful
-- operational container is the existing Farmhouse Interior work zone.
update atlas.tasks t
set zone_id = z.id,
    metadata = atlas.normalize_task_display_metadata_v1(
      coalesce(t.metadata, '{}'::jsonb)
      || jsonb_build_object('display_location', z.label)
    )
from atlas.zones z
where z.farm_id = t.farm_id
  and z.stable_key = 'farmhouse_interior'
  and coalesce(t.metadata ->> 'work_category_key', '') = 'trim_finish'
  and coalesce(t.metadata ->> 'venue_room_key', '') = '';

comment on function atlas.normalize_task_display_metadata_v1(jsonb) is
  'Separates stored action from subject and persists explicit family/location fields so Atlas clients do not infer operational meaning from title prose.';
