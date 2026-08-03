update atlas.tasks t
set metadata = jsonb_set(
      coalesce(t.metadata, '{}'::jsonb),
      '{display_location}',
      to_jsonb(coalesce(
        (
          select o.label
          from atlas.task_objects task_object
          join atlas.growing_objects o on o.id = task_object.object_id
          where task_object.task_id = t.id
          order by
            case when task_object.role = 'target' then 0 else 1 end,
            o.sort_order nulls last,
            o.label
          limit 1
        ),
        (
          select z.label
          from atlas.zones z
          where z.id = t.zone_id
        )
      )),
      true
    ),
    updated_at = t.updated_at
where t.parent_task_id is null
  and t.metadata ? 'lunar_family'
  and coalesce(
        nullif(t.metadata ->> 'display_location', ''),
        nullif(t.metadata ->> 'location_label', ''),
        nullif(t.metadata ->> 'collection_zone', '')
      ) is null
  and coalesce(
        (
          select o.label
          from atlas.task_objects task_object
          join atlas.growing_objects o on o.id = task_object.object_id
          where task_object.task_id = t.id
          order by
            case when task_object.role = 'target' then 0 else 1 end,
            o.sort_order nulls last,
            o.label
          limit 1
        ),
        (
          select z.label
          from atlas.zones z
          where z.id = t.zone_id
        )
      ) is not null;
