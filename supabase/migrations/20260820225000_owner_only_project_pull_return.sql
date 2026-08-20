create or replace function atlas.return_project_item_to_pool_v1(
  p_task_id uuid,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_item_id uuid;
  v_item atlas.project_pull_items%rowtype;
begin
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  v_item_id := nullif(v_task.metadata->>'project_pull_item_id','')::uuid;
  if v_item_id is null then raise exception 'Task is not a project pull task.' using errcode='22023'; end if;

  select * into v_item from atlas.project_pull_items where id=v_item_id for update;

  if auth.uid() is null or not atlas.is_farm_owner(v_task.farm_id) then
    raise exception 'Only a farm owner may return project work to the pool.' using errcode='42501';
  end if;

  if v_task.status not in ('open','blocked') then
    raise exception 'Only open or blocked work can return to the pool.' using errcode='55000';
  end if;

  update atlas.tasks
  set status='archived',due_date=null,completed_at=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('project_pull_returned_at',now(),'project_pull_return_note',p_note),
      updated_at=now()
  where id=v_task.id;

  update atlas.project_pull_selections
  set state='returned',returned_at=now(),note=coalesce(p_note,note)
  where task_id=v_task.id and state='selected';

  update atlas.project_pull_items
  set status='available',active_task_id=null,updated_at=now()
  where id=v_item.id;

  return jsonb_build_object('contractVersion','project_pull_return_v1','projectItemId',v_item.id,'taskId',v_task.id,'state','available');
end;
$function$;

comment on function atlas.return_project_item_to_pool_v1(uuid,text) is
'Owner-only project-pool return. Assigned workers can report execution outcomes but cannot decide that selected project work should leave their day.';
