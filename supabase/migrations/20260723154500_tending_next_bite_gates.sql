-- Tending next-bite refinement.
-- Keep the current canonical task as the only clickable action while projecting the
-- crop-specific steps between today's work and harvest from crop-cycle facts.

update atlas.crop_profiles
set metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{tending_gate_template}',
  '[
    {"key":"sow","label":"Sow","order":20,"basis":"anchor","offsetDays":0},
    {"key":"germination_check","label":"Check germination","order":30,"basis":"germination_end","offsetDays":0},
    {"key":"pinch","label":"Pinch","order":40,"basis":"anchor","offsetDays":28},
    {"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}
  ]'::jsonb,
  true
)
where stable_key in ('zinnia_cut_flower_generic','cosmos_cut_flower');

update atlas.crop_profiles
set metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{tending_gate_template}',
  '[
    {"key":"sow","label":"Sow","order":20,"basis":"anchor","offsetDays":0},
    {"key":"germination_check","label":"Check germination","order":30,"basis":"germination_end","offsetDays":0},
    {"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}
  ]'::jsonb,
  true
)
where lower(crop_label) like '%sunflower%';

create or replace function atlas.tending_profile_gates_v1(
  p_crop_cycle_id uuid,
  p_harvest_on date default null
)
returns table(
  gate_key text,
  gate_label text,
  gate_order integer,
  due_date date
)
language sql
stable
security invoker
set search_path to pg_catalog, atlas
as $function$
with cycle_context as (
  select
    cc.crop_label,
    cc.variety,
    cc.cycle_state,
    cc.lifecycle_status,
    cc.sown_date,
    cc.planted_date,
    cc.expected_germination_end,
    coalesce(p_harvest_on,cc.expected_harvest_watch_start) as harvest_on,
    coalesce(
      case
        when coalesce(cc.metadata->>'planned_date','') ~ '^\d{4}-\d{2}-\d{2}$'
          then (cc.metadata->>'planned_date')::date
      end,
      cc.sown_date,
      cc.planted_date
    ) as anchor_on,
    cp.default_planting_method,
    cp.days_to_germination_max,
    cp.metadata as profile_metadata,
    lower(concat_ws(' ',cc.crop_label,cc.variety)) as crop_text
  from atlas.crop_cycles cc
  left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
  where cc.id=p_crop_cycle_id
), template_source as (
  select
    c.*,
    case
      when jsonb_typeof(c.profile_metadata->'tending_gate_template')='array'
        then c.profile_metadata->'tending_gate_template'
      when c.crop_text ~ '(zinnia|cosmos)'
        then '[
          {"key":"sow","label":"Sow","order":20,"basis":"anchor","offsetDays":0},
          {"key":"germination_check","label":"Check germination","order":30,"basis":"germination_end","offsetDays":0},
          {"key":"pinch","label":"Pinch","order":40,"basis":"anchor","offsetDays":28},
          {"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}
        ]'::jsonb
      when c.crop_text ~ '(sunflower)'
        then '[
          {"key":"sow","label":"Sow","order":20,"basis":"anchor","offsetDays":0},
          {"key":"germination_check","label":"Check germination","order":30,"basis":"germination_end","offsetDays":0},
          {"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}
        ]'::jsonb
      when c.default_planting_method='transplant'
        then '[
          {"key":"plant","label":"Plant","order":20,"basis":"anchor","offsetDays":0},
          {"key":"observe","label":"Check establishment","order":30,"basis":"anchor","offsetDays":7},
          {"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}
        ]'::jsonb
      when c.default_planting_method='direct_sow' or c.sown_date is not null
        then '[
          {"key":"sow","label":"Sow","order":20,"basis":"anchor","offsetDays":0},
          {"key":"germination_check","label":"Check germination","order":30,"basis":"germination_end","offsetDays":0},
          {"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}
        ]'::jsonb
      else '[{"key":"harvest","label":"Harvest","order":60,"basis":"harvest_start","offsetDays":0}]'::jsonb
    end as gate_template
  from cycle_context c
), expanded as (
  select
    t.*,
    j.value as gate,
    coalesce((j.value->>'offsetDays')::integer,0) as offset_days
  from template_source t
  cross join lateral jsonb_array_elements(t.gate_template) as j(value)
)
select
  gate->>'key' as gate_key,
  coalesce(nullif(gate->>'label',''),atlas.tending_action_label_v1(gate->>'key')) as gate_label,
  coalesce((gate->>'order')::integer,60) as gate_order,
  case gate->>'basis'
    when 'anchor' then anchor_on + offset_days
    when 'germination_end' then coalesce(
      expected_germination_end,
      anchor_on + coalesce(days_to_germination_max,7) + offset_days
    )
    when 'harvest_start' then harvest_on + offset_days
    else null
  end as due_date
