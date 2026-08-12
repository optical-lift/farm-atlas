-- Worker-visible tasks may carry rich Owner reasoning in canonical storage, but
-- their literal execution identity may never be vague. This first guard rejects
-- objectively low-information authoring without requiring every legacy generator
-- to have completed the richer execution-contract migration yet.

create or replace function atlas.worker_task_authoring_violations_v1(
  p_title text,
  p_metadata jsonb,
  p_visibility_scope text
)
returns text[]
language plpgsql
immutable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_violations text[]:='{}'::text[];
  v_title text:=btrim(coalesce(p_title,''));
  v_action text:=btrim(coalesce(p_metadata->>'display_action',''));
  v_subject text:=btrim(coalesce(p_metadata->>'display_subject',''));
  v_execution_do text:=btrim(coalesce(p_metadata->>'execution_do',''));
  v_execution_how text:=lower(coalesce(p_metadata->>'execution_how',''));
begin
  if p_visibility_scope is distinct from 'assigned_worker' then
    return v_violations;
  end if;

  if v_title='' then
    v_violations:=array_append(v_violations,'missing_title');
  elsif lower(v_title) ~ '^(task|work|do this|handle it)\s*([—–\-:·]|$)' then
    v_violations:=array_append(v_violations,'vague_title');
  end if;

  if lower(v_execution_do) in ('task','work','do this','do the task','complete task','complete the task','handle it') then
    v_violations:=array_append(v_violations,'vague_execution_do');
  end if;

  if v_execution_how ~ 'if practical|if possible|if available|if convenient|when convenient' then
    v_violations:=array_append(v_violations,'handwave_execution_condition');
  end if;

  if v_action<>'' and lower(v_action) in ('task','work','do this','handle') then
    v_violations:=array_append(v_violations,'vague_display_action');
  end if;

  if v_subject<>'' and lower(v_subject) in ('task','work','thing','it') then
    v_violations:=array_append(v_violations,'vague_display_subject');
  end if;

  return v_violations;
end;
$function$;

revoke all on function atlas.worker_task_authoring_violations_v1(text,jsonb,text) from public,anon,authenticated;
grant execute on function atlas.worker_task_authoring_violations_v1(text,jsonb,text) to service_role;

create or replace function atlas.guard_worker_task_authoring_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_violations text[];
begin
  v_violations:=atlas.worker_task_authoring_violations_v1(new.title,coalesce(new.metadata,'{}'::jsonb),new.visibility_scope);
  if coalesce(array_length(v_violations,1),0)>0 then
    raise exception 'Worker task execution contract rejected: %',array_to_string(v_violations,', ')
      using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.guard_worker_task_authoring_v1() from public,anon,authenticated;
grant execute on function atlas.guard_worker_task_authoring_v1() to service_role;

drop trigger if exists guard_worker_task_authoring_v1 on atlas.tasks;
create trigger guard_worker_task_authoring_v1
before insert or update of title,metadata,visibility_scope on atlas.tasks
for each row
when (new.visibility_scope='assigned_worker')
execute function atlas.guard_worker_task_authoring_v1();

-- Audit richer execution fields separately while legacy generators are normalized.
-- These are quality gaps, not an excuse to expose Owner notes as fallback prose.
create or replace view atlas.v_worker_task_execution_contract_audit as
select
  task.id as task_id,
  task.farm_id,
  task.title,
  task.status,
  task.task_type,
  task.assigned_membership_id,
  task.due_date,
  array_remove(array[
    case when nullif(btrim(coalesce(task.metadata->>'display_action','')),'') is null then 'missing_display_action' end,
    case when nullif(btrim(coalesce(task.metadata->>'display_subject','')),'') is null then 'missing_display_subject' end,
    case when nullif(btrim(coalesce(task.metadata->>'execution_do','')),'') is null then 'missing_execution_do' end,
    case when nullif(btrim(coalesce(task.metadata->>'execution_how','')),'') is null then 'missing_execution_how' end
  ],null) as quality_gaps,
  atlas.worker_task_authoring_violations_v1(task.title,coalesce(task.metadata,'{}'::jsonb),task.visibility_scope) as hard_violations
from atlas.tasks task
where task.visibility_scope='assigned_worker'
  and task.status in ('open','blocked');

revoke all on atlas.v_worker_task_execution_contract_audit from public,anon,authenticated;
grant select on atlas.v_worker_task_execution_contract_audit to service_role;
