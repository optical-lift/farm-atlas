create or replace function atlas.sync_task_crop_cycle_links_v1(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_count integer := 0;
  v_cycle_id uuid;
  v_role text := 'affects';
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return 0; end if;

  if v_task.generated_from='crop_cycle_milestone' and v_task.generated_from_id is not null then
    v_cycle_id := v_task.generated_from_id;
    v_role := case
      when v_task.action_key='harvest_watch' then 'harvests'
      when v_task.action_key='clear_bed' then 'clears'
      when v_task.action_key='germination_check' then 'observes'
      else 'affects' end;
  elsif nullif(v_task.metadata->>'crop_cycle_id','') is not null then
    begin v_cycle_id := (v_task.metadata->>'crop_cycle_id')::uuid; exception when others then v_cycle_id := null; end;
    v_role := coalesce(
      nullif(v_task.metadata->>'crop_cycle_role',''),
      case
        when v_task.generated_from='germination_harvest_watch' then 'observes'
        when v_task.generated_from in ('germination_patch','germination_thinning') then 'affects'
        else 'affects'
      end
    );
  end if;

  if v_cycle_id is not null and exists(select 1 from atlas.crop_cycles where id=v_cycle_id) then
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source)
    values(v_task.id,v_cycle_id,v_role,'confirmed','task_source_reference')
    on conflict do nothing;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  with task_objects_for_task as (
    select object_id from atlas.task_objects where task_id=v_task.id
  ), candidate as (
    select cc.id,
      count(*) over () as candidate_count
    from atlas.crop_cycles cc
    join task_objects_for_task x on x.object_id=cc.object_id
    where cc.lifecycle_status='active'
      and nullif(v_task.metadata->>'crop_label','') is not null
      and cc.crop_profile_id = atlas.resolve_crop_profile_id_v1(v_task.metadata->>'crop_label',v_task.metadata->>'variety')
  )
  select id into v_cycle_id from candidate where candidate_count=1 limit 1;

  if v_cycle_id is not null then
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source)
    values(v_task.id,v_cycle_id,'affects','inferred','unique_profile_match')
    on conflict do nothing;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$function$;

update atlas.tasks
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'crop_cycle_role', case when generated_from='germination_harvest_watch' then 'observes' else 'affects' end
    ),
    updated_at = now()
where generated_from in ('germination_patch','germination_thinning','germination_harvest_watch')
  and nullif(metadata->>'crop_cycle_id','') is not null;

delete from atlas.task_crop_cycles link
using atlas.tasks task
where task.id = link.task_id
  and task.generated_from='germination_harvest_watch'
  and link.role='affects'
  and exists (
    select 1
    from atlas.task_crop_cycles correct_link
    where correct_link.task_id=link.task_id
      and correct_link.crop_cycle_id=link.crop_cycle_id
      and correct_link.role='observes'
  );

do $validation$
begin
  if exists (
    select 1
    from atlas.tasks task
    join atlas.task_crop_cycles link on link.task_id=task.id
    where task.generated_from='germination_harvest_watch'
    group by task.id, link.crop_cycle_id
    having bool_or(link.role='observes') = false
       or bool_or(link.role='affects') = true
  ) then
    raise exception 'A germination harvest-window task has an incorrect crop-cycle role.';
  end if;
end;
$validation$;
