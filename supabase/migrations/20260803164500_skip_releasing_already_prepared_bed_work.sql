create or replace function atlas.work_occurrence_existing_preparation_v1(
  p_occurrence_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  with occurrence as (
    select
      o.id,
      o.farm_id,
      o.created_at,
      o.planned_due_date,
      o.task_payload,
      o.relation_payload,
      lower(coalesce(
        nullif(o.task_payload ->> 'action_key', ''),
        nullif(o.task_payload #>> '{metadata,work_route}', ''),
        nullif(o.task_payload #>> '{metadata,display_action}', '')
      )) as action_kind,
      coalesce(
        nullif(o.task_payload #>> '{metadata,bed_object_id}', '')::uuid,
        nullif(o.task_payload #>> '{metadata,target_object_id}', '')::uuid,
        nullif(o.task_payload #>> '{metadata,object_id}', '')::uuid,
        (
          select nullif(link ->> 'object_id', '')::uuid
          from jsonb_array_elements(coalesce(o.relation_payload -> 'task_objects', '[]'::jsonb)) link
          where coalesce(link ->> 'role', '') in ('work_location', 'target', 'maintenance_object')
          order by case link ->> 'role' when 'work_location' then 0 when 'target' then 1 else 2 end
          limit 1
        )
      ) as object_id
    from atlas.planned_work_occurrences o
    where o.id = p_occurrence_id
  ), evidence as (
    select
      e.id,
      e.created_at,
      e.event_type,
      e.metadata
    from occurrence o
    join atlas.object_activity_events e
      on e.farm_id = o.farm_id
     and e.object_id = o.object_id
    where o.action_kind in ('prep', 'clear and prepare', 'clear_and_prepare', 'bed_prep', 'prepare')
      and o.object_id is not null
      and e.created_at >= o.created_at
      and e.created_at::date <= o.planned_due_date
      and e.event_type in ('weeded_reset', 'bed_reset', 'prepared', 'cleared_prepared')
      and lower(coalesce(e.metadata ->> 'ready_for_sowing', 'false')) in ('true', 'yes', '1')
    order by e.created_at desc, e.id desc
    limit 1
  )
  select jsonb_build_object(
    'satisfied', exists(select 1 from evidence),
    'objectId', (select object_id from occurrence),
    'eventId', (select id from evidence),
    'eventType', (select event_type from evidence),
    'completedAt', (select created_at from evidence),
    'source', case when exists(select 1 from evidence) then 'object_activity_ready_for_sowing' else null end
  );
$$;

revoke all on function atlas.work_occurrence_existing_preparation_v1(uuid) from public;
grant execute on function atlas.work_occurrence_existing_preparation_v1(uuid) to authenticated;

do $$
declare
  v_oid oid;
  v_definition text;
  v_patched text;
begin
  select p.oid
  into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.proname = 'release_eligible_work_v1'
    and pg_get_function_identity_arguments(p.oid) = 'p_farm_id uuid, p_as_of_date date, p_limit integer'
  limit 1;

  if v_oid is null then
    raise exception 'atlas.release_eligible_work_v1(uuid,date,integer) was not found';
  end if;

  v_definition := pg_get_functiondef(v_oid);

  if position('v_existing_satisfaction jsonb;' in v_definition) = 0 then
    v_patched := replace(
      v_definition,
      E'  v_close_time time;\nbegin',
      E'  v_close_time time;\n  v_existing_satisfaction jsonb;\nbegin'
    );
    if v_patched = v_definition then
      raise exception 'Could not add existing-satisfaction variable to release_eligible_work_v1';
    end if;
    v_definition := v_patched;
  end if;

  if position('work_occurrence_existing_preparation_v1(v_row.id)' in v_definition) = 0 then
    v_patched := replace(
      v_definition,
      E'  loop\n    exit when v_released >= v_limit;',
      E'  loop\n    exit when v_released >= v_limit;\n\n    v_existing_satisfaction := atlas.work_occurrence_existing_preparation_v1(v_row.id);\n    if coalesce((v_existing_satisfaction ->> ''satisfied'')::boolean, false) then\n      update atlas.planned_work_occurrences\n      set state = ''completed'',\n          gate_satisfied_at = coalesce(gate_satisfied_at, (v_existing_satisfaction ->> ''completedAt'')::timestamptz, now()),\n          metadata = coalesce(metadata, ''{}''::jsonb) || jsonb_build_object(\n            ''completedByExistingObjectState'', true,\n            ''completionEvidenceEventId'', v_existing_satisfaction ->> ''eventId'',\n            ''completionEvidenceEventType'', v_existing_satisfaction ->> ''eventType'',\n            ''completionEvidenceSource'', v_existing_satisfaction ->> ''source'',\n            ''completionEvidenceAt'', v_existing_satisfaction ->> ''completedAt'',\n            ''suppressedReleaseAt'', now()\n          ),\n          updated_at = now()\n      where id = v_row.id;\n      continue;\n    end if;'
    );
    if v_patched = v_definition then
      raise exception 'Could not add existing-preparation guard to release_eligible_work_v1';
    end if;
    v_definition := v_patched;
  end if;

  execute v_definition;
end;
$$;
