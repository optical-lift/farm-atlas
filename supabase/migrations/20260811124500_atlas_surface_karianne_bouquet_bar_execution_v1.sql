do $migration$
declare
  v_task_ids uuid[];
  v_parent_ids uuid[];
  v_task_id uuid;
  v_parent_id uuid;
begin
  select array_agg(t.id), array_agg(t.parent_task_id)
    into v_task_ids, v_parent_ids
  from atlas.tasks t
  join atlas.tasks parent on parent.id=t.parent_task_id
  where t.farm_id=(select id from atlas.farms where stable_key='elm_farm' limit 1)
    and replace(t.title,'’','''')='Prepare Karianne''s garden for Thursday bouquet-bar harvest'
    and t.status in ('open','blocked')
    and parent.task_scope='project'
    and coalesce((parent.metadata->>'project_tracking_only')::boolean,false)=true;

  if coalesce(array_length(v_task_ids,1),0) <> 1 then
    raise exception 'Expected exactly one Karianne execution task under a tracking-only project task; found %.', coalesce(array_length(v_task_ids,1),0);
  end if;

  v_task_id := v_task_ids[1];
  v_parent_id := v_parent_ids[1];

  if not exists (
    select 1 from atlas.project_task_links ptl
    where ptl.task_id=v_task_id
      and ptl.parent_task_id=v_parent_id
  ) then
    raise exception 'Karianne execution task is missing its project hierarchy link.';
  end if;

  update atlas.tasks
  set parent_task_id=null,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_surface_repaired_at', now(),
        'execution_surface_repair', 'detached_from_tracking_only_task_parent_project_hierarchy_preserved'
      )
  where id=v_task_id;
end;
$migration$;
