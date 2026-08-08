create table if not exists atlas.operation_classes (
  stable_key text primary key,
  label text not null,
  operation_domain text not null,
  definition text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into atlas.operation_classes (stable_key,label,operation_domain,definition) values
  ('establish_aboveground','Establish aboveground','cultivation','Establish a crop or plant whose working target is primarily aboveground growth, including sowing, potting up, set-out, and ordinary transplanting.'),
  ('establish_belowground','Establish belowground','cultivation','Establish a root, bulb, corm, tuber, or rhizome in its growing position without division being the primary operation.'),
  ('divide_reestablish_belowground','Divide + re-establish belowground','cultivation','Separate an existing belowground perennial structure and re-establish the resulting divisions.'),
  ('remove_uproot','Remove / uproot','removal','Remove unwanted living growth by pulling, thinning, or uprooting.'),
  ('cut_separate','Cut / separate','removal','Sever aboveground material by pruning, mowing, deadheading, cutting back, or comparable cutting work.'),
  ('cultivate_prepare','Cultivate / prepare','cultivation','Prepare or cultivate soil or a growing surface for a subsequent operation.'),
  ('harvest_aboveground','Harvest aboveground','harvest','Remove flowers, foliage, fruit, seed heads, or other primarily aboveground harvest material.'),
  ('harvest_belowground','Harvest belowground','harvest','Lift, dig, or pull a root, bulb, corm, tuber, or rhizome as harvest.'),
  ('retain_strengthen','Retain / strengthen','care','Support, stake, secure, protect, or otherwise strengthen an existing condition without replacing it.'),
  ('inspect_assess','Inspect / assess','assessment','Observe, inspect, verify, or assess readiness or state before choosing a later operation.'),
  ('clear_demolish','Clear / demolish','removal','Remove an established physical or biological structure so the prior condition no longer remains.'),
  ('build_establish_structure','Build / establish structure','construction','Create, install, or establish a durable physical structure.'),
  ('water_nourish','Water / nourish','care','Supply water or comparable direct nourishment to sustain present growth.'),
  ('apply_treatment','Apply treatment','care','Apply a spray, pest-control measure, or comparable treatment to an existing condition.'),
  ('clean_restore','Clean / restore','care','Clean, sanitize, wash, or restore a surface or working environment.'),
  ('repair_restore','Repair / restore','construction','Repair a damaged or nonfunctioning physical object or system so it returns to service.')
on conflict (stable_key) do update
set label=excluded.label,
    operation_domain=excluded.operation_domain,
    definition=excluded.definition,
    active=true,
    updated_at=now();

alter table atlas.operation_classes enable row level security;
revoke all on atlas.operation_classes from public, anon, authenticated;
grant select on atlas.operation_classes to service_role;

alter table atlas.tasks
  add column if not exists operation_class text,
  add column if not exists operation_class_source text;

alter table atlas.tasks
  drop constraint if exists tasks_operation_class_fkey;
alter table atlas.tasks
  add constraint tasks_operation_class_fkey
  foreign key (operation_class) references atlas.operation_classes(stable_key);

create index if not exists tasks_active_operation_class_idx
  on atlas.tasks (farm_id, operation_class, status)
  where status in ('open','blocked') and operation_class is not null;

comment on column atlas.tasks.operation_class is 'Canonical operation-fitness class. Describes what operation the task performs; it is not a sky interpretation or workload unit.';
comment on column atlas.tasks.operation_class_source is 'Provenance for operation_class, currently manual or operation_resolver_v1.';

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

    when v_action in ('sow','sowing','seed','seed_sowing','seed_starting','propagation_start','propagate','pot_up','plant','planting','transplant','replant','set_out')
      or v_type in ('sowing','succession_sowing','seed_sowing','seed_starting','planting','transplanting','transplant','pot_up','propagation','propagation_start')
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

    when v_action in ('harvest','cut_flowers','bundle')
      or v_type in ('harvest','flower_harvest','postharvest_bundle')
      then 'harvest_aboveground'

    when v_action in ('dig','lift','pull_roots')
      or v_type in ('root_harvest','bulb_harvest')
      then 'harvest_belowground'

    when v_action in ('support','stake','secure')
      or v_type in ('support','staking')
      then 'retain_strengthen'

    when v_action in ('inspect','check','verify','field_check','germination_check','grow_room_check','harvest_watch','harvest_horizon','transplant_readiness')
      or v_type in ('inspection','germination_check','grow_room_check','field_check','harvest_watch','harvest_horizon_marker','transplant_readiness','propagation_readiness')
      then 'inspect_assess'

    when v_action in ('clear','tree_removal','remove')
      or v_type in ('grounds_tree_work','venue_flooring_removal')
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

revoke all on function atlas.task_operation_class_v1(text,text,text,jsonb) from public, anon, authenticated;

create or replace function atlas.normalize_task_operation_class_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_resolved record;
begin
  select * into v_resolved
  from atlas.task_operation_class_v1(new.title,new.action_key,new.task_type,new.metadata)
  limit 1;

  new.operation_class := v_resolved.operation_class;
  new.operation_class_source := v_resolved.source;

  if new.operation_class is null then
    new.metadata := coalesce(new.metadata,'{}'::jsonb) - 'operation_class' - 'operation_class_source';
  else
    new.metadata := jsonb_set(coalesce(new.metadata,'{}'::jsonb),'{operation_class}',to_jsonb(new.operation_class),true);
    new.metadata := jsonb_set(new.metadata,'{operation_class_source}',to_jsonb(new.operation_class_source),true);
  end if;
  return new;
end;
$function$;

revoke all on function atlas.normalize_task_operation_class_trigger_v1() from public, anon, authenticated;

drop trigger if exists zzz_normalize_task_operation_class_v1 on atlas.tasks;
create trigger zzz_normalize_task_operation_class_v1
before insert or update of title,action_key,task_type,metadata
on atlas.tasks
for each row execute function atlas.normalize_task_operation_class_trigger_v1();

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
  and (t.operation_class is distinct from r.operation_class or t.operation_class_source is distinct from r.source);
