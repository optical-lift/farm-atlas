begin;

create or replace function atlas.finalize_weed_worker_display_title_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_subject text;
begin
  if lower(coalesce(new.action_key,'')) not in ('weed','weeding')
     and lower(coalesce(new.task_type,'')) not in ('weed','weeding')
     and lower(coalesce(new.metadata->>'work_route','')) not in ('weed','weeding')
     and coalesce(new.metadata->>'maintenance_type','')<>'weed'
     and coalesce(new.metadata->>'weed_card_managed','false')<>'true'
     and lower(coalesce(new.title,'')) not like 'weed %' then
    return new;
  end if;

  v_subject:=nullif(btrim(coalesce(new.metadata->>'display_subject','')),'');
  if v_subject is not null then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'display_action','Weed',
      'display_title',v_subject
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists zzzzzz_finalize_weed_worker_display_title_v1 on atlas.tasks;
create trigger zzzzzz_finalize_weed_worker_display_title_v1
before insert or update on atlas.tasks
for each row execute function atlas.finalize_weed_worker_display_title_v1();

update atlas.tasks set updated_at=now() where title='Weed MG11' and status in ('open','blocked');

commit;
