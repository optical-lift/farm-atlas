-- Atlas Tending — Phase 4.5 harvest-first prepared read model.
-- Tending is an alternate presentation of canonical released tasks, never a second task system.

create or replace function atlas.tending_action_key_v1(
  p_action_key text,
  p_work_class text,
  p_task_type text,
  p_title text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  with source as (
    select lower(concat_ws(' ',
      nullif(p_metadata->>'display_action',''),
      nullif(p_metadata->>'task_style',''),
      nullif(p_action_key,''),
      nullif(p_work_class,''),
      nullif(p_task_type,''),
      nullif(p_title,'')
    )) as text_value
  )
  select case
    when text_value ~ '(harvest[ _-]?watch)' then 'harvest_watch'
    when text_value ~ '(germination|germinat)' then 'germination_check'
    when text_value ~ '(observe|observation|verify|check|inspect|walk|readiness|ready window)' then 'observe'
    when text_value ~ '(harvest|gather|cut flowers|cut stems)' then 'harvest'
    when text_value ~ '(pinch)' then 'pinch'
    when text_value ~ '(thin)' then 'thin'
    when text_value ~ '(weed|hoe)' then 'weed'
    when text_value ~ '(clear|reset|turnover)' then 'clear'
    when text_value ~ '(transplant)' then 'transplant'
    when text_value ~ '(sow|seed)' then 'sow'
    when text_value ~ '(plant)' then 'plant'
    when text_value ~ '(water|irrigat)' then 'water'
    when text_value ~ '(stake|support|net)' then 'support'
    when text_value ~ '(prune|trim)' then 'prune'
    when text_value ~ '(pot[ _-]?up)' then 'pot_up'
    when text_value ~ '(harden)' then 'harden_off'
    else regexp_replace(
      coalesce(nullif(lower(p_action_key),''),nullif(lower(p_work_class),''),nullif(lower(p_task_type),''),'tend'),
      '[^a-z0-9]+','_','g'
    )
  end
  from source
$function$;

create or replace function atlas.tending_action_label_v1(p_gate_key text)
returns text
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case p_gate_key
    when 'harvest_watch' then 'Check harvest'
    when 'germination_check' then 'Check germination'
    when 'observe' then 'Check'
    when 'harvest' then 'Harvest'
    when 'weed' then 'Weed'
    when 'clear' then 'Clear'
    when 'transplant' then 'Transplant'
    when 'sow' then 'Sow'
    when 'plant' then 'Plant'
    when 'pinch' then 'Pinch'
    when 'water' then 'Water'
    when 'support' then 'Support'
    when 'thin' then 'Thin'
    when 'prune' then 'Prune'
    when 'pot_up' then 'Pot up'
    when 'harden_off' then 'Harden off'
    else initcap(replace(coalesce(p_gate_key,'tend'),'_',' '))
  end
$function$;

create or replace function atlas.tending_unlock_label_v1(
  p_unlock_text text,
  p_metadata jsonb,
  p_crop_label text
)
returns text
language plpgsql
immutable
set search_path to pg_catalog, atlas
as $function$
declare
  v_match text[];
  v_label text;
begin
  if nullif(btrim(p_unlock_text),'') is not null then
    v_match := regexp_match(
      p_unlock_text,
      '(?:Sow|Plant|Transplant)[[:space:]]+([^·—]+?)(?:[[:space:]]*·|[[:space:]]*—|$)',
      'i'
    );
    if v_match is not null then
      v_label := btrim(v_match[1]);
      v_label := regexp_replace(v_label, '[[:space:]]+in[[:space:]]+[A-Z0-9].*$', '', 'i');
    end if;
  end if;

  return coalesce(
    nullif(v_label,''),
    nullif(p_metadata->>'crop_variety',''),
    nullif(p_metadata->>'variety',''),
    nullif(p_metadata->>'crop',''),
    nullif(p_crop_label,'')
  );
end
$function$;

create or replace function atlas.tending_section_v1(p_gate_key text,p_lifecycle_status text)
returns text
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case
    when p_gate_key='harvest' then 'harvest_now'
    when p_gate_key in ('observe','germination_check','harvest_watch') then 'needs_a_look'
    when p_gate_key in ('sow','plant','transplant','pot_up','harden_off') or p_lifecycle_status='planned' then 'unlock_next'
    else 'protect_harvests'
  end
$function$;

create or replace view atlas.tending_task_object_v1
with (security_invoker=true)
as
with direct_links as (
  select x.task_id,x.object_id
  from atlas.task_objects x
), maintenance_links as (
  select t.id as task_id,mo.object_id
  from atlas.tasks t
  join atlas.maintenance_objects mo
    on t.generated_from='maintenance_weeding_collection'
   and t.generated_from_id=mo.id
), combined as (
  select * from direct_links
  union
  select * from maintenance_links
)
select distinct task_id,object_id
from combined;
