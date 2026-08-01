begin;

alter table atlas.notification_outbox
  drop constraint if exists notification_outbox_category_check;

alter table atlas.notification_outbox
  add constraint notification_outbox_category_check
  check (category = any (array[
    'rhythm_warning'::text,
    'rhythm_due'::text,
    'rhythm_failure'::text,
    'unlock'::text,
    'owner_decision'::text,
    'other_player_result'::text,
    'dependency_ready'::text,
    'system_test'::text
  ]));

create or replace function atlas.web_push_default_categories_v1()
returns jsonb
language sql
immutable
set search_path = pg_catalog, atlas
as $function$
  select '{
    "rhythm_warning": true,
    "rhythm_due": true,
    "rhythm_failure": true,
    "unlock": true,
    "owner_decision": true,
    "other_player_result": false,
    "dependency_ready": true
  }'::jsonb
$function$;

comment on function atlas.web_push_default_categories_v1() is
  'Default direct-push categories. dependency_ready is an actionable Work handoff after a real task result or elapsed farm-process clock; it is not Bell history.';

do $postcondition$
declare
  v_constraint text;
  v_defaults jsonb;
begin
  select pg_get_constraintdef(oid)
  into v_constraint
  from pg_constraint
  where conrelid = 'atlas.notification_outbox'::regclass
    and conname = 'notification_outbox_category_check';

  v_defaults := atlas.web_push_default_categories_v1();

  if v_constraint not like '%dependency_ready%'
    or coalesce((v_defaults ->> 'dependency_ready')::boolean, false) is not true
  then
    raise exception 'dependency_ready notification category postcondition failed.';
  end if;
end;
$postcondition$;

commit;
