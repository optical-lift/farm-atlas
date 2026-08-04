-- The task decorator reads explicit date commitments from metadata.

begin;

create or replace function atlas.plan_fixed_assigned_worker_occurrence_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_definition_key text,
  p_policy_key text,
  p_occurrence_key text,
  p_title text,
  p_task_type text,
  p_due_date date,
  p_priority text,
  p_action_key text,
  p_series_key text,
  p_effort_units numeric,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_occurrence_id uuid;
  v_task_metadata jsonb;
begin
  v_task_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'anna_task', true,
    'assigned_to', 'Anna',
    'assignee_key', 'anna',
    'executor_worker_key', 'anna',
    'executor_membership_id', p_membership_id,
    'work_route', p_action_key,
    'work_rhythm', initcap(p_action_key),
    'schedule_source', 'fixed_calendar',
    'completion_independent_schedule', true,
    'recreate_on_done', false,
    'date_commitment', 'hard_date',
    'commitment_kind', 'hard_date'
  );

  v_occurrence_id := atlas.plan_work_occurrence_v1(
    p_farm_id,p_definition_key,p_policy_key,p_occurrence_key,p_title,p_task_type,
    p_due_date,'recurring_task',null,'time_window',14,8,
    jsonb_build_object(
      'farm_id',p_farm_id,'title',p_title,'task_type',p_task_type,
      'status','open','priority',p_priority,'due_date',p_due_date,
      'action_key',p_action_key,'work_class','standard','work_lane','rhythm',
      'commitment_kind','hard_date','task_scope','farm_operation',
      'origin_kind','generated','generated_from','recurring_task',
      'task_series_key',p_series_key,'engine_instance_key',p_occurrence_key,
      'visibility_scope','assigned_worker','assigned_membership_id',p_membership_id,
      'assigned_user_id',p_user_id,'metadata',v_task_metadata
    ),
    '{}'::jsonb,
    jsonb_build_object('automatic',true,'source_kind','recurring_task'),
    p_due_date,
    jsonb_build_object(
      'scheduleSource','fixed_calendar',
      'completionIndependentSchedule',true,
      'dateBehavior','hard_date'
    )
  );

  update atlas.planned_work_occurrences
  set work_lane='rhythm',commitment_kind='hard_date',effort_units=p_effort_units,
      task_payload=coalesce(task_payload,'{}'::jsonb)||jsonb_build_object(
        'commitment_kind','hard_date',
        'metadata',coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'date_commitment','hard_date','commitment_kind','hard_date'
        )
      ),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('dateBehavior','hard_date'),
      updated_at=now()
  where id=v_occurrence_id;

  return v_occurrence_id;
end;
$function$;

create or replace function atlas.hydrate_fixed_calendar_task_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_occurrence atlas.planned_work_occurrences%rowtype;
begin
  if new.planned_occurrence_id is null then return new; end if;

  select * into v_occurrence
  from atlas.planned_work_occurrences
  where id=new.planned_occurrence_id;

  if v_occurrence.id is null
     or coalesce(v_occurrence.metadata->>'scheduleSource','')<>'fixed_calendar'
  then
    return new;
  end if;

  new.task_series_key:=coalesce(new.task_series_key,nullif(v_occurrence.task_payload->>'task_series_key',''));
  new.engine_instance_key:=coalesce(new.engine_instance_key,nullif(v_occurrence.task_payload->>'engine_instance_key',''),v_occurrence.occurrence_key);
  new.commitment_kind:='hard_date';
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'task_series_key',new.task_series_key,
    'engine_instance_key',new.engine_instance_key,
    'schedule_source','fixed_calendar',
    'completion_independent_schedule',true,
    'date_behavior','hard_date',
    'date_commitment','hard_date',
    'commitment_kind','hard_date'
  );
  return new;
end;
$function$;

do $reconcile$
declare
  v_farm_id uuid;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';

  update atlas.planned_work_occurrences occurrence
  set commitment_kind='hard_date',
      task_payload=coalesce(occurrence.task_payload,'{}'::jsonb)||jsonb_build_object(
        'commitment_kind','hard_date',
        'metadata',coalesce(occurrence.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'date_commitment','hard_date','commitment_kind','hard_date'
        )
      ),
      metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object('dateBehavior','hard_date'),
      updated_at=now()
  where occurrence.farm_id=v_farm_id
    and occurrence.work_definition_id in (
      select id from atlas.work_definitions
      where farm_id=v_farm_id and stable_key in (
        'anna_water_indoor_plants_saturday',
        'anna_water_outdoor_planters_every_4_days',
        'anna_harvest_thursday_weekly_2026'
      )
    );

  update atlas.tasks task
  set commitment_kind='hard_date',
      metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
        'schedule_source','fixed_calendar',
        'completion_independent_schedule',true,
        'date_behavior','hard_date',
        'date_commitment','hard_date',
        'commitment_kind','hard_date'
      ),
      updated_at=now()
  from atlas.planned_work_occurrences occurrence
  where task.planned_occurrence_id=occurrence.id
    and occurrence.farm_id=v_farm_id
    and occurrence.work_definition_id in (
      select id from atlas.work_definitions
      where farm_id=v_farm_id and stable_key in (
        'anna_water_indoor_plants_saturday',
        'anna_water_outdoor_planters_every_4_days',
        'anna_harvest_thursday_weekly_2026'
      )
    );
end;
$reconcile$;

revoke all on function atlas.hydrate_fixed_calendar_task_identity_v1() from public,anon,authenticated;
revoke all on function atlas.plan_fixed_assigned_worker_occurrence_v1(
  uuid,uuid,uuid,text,text,text,text,text,date,text,text,text,numeric,jsonb
) from public,anon,authenticated;
grant execute on function atlas.plan_fixed_assigned_worker_occurrence_v1(
  uuid,uuid,uuid,text,text,text,text,text,date,text,text,text,numeric,jsonb
) to service_role;

commit;