from expanded
where nullif(gate->>'key','') is not null
$function$;

create or replace function atlas.tending_gates_v1(
  p_object_id uuid,
  p_crop_cycle_id uuid,
  p_current_task_id uuid,
  p_harvest_on date
)
returns jsonb
language sql
stable
security invoker
set search_path to pg_catalog, atlas
as $function$
with cycle_context as (
  select cc.cycle_state,cc.lifecycle_status,cc.sown_date,cc.planted_date
  from atlas.crop_cycles cc
  where cc.id=p_crop_cycle_id
), linked_raw as (
  select
    t.id,
    t.status,
    t.due_date,
    t.created_at,
    atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata) as gate_key,
    atlas.tending_action_label_v1(
      atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata)
    ) as gate_label,
    exists(select 1 from atlas.task_crop_cycles tc where tc.task_id=t.id) as has_cycle_link,
    exists(
      select 1 from atlas.task_crop_cycles tc
      where tc.task_id=t.id and tc.crop_cycle_id=p_crop_cycle_id
    ) as matches_cycle
  from atlas.tasks t
  join atlas.tending_task_object_v1 x on x.task_id=t.id and x.object_id=p_object_id
  where t.status<>'archived'
    and t.created_at>=now()-interval '180 days'
    and coalesce(t.due_date,current_date)<=current_date+interval '240 days'
), linked as (
  select
    r.*,
    case
      when r.gate_key='weed' and c.lifecycle_status='planned'
        and c.sown_date is null and c.planted_date is null then 10
      when r.gate_key='clear' and c.lifecycle_status='planned'
        and c.sown_date is null and c.planted_date is null then 11
      when r.gate_key in ('sow','plant','transplant','pot_up','harden_off') then 20
      when r.gate_key in ('germination_check','observe') then 30
      when r.gate_key='weed' then 40
      when r.gate_key='pinch' then 41
      when r.gate_key='thin' then 42
      when r.gate_key='water' then 43
      when r.gate_key='support' then 44
      when r.gate_key='prune' then 45
      when r.gate_key='harvest_watch' then 55
      when r.gate_key='harvest' then 60
      when r.gate_key='clear' then 70
      else 50
    end as gate_order
  from linked_raw r
  cross join cycle_context c
), relevant as (
  select *
  from linked
  where gate_key in (
    'weed','clear','sow','plant','transplant','pot_up','harden_off',
    'germination_check','observe','pinch','water','support','thin','prune',
    'harvest_watch','harvest'
  )
    and (not has_cycle_link or matches_cycle or id=p_current_task_id)
), actual_ranked as (
  select
    r.*,
    row_number() over (
      partition by r.gate_key
      order by
        case
          when r.id=p_current_task_id then 0
          when r.status='done' then 1
          when r.status='blocked' then 2
          else 3
        end,
        r.due_date nulls last,
        r.created_at,
        r.id
    ) as same_gate_rank
  from relevant r
), actual_unique as (
  select
    gate_key,
    gate_label,
    gate_order,
    due_date,
    case
      when status='done' then 'complete'
      when id=p_current_task_id then case when status='blocked' then 'blocked' else 'current' end
      when status='blocked' then 'blocked'
      else 'future'
    end as gate_status,
    case when id=p_current_task_id then id end as task_id
  from actual_ranked
  where same_gate_rank=1
), current_position as (
  select coalesce(max(gate_order) filter (where task_id=p_current_task_id),0) as current_gate_order
  from actual_unique
), template_unique as (
  select
    p.gate_key,
    p.gate_label,
    p.gate_order,
    p.due_date,
    case
      when p.gate_key in ('sow','plant','transplant')
        and (c.sown_date is not null or c.planted_date is not null) then 'complete'
      when p.gate_key='germination_check'
        and lower(coalesce(c.cycle_state,'')) in (
          'germinated','growing','established','harvest_watch','harvesting','declining'
        ) then 'complete'
      when pos.current_gate_order>p.gate_order then 'complete'
      else 'future'
    end as gate_status,
    null::uuid as task_id
  from atlas.tending_profile_gates_v1(p_crop_cycle_id,p_harvest_on) p
  cross join cycle_context c
  cross join current_position pos
  where not exists(select 1 from actual_unique a where a.gate_key=p.gate_key)
), combined as (
  select * from actual_unique
  union all
  select * from template_unique
), ordered as (
  select
    c.*,
    row_number() over(order by c.gate_order,c.due_date nulls last,c.gate_key) as display_order
  from combined c
)
select coalesce(
  jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'key',gate_key,
      'label',gate_label,
      'status',gate_status,
      'taskId',task_id,
      'dueDate',due_date
    ))
    order by display_order
  ),
  '[]'::jsonb
)
from ordered
where display_order<=10
$function$;

