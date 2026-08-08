insert into atlas.operation_classes (stable_key,label,operation_domain,definition) values
  ('process_postharvest','Process postharvest','harvest','Condition, bundle, or otherwise process already harvested material after removal from the growing plant.')
on conflict (stable_key) do update
set label=excluded.label,
    operation_domain=excluded.operation_domain,
    definition=excluded.definition,
    active=true,
    updated_at=now();

create or replace function atlas.task_operation_class_v1(
  p_title text,
  p_action_key text,
  p_task_type text,
  p_metadata jsonb
)
returns table(operation_class text, source text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_metadata jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_manual text;
  v_action text;
  v_type text;
  v_part text;
  v_title text;
begin
  v_manual := trim(both '_' from regexp_replace(lower(btrim(coalesce(v_metadata->>'operation_class_manual',''))),'[^a-z0-9]+','_','g'));
  if v_manual <> '' and exists (select 1 from atlas.operation_classes c where c.stable_key=v_manual and c.active) then
    operation_class := v_manual;
    source := 'manual';
    return next;
    return;
  end if;

  v_action := trim(both '_' from regexp_replace(lower(btrim(coalesce(p_action_key,''))),'[^a-z0-9]+','_','g'));
  v_type := trim(both '_' from regexp_replace(lower(btrim(coalesce(p_task_type,''))),'[^a-z0-9]+','_','g'));
  v_part := trim(both '_' from regexp_replace(lower(btrim(coalesce(v_metadata->>'plant_part',''))),'[^a-z0-9]+','_','g'));
  v_title := lower(btrim(coalesce(p_title,'')));

  operation_class := case
    when v_action in ('divide','divide_replant','divide_and_replant')
      or v_type in ('division','plant_division')
      then 'divide_reestablish_belowground'

    when v_part in ('root','roots','bulb','bulbs','rhizome','rhizomes','tuber','tubers','corm','corms')
      and v_action in ('plant','planting','transplant','replant','set_out','pot_up','plant_bulbs','plant_roots')
      then 'establish_belowground'

    when v_part in ('root','roots','bulb','bulbs','rhizome','rhizomes','tuber','tubers','corm','corms')
      and v_action in ('harvest','dig','lift','pull_roots')
      then 'harvest_belowground'

    when v_action in ('sow','sowing','seed','seed_sowing','seed_starting','propagation','propagation_start','propagate','pot_up','plant','planting','transplant','replant','set_out')
      or v_type in ('sowing','succession_sowing','seed_sowing','seed_starting','planting','transplanting','transplant','pot_up','propagation','propagation_start','propagation_collection')
      then 'establish_aboveground'

    when v_action in ('weed','weeding','thin','thinning','pull')
      or v_type in ('weeding','thinning')
      then 'remove_uproot'

    when v_action in ('prune','pruning','mow','mowing','deadhead','cut_back')
      or v_type in ('prune','mowing','grounds_mowing','garden_cleanup')
      then 'cut_separate'

    when v_action in ('cultivate','cultivation','prepare_soil','prep_soil','make_soil_blocks','soil_blocking')
      or v_type in ('bed_prep','bed_reset','soil_blocking')
      then 'cultivate_prepare'

    when v_action in ('bundle','condition','conditioning')
      or v_type in ('postharvest_bundle','postharvest_conditioning')
      then 'process_postharvest'

    when v_action in ('harvest','cut_flowers')
      or v_type in ('harvest','flower_harvest')
      then 'harvest_aboveground'

    when v_action in ('dig','lift','pull_roots')
      or v_type in ('root_harvest','bulb_harvest')
      then 'harvest_belowground'

    when v_action in ('support','stake','secure')
      or v_type in ('support','staking')
      then 'retain_strengthen'

    when v_action in ('inspect','check','verify','field_check','germination_check','grow_room_check','grow_room_round','harvest_watch','harvest_horizon','transplant_readiness')
      or v_type in ('inspection','germination_check','grow_room_check','field_check','harvest_watch','harvest_horizon_marker','transplant_readiness','propagation_readiness')
      then 'inspect_assess'

    when v_action in ('clear','tree_removal','remove')
      or v_type in ('grounds_tree_work','venue_flooring_removal')
      or v_title like '%cut down%'
      or (v_title like '%remove%' and v_title like '%tree%')
      then 'clear_demolish'

    when v_action in ('build','install','hang')
      or v_type in ('infrastructure','venue_trim_fabrication','venue_trim_installation','venue_install','venue_flooring','venue_furnishings')
      then 'build_establish_structure'

    when v_action='water' or v_type='watering'
      then 'water_nourish'

    when v_action in ('spray','respray','manage_pests','pest_control')
      or v_type in ('spray','spraying','weed_control')
      then 'apply_treatment'

    when v_action in ('clean','sanitize','pressure_wash')
      or v_type in ('cleanup','venue_cleaning','exterior_cleaning','postharvest_setup')
      then 'clean_restore'

    when v_action='repair' or v_type in ('equipment_repair','raised_bed_repair','venue_plumbing','marshall_plumbing')
      then 'repair_restore'

    when v_title like 'divide %' or v_title like '% divide %'
      then 'divide_reestablish_belowground'

    else null
  end;

  source := case when operation_class is null then null else 'operation_resolver_v1' end;
  return next;
end;
$function$;

with resolved as (
  select t.id,r.operation_class,r.source
  from atlas.tasks t
  cross join lateral atlas.task_operation_class_v1(t.title,t.action_key,t.task_type,t.metadata) r
)
update atlas.tasks t
set operation_class=r.operation_class,
    operation_class_source=r.source
from resolved r
where r.id=t.id
  and t.operation_class_source is distinct from 'manual'
  and (t.operation_class is distinct from r.operation_class or t.operation_class_source is distinct from r.source);
