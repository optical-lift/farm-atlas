create or replace function atlas.normalize_task_lunar_family_v1(
  p_action_key text,
  p_task_type text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, atlas
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_action text;
  v_task_type text;
  v_part text;
  v_manual text;
  v_family text;
  v_source text := 'canonical_task_fields_v1';
begin
  v_action := trim(both '_' from regexp_replace(
    lower(btrim(coalesce(nullif(p_action_key, ''), nullif(v_metadata ->> 'display_action', ''), ''))),
    '[^a-z0-9]+', '_', 'g'
  ));
  v_task_type := trim(both '_' from regexp_replace(
    lower(btrim(coalesce(p_task_type, ''))),
    '[^a-z0-9]+', '_', 'g'
  ));
  v_part := trim(both '_' from regexp_replace(
    lower(btrim(coalesce(v_metadata ->> 'plant_part', ''))),
    '[^a-z0-9]+', '_', 'g'
  ));
  v_manual := trim(both '_' from regexp_replace(
    lower(btrim(coalesce(v_metadata ->> 'lunar_family_manual', ''))),
    '[^a-z0-9]+', '_', 'g'
  ));

  if v_manual in (
    'aboveground_planting', 'belowground_planting', 'maintenance',
    'aboveground_harvest', 'belowground_harvest'
  ) then
    v_family := v_manual;
    v_source := 'manual';
  else
    v_family := case
      when v_action in ('sow', 'seed', 'plant', 'transplant', 'pot_up', 'set_out')
        then 'aboveground_planting'
      when v_action in ('plant_bulbs', 'plant_roots', 'divide')
        then 'belowground_planting'
      when v_action in ('harvest', 'cut_flowers')
        then 'aboveground_harvest'
      when v_action in ('dig', 'lift', 'pull_roots')
        then 'belowground_harvest'
      when v_action in (
        'weed', 'weeding', 'cultivate', 'cultivation', 'prune', 'pruning',
        'thin', 'thinning', 'mow', 'mowing', 'spray', 'respray',
        'manage_pests', 'pest_control', 'clear', 'cleanup', 'clean_up',
        'remove', 'deadhead', 'cut_back', 'tree_removal', 'maintenance'
      ) then 'maintenance'
      when v_task_type in ('sowing', 'planting', 'transplanting', 'pot_up')
        then 'aboveground_planting'
      when v_task_type in ('bulb_planting', 'root_planting', 'division')
        then 'belowground_planting'
      when v_task_type in ('harvest', 'flower_harvest')
        then 'aboveground_harvest'
      when v_task_type in ('root_harvest', 'bulb_harvest')
        then 'belowground_harvest'
      when v_task_type in (
        'maintenance', 'mowing', 'grounds_mowing', 'weed_control',
        'garden_cleanup', 'cleanup', 'bed_prep', 'grounds_tree_work',
        'marshall_tree_work'
      ) then 'maintenance'
      else null
    end;

    if v_part in ('root', 'roots', 'bulb', 'bulbs', 'rhizome', 'rhizomes', 'tuber', 'tubers', 'corm', 'corms') then
      if v_family = 'aboveground_planting' then v_family := 'belowground_planting'; end if;
      if v_family = 'aboveground_harvest' then v_family := 'belowground_harvest'; end if;
    end if;
  end if;

  if v_family is null then
    return v_metadata - 'lunar_family' - 'lunar_family_source';
  end if;

  v_metadata := jsonb_set(v_metadata, '{lunar_family}', to_jsonb(v_family), true);
  v_metadata := jsonb_set(v_metadata, '{lunar_family_source}', to_jsonb(v_source), true);
  return v_metadata;
end;
$$;

create or replace function atlas.normalize_task_lunar_family_trigger_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  new.metadata := atlas.normalize_task_lunar_family_v1(
    new.action_key,
    new.task_type,
    new.metadata
  );
  return new;
end;
$$;

drop trigger if exists normalize_task_lunar_family_v1 on atlas.tasks;
create trigger normalize_task_lunar_family_v1
before insert or update of action_key, task_type, metadata on atlas.tasks
for each row
execute function atlas.normalize_task_lunar_family_trigger_v1();

update atlas.tasks
set metadata = atlas.normalize_task_lunar_family_v1(action_key, task_type, metadata),
    updated_at = updated_at;

comment on function atlas.normalize_task_lunar_family_v1(text, text, jsonb) is
  'Persists lunar work family from controlled task fields. Task titles and display subjects are never classification inputs.';
