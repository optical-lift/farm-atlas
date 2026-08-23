create table if not exists atlas.work_result_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid references atlas.tasks(id) on delete cascade,
  planned_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete cascade,
  field_key text not null,
  label text not null,
  value_kind text not null,
  unit text,
  required boolean not null default false,
  choices jsonb not null default '[]'::jsonb,
  sort_order integer not null default 100,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_result_fields_one_carrier check (
    (task_id is not null and planned_occurrence_id is null)
    or (task_id is null and planned_occurrence_id is not null)
  ),
  constraint work_result_fields_key_nonempty check (btrim(field_key) <> ''),
  constraint work_result_fields_label_nonempty check (btrim(label) <> ''),
  constraint work_result_fields_kind_check check (value_kind in ('text','number','boolean','date','choice')),
  constraint work_result_fields_choices_array check (jsonb_typeof(choices)='array')
);

create unique index if not exists work_result_fields_task_key_uq
  on atlas.work_result_fields(task_id,field_key) where task_id is not null;
create unique index if not exists work_result_fields_occurrence_key_uq
  on atlas.work_result_fields(planned_occurrence_id,field_key) where planned_occurrence_id is not null;
create index if not exists work_result_fields_task_sort_idx
  on atlas.work_result_fields(task_id,sort_order,field_key) where task_id is not null;

create table if not exists atlas.work_result_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  submitted_by_membership_id uuid references atlas.farm_memberships(id) on delete restrict,
  effective_membership_id uuid references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  submitted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint work_result_submissions_idempotency_nonempty check (btrim(idempotency_key) <> ''),
  constraint work_result_submissions_farm_idempotency_uq unique(farm_id,idempotency_key)
);
create index if not exists work_result_submissions_task_time_idx
  on atlas.work_result_submissions(task_id,submitted_at desc);

create table if not exists atlas.work_result_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  submission_id uuid not null references atlas.work_result_submissions(id) on delete cascade,
  field_id uuid not null references atlas.work_result_fields(id) on delete restrict,
  field_key text not null,
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  unit text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint work_result_values_submission_field_uq unique(submission_id,field_key),
  constraint work_result_values_one_typed_value check (
    num_nonnulls(value_text,value_numeric,value_boolean,value_date)=1
  )
);
create index if not exists work_result_values_task_submission_idx
  on atlas.work_result_values(task_id,submission_id);

create or replace function atlas.block_work_result_history_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $function$
begin
  raise exception 'Work result history is append-only; record a new submission instead of rewriting evidence.';
end;
$function$;

drop trigger if exists work_result_submissions_append_only_v1 on atlas.work_result_submissions;
create trigger work_result_submissions_append_only_v1
before update or delete on atlas.work_result_submissions
for each row execute function atlas.block_work_result_history_mutation_v1();

drop trigger if exists work_result_values_append_only_v1 on atlas.work_result_values;
create trigger work_result_values_append_only_v1
before update or delete on atlas.work_result_values
for each row execute function atlas.block_work_result_history_mutation_v1();

alter table atlas.work_result_fields enable row level security;
alter table atlas.work_result_submissions enable row level security;
alter table atlas.work_result_values enable row level security;

drop policy if exists work_result_fields_member_read on atlas.work_result_fields;
create policy work_result_fields_member_read on atlas.work_result_fields
for select to authenticated using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists work_result_submissions_member_read on atlas.work_result_submissions;
create policy work_result_submissions_member_read on atlas.work_result_submissions
for select to authenticated using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists work_result_values_member_read on atlas.work_result_values;
create policy work_result_values_member_read on atlas.work_result_values
for select to authenticated using (atlas.current_farm_role(farm_id) is not null);

revoke all on atlas.work_result_fields from anon, public;
revoke all on atlas.work_result_submissions from anon, public;
revoke all on atlas.work_result_values from anon, public;
revoke insert,update,delete on atlas.work_result_fields from authenticated;
revoke insert,update,delete on atlas.work_result_submissions from authenticated;
revoke insert,update,delete on atlas.work_result_values from authenticated;
grant select on atlas.work_result_fields to authenticated;
grant select on atlas.work_result_submissions to authenticated;
grant select on atlas.work_result_values to authenticated;

