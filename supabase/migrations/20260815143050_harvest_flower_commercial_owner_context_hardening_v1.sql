-- Harvest Pass 5 hardening.
-- 1. owner_operator_context_v1 exposes farmId at the root, while effective contains
--    membership/role/worker identity.
-- 2. A sale linked to a known buyer snapshots the business name when no explicit
--    customer label is supplied, so fulfillment does not depend on reopening sealed
--    relationship data later.
-- 3. Optional source-task provenance is accepted only from the same farm.

create or replace function atlas.owner_operator_record_flower_sale_v1(
  p_effective_membership_id uuid,
  p_buyer_relationship_id uuid,
  p_customer_label text,
  p_sales_channel text,
  p_event_key text,
  p_lines jsonb,
  p_tax_amount numeric,
  p_tip_amount numeric,
  p_fulfillment_mode text,
  p_fulfillment_due_date date,
  p_fulfillment_due_time time,
  p_fulfillment_membership_id uuid,
  p_source_task_id uuid,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_context jsonb;
  v_farm_id uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id:=nullif(v_context->>'farmId','')::uuid;
  if v_farm_id is null then
    raise exception 'Owner operator context has no farm scope.' using errcode='42501';
  end if;
  return atlas.record_flower_sale_core_v1(
    v_farm_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',
    p_buyer_relationship_id,p_customer_label,p_sales_channel,p_event_key,p_lines,p_tax_amount,p_tip_amount,
    p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,p_fulfillment_membership_id,p_source_task_id,
    p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
grant execute on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;

create or replace function atlas.validate_flower_sale_order_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_buyer_farm uuid;
  v_buyer_name text;
  v_source_task_farm uuid;
  v_member atlas.farm_memberships%rowtype;
begin
  if new.buyer_relationship_id is not null then
    select farm_id,business_name into v_buyer_farm,v_buyer_name
    from atlas.buyer_relationship_reconstruction
    where id=new.buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from new.farm_id then
      raise exception 'Buyer relationship is outside the sale farm.' using errcode='22023';
    end if;
    if nullif(btrim(coalesce(new.customer_label,'')),'') is null then
      new.customer_label:=nullif(btrim(coalesce(v_buyer_name,'')),'');
    end if;
  end if;

  if new.source_task_id is not null then
    select farm_id into v_source_task_farm
    from atlas.tasks
    where id=new.source_task_id;
    if v_source_task_farm is null or v_source_task_farm is distinct from new.farm_id then
      raise exception 'Sale source task is outside the sale farm.' using errcode='22023';
    end if;
  end if;

  select * into v_member from atlas.farm_memberships where id=new.recorded_by_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from new.farm_id then
    raise exception 'Sale recorder must be an active member of this farm.' using errcode='22023';
  end if;

  if new.fulfillment_membership_id is not null then
    select * into v_member from atlas.farm_memberships where id=new.fulfillment_membership_id;
    if v_member.id is null or not v_member.active or v_member.farm_id is distinct from new.farm_id then
      raise exception 'Fulfillment assignee must be an active member of this farm.' using errcode='22023';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function atlas.validate_flower_sale_order_v1() from public,anon,authenticated;
grant execute on function atlas.validate_flower_sale_order_v1() to service_role;
