create or replace function atlas.refresh_farm_round_preview_v1(p_parent_occurrence_id uuid)
returns text language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
declare v_preview text; v_parent_task uuid;
begin
  select string_agg(coalesce(o.task_payload->'metadata'->>'farm_round_display_label',o.title),' · ' order by
    coalesce((o.task_payload->'metadata'->>'farm_round_route_order')::int,999),coalesce((o.task_payload->'metadata'->>'farm_round_member_order')::int,999),o.id)
  into v_preview from atlas.planned_work_occurrences o where o.parent_occurrence_id=p_parent_occurrence_id and o.state<>'cancelled';
  select released_task_id into v_parent_task from atlas.planned_work_occurrences where id=p_parent_occurrence_id;
  update atlas.planned_work_occurrences set
    task_payload=jsonb_set(coalesce(task_payload,'{}'::jsonb),'{metadata}',coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object('display_detail',coalesce(v_preview,''),'farm_round_member_preview',coalesce(v_preview,'')),true),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundMemberPreview',coalesce(v_preview,'')),updated_at=now()
  where id=p_parent_occurrence_id;
  if v_parent_task is not null then
    update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_detail',coalesce(v_preview,''),'farm_round_member_preview',coalesce(v_preview,'')),updated_at=now()
    where id=v_parent_task;
  end if;
  return coalesce(v_preview,'');
end;
$function$;

create or replace function atlas.reconcile_farm_round_completion_v1(p_parent_occurrence_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
declare v_parent_task_id uuid; v_open integer:=0;
begin
  select released_task_id into v_parent_task_id from atlas.planned_work_occurrences where id=p_parent_occurrence_id and metadata->>'farmRoundParent'='true';
  if not found then return jsonb_build_object('state','not_farm_round'); end if;
  select count(*) into v_open from atlas.planned_work_occurrences where parent_occurrence_id=p_parent_occurrence_id and state not in ('completed','cancelled');
  if v_open=0 then
    if v_parent_task_id is not null then
      update atlas.tasks set status='done',completed_at=coalesce(completed_at,now()),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundAutoCompletedAt',now(),'farmRoundCompletionSource','all_member_occurrences_terminal'),updated_at=now()
      where id=v_parent_task_id and status in ('open','blocked');
    end if;
    update atlas.planned_work_occurrences set state='completed',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundAutoCompletedAt',now()),updated_at=now()
    where id=p_parent_occurrence_id and state not in ('completed','cancelled');
    update atlas.farm_round_occurrences set status='completed',parent_task_id=coalesce(parent_task_id,v_parent_task_id),updated_at=now() where parent_occurrence_id=p_parent_occurrence_id;
    return jsonb_build_object('state','completed','parentTaskId',v_parent_task_id);
  end if;
  if v_parent_task_id is not null then
    update atlas.tasks set status='open',completed_at=null,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundReopenedAt',now(),'farmRoundCompletionSource','member_still_open'),updated_at=now()
    where id=v_parent_task_id and status='done';
  end if;
  update atlas.planned_work_occurrences set state='released',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundReopenedAt',now()),updated_at=now()
  where id=p_parent_occurrence_id and state='completed';
  update atlas.farm_round_occurrences set status='open',parent_task_id=coalesce(parent_task_id,v_parent_task_id),updated_at=now() where parent_occurrence_id=p_parent_occurrence_id;
  return jsonb_build_object('state','open','parentTaskId',v_parent_task_id,'openMembers',v_open);
end;
$function$;

create or replace function atlas.complete_farm_round_parent_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
declare v_parent_occurrence_id uuid;
begin
  if new.parent_task_id is null or old.status is not distinct from new.status then return new; end if;
  select planned_occurrence_id into v_parent_occurrence_id from atlas.tasks where id=new.parent_task_id and task_type='stewardship_round';
  if v_parent_occurrence_id is not null then
    perform atlas.reconcile_farm_round_completion_v1(v_parent_occurrence_id);
    perform atlas.refresh_farm_round_preview_v1(v_parent_occurrence_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists complete_farm_round_parent_v1 on atlas.tasks;
create trigger complete_farm_round_parent_v1 after update of status on atlas.tasks
for each row when (new.parent_task_id is not null)
execute function atlas.complete_farm_round_parent_v1();

do $$ declare r record; begin
  for r in select parent_occurrence_id from atlas.farm_round_occurrences where parent_occurrence_id is not null loop
    perform atlas.refresh_farm_round_preview_v1(r.parent_occurrence_id);
    perform atlas.reconcile_farm_round_completion_v1(r.parent_occurrence_id);
  end loop;
end $$;
