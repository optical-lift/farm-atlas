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
with linked as (
  select
    t.id,
    t.status,
    t.due_date,
    t.created_at,
    atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata) as gate_key,
    atlas.tending_action_label_v1(atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata)) as gate_label,
    exists(select 1 from atlas.task_crop_cycles tc where tc.task_id=t.id) as has_cycle_link,
    exists(select 1 from atlas.task_crop_cycles tc where tc.task_id=t.id and tc.crop_cycle_id=p_crop_cycle_id) as matches_cycle
  from atlas.tasks t
  join atlas.tending_task_object_v1 x on x.task_id=t.id and x.object_id=p_object_id
  where t.status<>'archived'
    and t.created_at>=now()-interval '180 days'
    and coalesce(t.due_date,current_date)<=current_date+interval '240 days'
), relevant as (
  select *
  from linked
  where gate_key in ('weed','clear','sow','plant','transplant','pot_up','harden_off','germination_check','observe','pinch','water','support','thin','prune','harvest_watch','harvest')
    and (not has_cycle_link or matches_cycle or id=p_current_task_id)
), ranked as (
  select *,row_number() over (
    order by
      case when status='done' then 0 when id=p_current_task_id then 1 when status='blocked' then 3 else 2 end,
      due_date nulls last,
      case gate_key
        when 'weed' then 10 when 'clear' then 11 when 'pot_up' then 15 when 'harden_off' then 16
        when 'sow' then 20 when 'plant' then 21 when 'transplant' then 22
        when 'germination_check' then 30 when 'observe' then 31
        when 'pinch' then 40 when 'thin' then 41 when 'water' then 42 when 'support' then 43 when 'prune' then 44
        when 'harvest_watch' then 50 when 'harvest' then 51 else 60 end,
      created_at,id
  ) as gate_order
  from relevant
), task_gates as (
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'key',gate_key,
      'label',gate_label,
      'status',case when status='done' then 'complete' when id=p_current_task_id then 'current' when status='blocked' then 'blocked' else 'future' end,
      'taskId',case when id=p_current_task_id then id end,
      'dueDate',due_date
    )) order by gate_order),'[]'::jsonb) as gates,
    bool_or(gate_key='harvest') as has_harvest
  from ranked
  where gate_order<=8
)
select case
  when p_harvest_on is not null and not coalesce(has_harvest,false)
    then gates||jsonb_build_array(jsonb_build_object('key','harvest','label','Harvest','status','future','dueDate',p_harvest_on))
  else gates
end
from task_gates
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
    from jsonb_array_elements(coalesce(p_gates,'[]'::jsonb)) gate
    where gate->>'status' not in ('complete','skipped')
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
