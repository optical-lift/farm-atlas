create table atlas.work_execution_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid references atlas.tasks(id) on delete cascade,
  planned_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete cascade,
  component_key text not null,
  component_kind text not null,
  component_role text,
  label text not null,
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  unit text,
  reference_kind text,
  reference_id uuid,
  resource_id uuid references atlas.resources(id) on delete restrict,
  object_id uuid references atlas.growing_objects(id) on delete restrict,
  zone_id uuid references atlas.zones(id) on delete restrict,
  required boolean not null default true,
  sort_order integer not null default 100,
  source text not null default 'structured_work_v1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_execution_components_one_carrier check (
    (task_id is not null and planned_occurrence_id is null)
    or (task_id is null and planned_occurrence_id is not null)
  ),
  constraint work_execution_components_kind_nonempty check (btrim(component_kind) <> ''),
  constraint work_execution_components_key_nonempty check (btrim(component_key) <> ''),
  constraint work_execution_components_label_nonempty check (btrim(label) <> ''),
  constraint work_execution_components_reference_pair check (
    (reference_kind is null and reference_id is null)
    or (reference_kind is not null and reference_id is not null)
  )
);

create unique index work_execution_components_task_key_uidx
  on atlas.work_execution_components(task_id,component_key)
  where task_id is not null;
create unique index work_execution_components_occurrence_key_uidx
  on atlas.work_execution_components(planned_occurrence_id,component_key)
  where planned_occurrence_id is not null;
create index work_execution_components_resource_idx on atlas.work_execution_components(resource_id) where resource_id is not null;
create index work_execution_components_object_idx on atlas.work_execution_components(object_id) where object_id is not null;
create index work_execution_components_reference_idx on atlas.work_execution_components(reference_kind,reference_id) where reference_id is not null;

create table atlas.work_execution_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid references atlas.tasks(id) on delete cascade,
  planned_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete cascade,
  relation_key text not null,
  relation_kind text not null,
  from_component_key text not null,
  to_component_key text not null,
  condition_component_key text,
  required boolean not null default true,
  sort_order integer not null default 100,
  source text not null default 'structured_work_v1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_execution_relations_one_carrier check (
    (task_id is not null and planned_occurrence_id is null)
    or (task_id is null and planned_occurrence_id is not null)
  ),
  constraint work_execution_relations_key_nonempty check (btrim(relation_key) <> ''),
  constraint work_execution_relations_kind_nonempty check (btrim(relation_kind) <> '')
);

create unique index work_execution_relations_task_key_uidx
  on atlas.work_execution_relations(task_id,relation_key)
  where task_id is not null;
create unique index work_execution_relations_occurrence_key_uidx
  on atlas.work_execution_relations(planned_occurrence_id,relation_key)
  where planned_occurrence_id is not null;

alter table atlas.work_execution_components enable row level security;
alter table atlas.work_execution_relations enable row level security;

create policy work_execution_components_member_read
  on atlas.work_execution_components for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);
create policy work_execution_relations_member_read
  on atlas.work_execution_relations for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

grant select on atlas.work_execution_components to authenticated;
grant select on atlas.work_execution_relations to authenticated;
grant all on atlas.work_execution_components to service_role;
grant all on atlas.work_execution_relations to service_role;
revoke all on atlas.work_execution_components from anon;
revoke all on atlas.work_execution_relations from anon;

