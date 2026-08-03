create or replace function atlas.collapse_new_germination_duplicate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_key text;
  v_canonical uuid;
  v_is_germination boolean;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.status not in ('open','blocked') then return new; end if;

  v_is_germination :=
    coalesce(new.task_type = 'germination_check', false)
    or coalesce(new.action_key = 'germination_check', false)
    or coalesce(new.metadata->>'task_style' = 'germination_check', false)
    or lower(coalesce(new.title, '')) like '%germin%';

  if not v_is_germination then return new; end if;

  v_key := atlas.germination_variety_key_v1(new.metadata, new.title);

  select t.id into v_canonical
  from atlas.tasks t
  where t.id <> new.id
    and t.farm_id = new.farm_id
    and t.status in ('open','blocked')
    and t.due_date is not distinct from new.due_date
    and (
      coalesce(t.task_type = 'germination_check', false)
      or coalesce(t.action_key = 'germination_check', false)
      or coalesce(t.metadata->>'task_style' = 'germination_check', false)
      or lower(coalesce(t.title, '')) like '%germin%'
    )
    and atlas.germination_variety_key_v1(t.metadata, t.title) = v_key
  order by case when t.generated_from = 'crop_cycle_milestone' then 0 else 1 end,
           t.created_at,
           t.id
  limit 1;

  if v_canonical is not null then
    update atlas.tasks
    set status = 'archived',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'archived_reason', 'Duplicate germination event for same variety and due date',
          'canonical_germination_task_id', v_canonical,
          'archived_at', now()
        ),
        updated_at = now()
    where id = new.id;
  else
    update atlas.tasks
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'germination_variety_key', v_key,
          'collection_member_key', 'germination:' || v_key || ':' || coalesce(due_date::text, 'open')
        ),
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end
$function$;

update atlas.tasks
set metadata = metadata
      - 'germination_variety_key'
      - 'canonical_germination_task_id'
      - 'archived_reason'
      - 'archived_at'
      - 'collection_member_key',
    updated_at = now()
where metadata ? 'germination_variety_key'
  and not (
    coalesce(task_type = 'germination_check', false)
    or coalesce(action_key = 'germination_check', false)
    or coalesce(metadata->>'task_style' = 'germination_check', false)
    or lower(coalesce(title, '')) like '%germin%'
  )
  and coalesce(metadata->>'collection_member_key','') like 'germination:%';
