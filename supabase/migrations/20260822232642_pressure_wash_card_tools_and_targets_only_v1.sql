do $block$
declare
  v_farm_id uuid;
  v_queue_key text := 'anna_gentle_pressure_wash_aug_2026';
begin
  select id into v_farm_id from atlas.farms where lower(name)='elm farm' limit 1;
  if v_farm_id is null then
    raise exception 'Elm Farm not found' using errcode='P0002';
  end if;

  update atlas.tasks t
  set note = null,
      metadata = (
        coalesce(t.metadata,'{}'::jsonb)
        - 'why_now'
        - 'state_effect'
        - 'execution_how'
        - 'execution_done_when'
        - 'gentle_cedar_method'
        - 'venue_reset_ready_label'
        - 'venue_reset_ready_result'
        - 'venue_reset_method_lines_are_information'
        - 'venue_reset_method_semantics_source'
      ) || jsonb_build_object(
        'pressure_wash_card_content_contract','tools_and_spray_location_only_v1'
      ),
      updated_at = now()
  where t.farm_id=v_farm_id
    and t.action_key='pressure_wash'
    and t.metadata->>'pressure_wash_collection_key'=v_queue_key;

  update atlas.planned_work_occurrences po
  set task_payload = jsonb_set(
        coalesce(po.task_payload,'{}'::jsonb) - 'note',
        '{metadata}',
        (
          coalesce(po.task_payload->'metadata','{}'::jsonb)
          - 'why_now'
          - 'state_effect'
          - 'execution_how'
          - 'execution_done_when'
          - 'gentle_cedar_method'
          - 'venue_reset_ready_label'
          - 'venue_reset_ready_result'
          - 'venue_reset_method_lines_are_information'
          - 'venue_reset_method_semantics_source'
        ) || jsonb_build_object(
          'pressure_wash_card_content_contract','tools_and_spray_location_only_v1'
        ),
        true
      ),
      updated_at=now()
  where po.id in (
    select q.planned_occurrence_id
    from atlas.task_release_queue_items q
    where q.farm_id=v_farm_id
      and q.queue_key=v_queue_key
  );

  update atlas.task_execution_checklist_items item
  set metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object(
        'retired','true',
        'retired_reason','pressure_wash_card_tools_and_targets_only_v1'
      ),
      required=false,
      checked=false,
      updated_at=now()
  where item.task_id in (
    select t.id
    from atlas.tasks t
    where t.farm_id=v_farm_id
      and t.action_key='pressure_wash'
      and t.metadata->>'pressure_wash_collection_key'=v_queue_key
  )
    and coalesce(item.metadata->>'venue_reset_component','false')='true';
end;
$block$;
