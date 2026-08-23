do $migration$
declare
  v_farm_id uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_water_bucket_id uuid;
begin
  select id into v_water_bucket_id from atlas.resources where farm_id=v_farm_id and stable_key='chicken_water_bucket' limit 1;
  if v_water_bucket_id is null then return; end if;

  update atlas.task_resource_requirements rr
  set requirement_role='check_first',updated_at=now()
  from atlas.tasks t
  where rr.task_id=t.id and t.farm_id=v_farm_id and rr.resource_id=v_water_bucket_id
    and rr.requirement_role='required' and rr.requirement_source='system_generated';

  update atlas.planned_work_occurrences o
  set relation_payload=jsonb_set(
        coalesce(o.relation_payload,'{}'::jsonb),
        '{task_resource_requirements}',
        coalesce((
          select jsonb_agg(
            case
              when item->>'resource_id'=v_water_bucket_id::text and item->>'requirement_role'='required'
                then jsonb_set(item,'{requirement_role}','"check_first"'::jsonb,true)
              else item
            end
          )
          from jsonb_array_elements(coalesce(o.relation_payload->'task_resource_requirements','[]'::jsonb)) item
        ),'[]'::jsonb),
        true
      ),
      updated_at=now()
  where o.farm_id=v_farm_id
    and exists (
      select 1 from atlas.work_definitions d
      where d.id=o.work_definition_id and d.stable_key='anna_chicken_chore_daily_except_sunday'
    );
end;
$migration$;