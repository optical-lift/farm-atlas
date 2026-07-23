-- Keep crop specifications in the reusable planting card and leave only the
-- actual worker instruction in the ordinary Details section.
do $migration$
declare
  v_task_id uuid;
  v_occurrence_id uuid;
begin
  select t.id,t.planned_occurrence_id
  into v_task_id,v_occurrence_id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where f.stable_key='elm_farm'
    and t.metadata->>'task_key'='anna_20260722_transplant_marigolds_fr3'
    and t.status in ('open','blocked')
  order by t.created_at desc
  limit 1;

  if v_task_id is not null then
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'detail_heading','Planting instruction',
        'detail_lines',jsonb_build_array('Plant the hardened-off marigolds.'),
        'display_detail','Plant the hardened-off marigolds in Field Row 3.'
      ),
      updated_at=now()
    where id=v_task_id;
  end if;

  if v_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set task_payload=jsonb_set(
          task_payload,
          '{metadata}',
          coalesce(task_payload->'metadata','{}'::jsonb)
            || jsonb_build_object(
              'detail_heading','Planting instruction',
              'detail_lines',jsonb_build_array('Plant the hardened-off marigolds.'),
              'display_detail','Plant the hardened-off marigolds in Field Row 3.'
            ),
          true
        ),
        updated_at=now()
    where id=v_occurrence_id;
  end if;
end
$migration$;