create or replace function atlas.copy_work_result_fields_to_task_v1(p_occurrence_id uuid,p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_count integer:=0;
begin
  insert into atlas.work_result_fields(
    organization_id,farm_id,task_id,field_key,label,value_kind,unit,required,choices,sort_order,source,metadata
  )
  select organization_id,farm_id,p_task_id,field_key,label,value_kind,unit,required,choices,sort_order,
         'occurrence_copy_v1',coalesce(metadata,'{}'::jsonb)||jsonb_build_object('sourceOccurrenceId',p_occurrence_id,'sourceFieldId',id)
  from atlas.work_result_fields
  where planned_occurrence_id=p_occurrence_id
  on conflict (task_id,field_key) where task_id is not null do update set
    label=excluded.label,
    value_kind=excluded.value_kind,
    unit=excluded.unit,
    required=excluded.required,
    choices=excluded.choices,
    sort_order=excluded.sort_order,
    source=excluded.source,
    metadata=atlas.work_result_fields.metadata||excluded.metadata,
    updated_at=now();
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

create or replace function atlas.copy_work_result_fields_on_task_insert_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.planned_occurrence_id is not null then
    perform atlas.copy_work_result_fields_to_task_v1(new.planned_occurrence_id,new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_copy_work_result_fields_on_task_insert_v1 on atlas.tasks;
create trigger trg_copy_work_result_fields_on_task_insert_v1
after insert on atlas.tasks
for each row execute function atlas.copy_work_result_fields_on_task_insert_v1();

create or replace function atlas.work_result_contract_v1(p_task_id uuid,p_effective_membership_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_context jsonb;
  v_fields jsonb;
  v_submissions jsonb;
begin
  v_context:=atlas.task_execution_checklist_context_v1(p_task_id,p_effective_membership_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'fieldKey',f.field_key,
    'label',f.label,
    'valueKind',f.value_kind,
    'unit',f.unit,
    'required',f.required,
    'choices',f.choices,
    'sortOrder',f.sort_order
  ) order by f.sort_order,f.field_key),'[]'::jsonb)
  into v_fields
  from atlas.work_result_fields f
  where f.task_id=p_task_id;

  select coalesce(jsonb_agg(s.payload order by s.submitted_at desc),'[]'::jsonb)
  into v_submissions
  from (
    select sub.submitted_at,
      jsonb_build_object(
        'submissionId',sub.id,
        'submittedAt',sub.submitted_at,
        'values',coalesce((
          select jsonb_object_agg(v.field_key,
            case
              when v.value_text is not null then to_jsonb(v.value_text)
              when v.value_numeric is not null then to_jsonb(v.value_numeric)
              when v.value_boolean is not null then to_jsonb(v.value_boolean)
              when v.value_date is not null then to_jsonb(v.value_date::text)
              else 'null'::jsonb
            end
          )
          from atlas.work_result_values v where v.submission_id=sub.id
        ),'{}'::jsonb)
      ) as payload
    from atlas.work_result_submissions sub
    where sub.task_id=p_task_id
    order by sub.submitted_at desc
    limit 25
  ) s;

  return jsonb_build_object(
    'taskId',p_task_id,
    'farmId',v_context->>'farmId',
    'fields',v_fields,
    'submissions',v_submissions
  );
end;
$function$;

create or replace function atlas.record_work_result_submission_v1(
  p_task_id uuid,
  p_values jsonb,
  p_idempotency_key text,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_org_id uuid;
  v_submission_id uuid;
  v_actor_membership_id uuid;
  v_effective_membership_id uuid;
  v_field atlas.work_result_fields%rowtype;
  v_raw jsonb;
  v_text text;
  v_num numeric;
  v_bool boolean;
  v_date date;
  v_unknown text;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'Idempotency key is required.' using errcode='22023';
  end if;
  if p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'Result values must be an object.' using errcode='22023';
  end if;

  v_context:=atlas.task_execution_checklist_context_v1(p_task_id,p_effective_membership_id);
  v_actor_membership_id:=(v_context->>'actorMembershipId')::uuid;
  v_effective_membership_id:=(v_context->>'effectiveMembershipId')::uuid;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  select organization_id into v_org_id from atlas.farms where id=v_task.farm_id;

  if exists(select 1 from atlas.work_result_submissions where farm_id=v_task.farm_id and idempotency_key=p_idempotency_key) then
    return atlas.work_result_contract_v1(p_task_id,p_effective_membership_id);
  end if;

  if not exists(select 1 from atlas.work_result_fields where task_id=p_task_id) then
    raise exception 'This task has no structured result contract.' using errcode='22023';
  end if;

  select key into v_unknown
  from jsonb_object_keys(p_values) key
  where not exists(select 1 from atlas.work_result_fields f where f.task_id=p_task_id and f.field_key=key)
  limit 1;
  if v_unknown is not null then
    raise exception 'Unknown result field: %',v_unknown using errcode='22023';
  end if;

  for v_field in select * from atlas.work_result_fields where task_id=p_task_id order by sort_order,field_key loop
    if v_field.required and not (p_values ? v_field.field_key) then
      raise exception 'Required result field is missing: %',v_field.label using errcode='22023';
    end if;
    if not (p_values ? v_field.field_key) then continue; end if;
    v_raw:=p_values->v_field.field_key;
    if v_raw='null'::jsonb then
      if v_field.required then raise exception 'Required result field is blank: %',v_field.label using errcode='22023'; end if;
      continue;
    end if;
    if v_field.value_kind in ('text','choice','date') and jsonb_typeof(v_raw)<>'string' then
      raise exception 'Result field % must be text.',v_field.label using errcode='22023';
    end if;
    if v_field.value_kind='number' and jsonb_typeof(v_raw) not in ('number','string') then
      raise exception 'Result field % must be numeric.',v_field.label using errcode='22023';
    end if;
    if v_field.value_kind='boolean' and jsonb_typeof(v_raw)<>'boolean' then
      raise exception 'Result field % must be true or false.',v_field.label using errcode='22023';
    end if;
    if v_field.value_kind in ('text','choice','date') then
      v_text:=btrim(v_raw#>>'{}');
      if v_text='' then
        if v_field.required then raise exception 'Required result field is blank: %',v_field.label using errcode='22023'; end if;
        continue;
      end if;
    end if;
    if v_field.value_kind='choice' and not exists(select 1 from jsonb_array_elements_text(v_field.choices) c where c=v_text) then
      raise exception 'Result field % has an invalid choice.',v_field.label using errcode='22023';
    end if;
  end loop;

  insert into atlas.work_result_submissions(
    organization_id,farm_id,task_id,submitted_by_membership_id,effective_membership_id,idempotency_key,metadata
  ) values(v_org_id,v_task.farm_id,p_task_id,v_actor_membership_id,v_effective_membership_id,p_idempotency_key,jsonb_build_object('source','structured_work_result_v1'))
  returning id into v_submission_id;

  for v_field in select * from atlas.work_result_fields where task_id=p_task_id order by sort_order,field_key loop
    if not (p_values ? v_field.field_key) then continue; end if;
    v_raw:=p_values->v_field.field_key;
    if v_raw='null'::jsonb then continue; end if;
    v_text:=null; v_num:=null; v_bool:=null; v_date:=null;
    if v_field.value_kind in ('text','choice') then
      v_text:=nullif(btrim(v_raw#>>'{}'),'');
    elsif v_field.value_kind='number' then
      begin v_num:=(v_raw#>>'{}')::numeric; exception when others then raise exception 'Result field % must be numeric.',v_field.label using errcode='22023'; end;
    elsif v_field.value_kind='boolean' then
      v_bool:=(v_raw#>>'{}')::boolean;
    elsif v_field.value_kind='date' then
      begin v_date:=(v_raw#>>'{}')::date; exception when others then raise exception 'Result field % must be a date.',v_field.label using errcode='22023'; end;
    end if;
    if num_nonnulls(v_text,v_num,v_bool,v_date)=0 then continue; end if;
    insert into atlas.work_result_values(
      organization_id,farm_id,task_id,submission_id,field_id,field_key,value_text,value_numeric,value_boolean,value_date,unit,metadata
    ) values(v_org_id,v_task.farm_id,p_task_id,v_submission_id,v_field.id,v_field.field_key,v_text,v_num,v_bool,v_date,v_field.unit,'{}'::jsonb);
  end loop;

  return atlas.work_result_contract_v1(p_task_id,p_effective_membership_id);
end;
$function$;

revoke all on function atlas.work_result_contract_v1(uuid,uuid) from public,anon;
revoke all on function atlas.record_work_result_submission_v1(uuid,jsonb,text,uuid) from public,anon;
grant execute on function atlas.work_result_contract_v1(uuid,uuid) to authenticated;
grant execute on function atlas.record_work_result_submission_v1(uuid,jsonb,text,uuid) to authenticated;