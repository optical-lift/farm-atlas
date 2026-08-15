-- Harvest Pass 5 hardening: owner_operator_context_v1 exposes farmId at the root,
-- while effective contains membership/role/worker identity. Keep this correction ordered
-- before the authenticated RPC registry reconciliation.

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
