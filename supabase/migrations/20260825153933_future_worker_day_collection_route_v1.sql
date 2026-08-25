create or replace function atlas.owner_worker_day_plan_choreographed_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_plan jsonb;
  v_planned_occurrences jsonb := '[]'::jsonb;
begin
  if p_day < v_today then
    return atlas.worker_historical_day_plan_v1(p_farm_id,p_membership_id,p_day);
  end if;

  v_plan := atlas.owner_worker_day_plan_choreographed_live_v1(p_farm_id,p_membership_id,p_day);

  if p_day > v_today then
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id', 'planned-occurrence:' || occurrence.id::text,
          'kind', 'automatic',
          'sourceKind', 'rhythm',
          'sourceId', occurrence.id,
          'title', occurrence.title,
          'note', case when occurrence.source_kind='farm_round' then nullif(occurrence.task_payload->'metadata'->>'display_detail','') else null end,
          'status', occurrence.state,
          'expectedActiveMinutes', null,
          'dayWindow', atlas.worker_task_day_window_v1(
            occurrence.task_payload->>'action_key',
            occurrence.task_payload->>'task_type',
            coalesce(occurrence.task_payload->'metadata','{}'::jsonb)
          ),
          'workOrderNumber', atlas.worker_task_order_v1(
            occurrence.task_payload->>'action_key',
            occurrence.task_payload->>'task_type',
            coalesce(occurrence.task_payload->'metadata','{}'::jsonb)
          ),
          'workRoute', nullif(occurrence.task_payload->'metadata'->>'work_route',''),
          'environment', nullif(occurrence.task_payload->'metadata'->>'environment',''),
          'location', coalesce(
            nullif(occurrence.task_payload->'metadata'->>'display_location',''),
            nullif(occurrence.task_payload->'metadata'->>'collection_zone',''),
            nullif(occurrence.task_payload->'metadata'->>'collection_label','')
          ),
          'automatic', true,
          'requiresOwnerApproval', false,
          'conditional', false,
          'commitmentKind', nullif(occurrence.task_payload->>'commitment_kind',''),
          'reason', case when occurrence.source_kind='farm_round'
            then 'Planned Farm Round parent; due stewardship members remain grouped beneath this occurrence.'
            else 'Planned recurring occurrence; task releases through its governed recurrence.' end
        ))
        order by
          atlas.worker_task_order_v1(
            occurrence.task_payload->>'action_key',
            occurrence.task_payload->>'task_type',
            coalesce(occurrence.task_payload->'metadata','{}'::jsonb)
          ),
          occurrence.title,
          occurrence.id
      ),
      '[]'::jsonb
    )
    into v_planned_occurrences
    from atlas.planned_work_occurrences occurrence
    where occurrence.farm_id = p_farm_id
      and occurrence.planned_due_date = p_day
      and occurrence.state = 'planned'
      and occurrence.released_task_id is null
      and occurrence.parent_occurrence_id is null
      and occurrence.source_kind in ('recurring_task','farm_round')
      and occurrence.task_payload->>'assigned_membership_id' = p_membership_id::text;

    if jsonb_array_length(v_planned_occurrences) > 0 then
      v_plan := jsonb_set(
        v_plan,
        '{automaticWork}',
        coalesce(v_plan->'automaticWork','[]'::jsonb) || v_planned_occurrences,
        true
      );
    end if;
  end if;

  return v_plan;
end;
$function$;