create or replace function atlas.tending_card_json_v2(
  p_task_id uuid,
  p_object_id uuid,
  p_gates jsonb,
  p_is_actionable boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path to pg_catalog, atlas
as $function$
select jsonb_strip_nulls(jsonb_build_object(
  'bedKey',x.object_key,
  'bedLabel',x.object_label,
  'zoneKey',x.zone_key,
  'zoneLabel',x.zone_label,
  'objectType',x.object_type,
  'objectMode',x.object_mode,
  'cropCycleId',x.crop_cycle_id,
  'cropLabel',x.crop_display_label,
  'cropStage',x.cycle_state,
  'cropLifecycleStatus',x.lifecycle_status,
  'harvestMetricType',case
    when x.harvest_pattern in ('single_cut','seasonal_single_flush') then 'harvest'
    when x.harvest_pattern in ('cut_and_come_again','repeat_pick','seasonal_repeat_cut') then 'harvest_rounds'
    else 'harvest_opportunities'
  end,
  'harvestCeiling',x.harvest_ceiling,
  'harvestForecast',coalesce(x.harvest_forecast,x.harvest_ceiling),
  'actualHarvestCount',x.actual_harvest_count,
  'actualMarketableStems',x.actual_marketable_stems,
  'firstOrNextHarvestOn',x.expected_harvest_watch_start,
  'harvestWindowEndsOn',x.expected_harvest_watch_end,
  'clockBasis',case when x.sown_date is not null or x.planted_date is not null then 'confirmed' else 'forecast' end,
  'sownOn',x.sown_date,
  'plantedOn',x.planted_date,
  'currentGate',jsonb_build_object(
    'key',x.gate_key,
    'label',x.gate_label,
    'status',case when x.task_status='blocked' then 'blocked' else 'current' end,
    'taskId',x.task_id,
    'dueDate',x.due_date
  ),
  'gates',coalesce(p_gates,'[]'::jsonb),
  'remainingGateCount',(
    select count(*)::integer
    from jsonb_array_elements(coalesce(p_gates,'[]'::jsonb)) as gate(value)
    where gate.value->>'status' not in ('complete','skipped')
  ),
  'stepsToHarvestCount',(
    select count(*)::integer
    from jsonb_array_elements(coalesce(p_gates,'[]'::jsonb)) as gate(value)
    where gate.value->>'key'<>'harvest'
      and gate.value->>'status' not in ('complete','skipped')
  ),
  'totalStepCount',(
    select count(*)::integer
    from jsonb_array_elements(coalesce(p_gates,'[]'::jsonb)) as gate(value)
    where gate.value->>'key'<>'harvest' and gate.value->>'status'<>'skipped'
  ),
  'currentStepNumber',(
    select count(*)::integer
    from jsonb_array_elements(coalesce(p_gates,'[]'::jsonb)) with ordinality as gate(value,ordinality)
    where gate.value->>'key'<>'harvest'
      and gate.ordinality <= coalesce((
        select current_gate.ordinality
        from jsonb_array_elements(coalesce(p_gates,'[]'::jsonb)) with ordinality
          as current_gate(value,ordinality)
        where current_gate.value->>'status'='current'
        limit 1
      ),0)
  ),
  'releasedTaskId',x.task_id,
  'taskTitle',x.task_title,
  'taskDueDate',x.due_date,
  'taskEffortMinutes',x.estimated_minutes,
  'unlockLabel',x.crop_display_label,
  'forecastLoss',x.forecast_loss,
  'nextLossOn',x.next_loss_on,
  'requiresObservation',x.gate_key in ('observe','germination_check','harvest_watch'),
  'isActionableNow',p_is_actionable,
  'sectionKey',x.section_key,
  'miniGame',null
))
from atlas.tending_task_track_v1 x
where x.task_id=p_task_id and x.object_id=p_object_id
limit 1
$function$;

revoke all on function atlas.tending_profile_gates_v1(uuid,date) from public,anon;

comment on function atlas.tending_profile_gates_v1(uuid,date) is
  'Crop-profile harvest path for Tending. Produces dated future stages without creating duplicate tasks.';
comment on function atlas.tending_gates_v1(uuid,uuid,uuid,date) is
  'Merges real canonical tasks with crop-profile stages so a bed never visually jumps from preparation straight to harvest.';