create or replace function atlas.copy_work_execution_structure_to_task_v1(
  p_occurrence_id uuid,
  p_task_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_occ atlas.planned_work_occurrences%rowtype;
  v_task atlas.tasks%rowtype;
  v_components integer:=0;
  v_relations integer:=0;
begin
  select * into v_occ from atlas.planned_work_occurrences where id=p_occurrence_id;
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_occ.id is null or v_task.id is null then
    return jsonb_build_object('state','carrier_missing','occurrenceId',p_occurrence_id,'taskId',p_task_id);
  end if;
  if v_occ.farm_id is distinct from v_task.farm_id then
    raise exception 'Occurrence and task must belong to the same farm.' using errcode='23514';
  end if;

  insert into atlas.work_execution_components(
    organization_id,farm_id,task_id,component_key,component_kind,component_role,label,
    value_text,value_numeric,value_boolean,unit,reference_kind,reference_id,
    resource_id,object_id,zone_id,required,sort_order,source,metadata
  )
  select
    c.organization_id,c.farm_id,p_task_id,c.component_key,c.component_kind,c.component_role,c.label,
    c.value_text,c.value_numeric,c.value_boolean,c.unit,c.reference_kind,c.reference_id,
    c.resource_id,c.object_id,c.zone_id,c.required,c.sort_order,
    'occurrence_copy_v1',coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object('sourceOccurrenceId',p_occurrence_id,'sourceComponentId',c.id)
  from atlas.work_execution_components c
  where c.planned_occurrence_id=p_occurrence_id
  on conflict (task_id,component_key) where task_id is not null do update set
    component_kind=excluded.component_kind,
    component_role=excluded.component_role,
    label=excluded.label,
    value_text=excluded.value_text,
    value_numeric=excluded.value_numeric,
    value_boolean=excluded.value_boolean,
    unit=excluded.unit,
    reference_kind=excluded.reference_kind,
    reference_id=excluded.reference_id,
    resource_id=excluded.resource_id,
    object_id=excluded.object_id,
    zone_id=excluded.zone_id,
    required=excluded.required,
    sort_order=excluded.sort_order,
    source=excluded.source,
    metadata=atlas.work_execution_components.metadata||excluded.metadata,
    updated_at=now();
  get diagnostics v_components=row_count;

  insert into atlas.work_execution_relations(
    organization_id,farm_id,task_id,relation_key,relation_kind,
    from_component_key,to_component_key,condition_component_key,required,sort_order,source,metadata
  )
  select
    r.organization_id,r.farm_id,p_task_id,r.relation_key,r.relation_kind,
    r.from_component_key,r.to_component_key,r.condition_component_key,r.required,r.sort_order,
    'occurrence_copy_v1',coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object('sourceOccurrenceId',p_occurrence_id,'sourceRelationId',r.id)
  from atlas.work_execution_relations r
  where r.planned_occurrence_id=p_occurrence_id
  on conflict (task_id,relation_key) where task_id is not null do update set
    relation_kind=excluded.relation_kind,
    from_component_key=excluded.from_component_key,
    to_component_key=excluded.to_component_key,
    condition_component_key=excluded.condition_component_key,
    required=excluded.required,
    sort_order=excluded.sort_order,
    source=excluded.source,
    metadata=atlas.work_execution_relations.metadata||excluded.metadata,
    updated_at=now();
  get diagnostics v_relations=row_count;

  return jsonb_build_object('state','copied','occurrenceId',p_occurrence_id,'taskId',p_task_id,'components',v_components,'relations',v_relations);
end;
$function$;

revoke all on function atlas.copy_work_execution_structure_to_task_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.copy_work_execution_structure_to_task_v1(uuid,uuid) to service_role;

create or replace function atlas.copy_work_execution_structure_on_task_insert_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.planned_occurrence_id is not null then
    perform atlas.copy_work_execution_structure_to_task_v1(new.planned_occurrence_id,new.id);
  end if;
  return new;
end;
$function$;

create trigger trg_copy_work_execution_structure_on_task_insert_v1
after insert or update of planned_occurrence_id on atlas.tasks
for each row
when (new.planned_occurrence_id is not null)
execute function atlas.copy_work_execution_structure_on_task_insert_v1();

create or replace function atlas.worker_task_execution_structure_api_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_components jsonb;
  v_relations jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  select * into v_membership
  from atlas.farm_memberships m
  where m.farm_id=v_task.farm_id and m.user_id=auth.uid() and m.active=true
  order by case when m.role in ('owner','manager') then 0 else 1 end,m.created_at
  limit 1;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_membership.role not in ('owner','manager')
     and v_task.assigned_membership_id is distinct from v_membership.id
     and coalesce(v_task.metadata->>'executor_membership_id','')<>v_membership.id::text
  then
    raise exception 'Only the assigned worker or management may read task execution structure.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'key',c.component_key,'kind',c.component_kind,'role',c.component_role,'label',c.label,
    'valueText',c.value_text,'valueNumeric',c.value_numeric,'valueBoolean',c.value_boolean,'unit',c.unit,
    'referenceKind',c.reference_kind,'referenceId',c.reference_id,
    'resourceId',c.resource_id,'objectId',c.object_id,'zoneId',c.zone_id,
    'required',c.required,'sortOrder',c.sort_order
  )) order by c.sort_order,c.component_key),'[]'::jsonb)
  into v_components
  from atlas.work_execution_components c where c.task_id=p_task_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'key',r.relation_key,'kind',r.relation_kind,'from',r.from_component_key,'to',r.to_component_key,
    'condition',r.condition_component_key,'required',r.required,'sortOrder',r.sort_order
  )) order by r.sort_order,r.relation_key),'[]'::jsonb)
  into v_relations
  from atlas.work_execution_relations r where r.task_id=p_task_id;

  return jsonb_build_object(
    'contractVersion','worker_task_execution_structure_v1',
    'taskId',p_task_id,
    'components',v_components,
    'relations',v_relations
  );
end;
$function$;

revoke all on function atlas.worker_task_execution_structure_api_v1(uuid) from public,anon;
grant execute on function atlas.worker_task_execution_structure_api_v1(uuid) to authenticated,service_role;

-- Keep the signed-in read boundary in the governed RPC registry in the same
-- migration that changes authenticated EXECUTE. Production already carries
-- this exact row; this source block freezes that live contract for replay.
insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  anonymous_execute_expected
)
values (
  'atlas.worker_task_execution_structure_api_v1(uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'caller', 'app/api/atlas/task-execution-structure/route.ts',
    'purpose', 'Read the compact structured parts and relations for one task through the authenticated worker boundary.',
    'contractVersion', 'worker_task_execution_structure_v1',
    'authorizationBoundary', 'Function requires auth.uid(), active farm membership, and either management or exact task assignment.',
    'publicInheritanceRemoved', true
  ),
  false
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  anonymous_execute_expected = excluded.anonymous_execute_expected,
  reviewed_at = now();
