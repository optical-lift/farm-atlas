create or replace function atlas.reconcile_active_weeding_tasks_for_object(p_object_id uuid)
returns integer language plpgsql security definer set search_path=atlas,public as $$
declare v_keep uuid;v_archived integer:=0;
begin
  if p_object_id is null then return 0; end if;
  select t.id into v_keep
  from atlas.tasks t join atlas.task_objects tx on tx.task_id=t.id
  where tx.object_id=p_object_id and t.status in ('open','blocked') and t.task_type<>'production_field_care'
    and (lower(t.title) like 'weed%' or lower(coalesce(t.metadata->>'work_route','')) in ('weed','weeding') or t.metadata->>'work_collection_key'='weeding' or t.metadata->>'maintenance_type'='weed')
  order by case when t.generated_from='maintenance_weeding_collection' then 0 else 1 end,
    case when nullif(t.metadata->>'maintenance_object_id','') is not null then 0 else 1 end,
    t.due_date asc nulls last,t.created_at asc,t.id
  limit 1;
  if v_keep is null then return 0; end if;
  update atlas.tasks t set status='archived',metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('archived_reason','duplicate_active_weeding_task_same_object','canonical_weeding_task_id',v_keep,'archived_at',now()),updated_at=now()
  where t.id<>v_keep and t.status in ('open','blocked') and t.task_type<>'production_field_care'
    and exists(select 1 from atlas.task_objects tx where tx.task_id=t.id and tx.object_id=p_object_id)
    and (lower(t.title) like 'weed%' or lower(coalesce(t.metadata->>'work_route','')) in ('weed','weeding') or t.metadata->>'work_collection_key'='weeding' or t.metadata->>'maintenance_type'='weed');
  get diagnostics v_archived=row_count; return v_archived;
end; $$;