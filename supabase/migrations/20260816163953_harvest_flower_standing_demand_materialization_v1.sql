create unique index flower_demand_orders_standing_due_unique
  on atlas.flower_demand_orders(source_standing_order_id,requested_for_date)
  where source_standing_order_id is not null;

create or replace function atlas.materialize_flower_standing_demand_occurrence_core_v1(
  p_standing_order_id uuid,p_due_date date,p_effective_membership_id uuid,p_effective_role text,p_idempotency_key text,p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_standing atlas.flower_standing_orders%rowtype; v_member atlas.farm_memberships%rowtype; v_existing atlas.flower_demand_orders%rowtype;
  v_order atlas.flower_demand_orders%rowtype; v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_step integer; v_rows jsonb;
begin
  if v_key is null then raise exception 'Standing-demand occurrence idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to materialize standing flower demand.' using errcode='42501'; end if;
  select * into v_standing from atlas.flower_standing_orders where id=p_standing_order_id for share;
  if v_standing.id is null then raise exception 'Flower standing order not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_standing.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if exists(select 1 from atlas.flower_standing_order_cancellation_events where standing_order_id=v_standing.id) then raise exception 'Cancelled standing order cannot generate new demand.' using errcode='22023'; end if;
  if p_due_date is null or p_due_date<v_standing.first_due_date or (v_standing.active_end_date is not null and p_due_date>v_standing.active_end_date) then raise exception 'Requested date is outside the standing-order active range.' using errcode='22023'; end if;
  v_step:=7*v_standing.recurrence_interval_weeks;
  if mod((p_due_date-v_standing.first_due_date),v_step)<>0 then raise exception 'Requested date is not a recurrence date for this standing order.' using errcode='22023'; end if;
  select * into v_existing from atlas.flower_demand_orders where source_standing_order_id=v_standing.id and requested_for_date=p_due_date;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'inventoryKind',l.inventory_kind,'cropProfileId',l.crop_profile_id,'productLabel',l.product_label,'quantity',l.quantity,'unit',l.unit,'targetUnitPrice',l.target_unit_price) order by l.created_at),'[]'::jsonb) into v_rows from atlas.flower_demand_order_lines l where l.demand_order_id=v_existing.id;
    return jsonb_build_object('standingOrderId',v_standing.id,'demandOrderId',v_existing.id,'requestedForDate',p_due_date,'lines',v_rows,'deduplicated',true);
  end if;
  insert into atlas.flower_demand_orders(farm_id,buyer_relationship_id,customer_label,demand_strength,sales_channel,requested_for_date,fulfillment_mode,fulfillment_due_time,source_standing_order_id,recorded_by_membership_id,note,idempotency_key,created_by_user_id,metadata)
  values(v_standing.farm_id,v_standing.buyer_relationship_id,v_standing.customer_label,'committed',v_standing.sales_channel,p_due_date,v_standing.fulfillment_mode,v_standing.fulfillment_due_time,v_standing.id,p_effective_membership_id,v_standing.note,v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','materialized_standing_demand','standingOrderId',v_standing.id,'workerTimeScheduled',false,'supplyClaimed',false)) returning * into v_order;
  insert into atlas.flower_demand_order_lines(farm_id,demand_order_id,inventory_kind,crop_profile_id,product_label,quantity,unit,target_unit_price,currency,metadata)
  select v_standing.farm_id,v_order.id,l.inventory_kind,l.crop_profile_id,l.product_label,l.quantity,l.unit,l.target_unit_price,l.currency,
         l.metadata||jsonb_build_object('truthBoundary','materialized_standing_demand_product','standingOrderLineId',l.id)
  from atlas.flower_standing_order_lines l where l.standing_order_id=v_standing.id order by l.created_at;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'inventoryKind',l.inventory_kind,'cropProfileId',l.crop_profile_id,'productLabel',l.product_label,'quantity',l.quantity,'unit',l.unit,'targetUnitPrice',l.target_unit_price) order by l.created_at),'[]'::jsonb) into v_rows from atlas.flower_demand_order_lines l where l.demand_order_id=v_order.id;
  return jsonb_build_object('standingOrderId',v_standing.id,'demandOrderId',v_order.id,'requestedForDate',p_due_date,'lines',v_rows,'deduplicated',false);
end; $$;

create or replace function atlas.ensure_flower_standing_demand_window_core_v1(
  p_farm_id uuid,p_from_date date,p_through_date date,p_effective_membership_id uuid,p_effective_role text,p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_member atlas.farm_memberships%rowtype; v_standing atlas.flower_standing_orders%rowtype; v_due date; v_result jsonb;
  v_created integer:=0; v_kept integer:=0; v_total integer:=0; v_end date;
begin
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to ensure standing flower demand.' using errcode='42501'; end if;
  if p_from_date is null or p_through_date is null or p_through_date<p_from_date or p_through_date-p_from_date>366 then raise exception 'Standing-demand window must be a valid range no longer than 366 days.' using errcode='22023'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  for v_standing in
    select s.* from atlas.flower_standing_orders s
    where s.farm_id=p_farm_id
      and s.first_due_date<=p_through_date
      and (s.active_end_date is null or s.active_end_date>=p_from_date)
      and not exists(select 1 from atlas.flower_standing_order_cancellation_events c where c.standing_order_id=s.id)
    order by s.first_due_date,s.created_at
  loop
    v_end:=least(p_through_date,coalesce(v_standing.active_end_date,p_through_date));
    for v_due in
      select gs::date from generate_series(v_standing.first_due_date::timestamp,v_end::timestamp,(7*v_standing.recurrence_interval_weeks||' days')::interval) gs
      where gs::date>=p_from_date
      order by gs
    loop
      v_result:=atlas.materialize_flower_standing_demand_occurrence_core_v1(v_standing.id,v_due,p_effective_membership_id,p_effective_role,'standing-occurrence:'||v_standing.id::text||':'||v_due::text,p_operator_mode);
      v_total:=v_total+1;
      if coalesce((v_result->>'deduplicated')::boolean,false) then v_kept:=v_kept+1; else v_created:=v_created+1; end if;
    end loop;
  end loop;
  return jsonb_build_object('farmId',p_farm_id,'fromDate',p_from_date,'throughDate',p_through_date,'occurrenceCount',v_total,'createdCount',v_created,'keptCount',v_kept,'workerTimeScheduled',false);
end; $$;

create or replace function atlas.ensure_flower_standing_demand_window_for_member_v1(p_farm_id uuid,p_from_date date,p_through_date date)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.ensure_flower_standing_demand_window_core_v1(p_farm_id,p_from_date,p_through_date,v_membership,v_role,false);
end; $$;

create or replace function atlas.owner_operator_ensure_flower_standing_demand_window_v1(p_effective_membership_id uuid,p_from_date date,p_through_date date)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb; v_farm uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id); v_farm:=nullif(v_context->>'farmId','')::uuid;
  return atlas.ensure_flower_standing_demand_window_core_v1(v_farm,p_from_date,p_through_date,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',true);
end; $$;

create or replace function atlas.record_flower_standing_order_for_member_v1(
  p_farm_id uuid,p_buyer_relationship_id uuid,p_customer_label text,p_sales_channel text,p_fulfillment_mode text,p_fulfillment_due_time time without time zone,
  p_first_due_date date,p_active_end_date date,p_recurrence_interval_weeks integer,p_lines jsonb,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid; v_result jsonb; v_occurrence jsonb; v_standing uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  v_result:=atlas.record_flower_standing_order_core_v1(p_farm_id,v_membership,v_role,p_buyer_relationship_id,p_customer_label,p_sales_channel,p_fulfillment_mode,p_fulfillment_due_time,p_first_due_date,p_active_end_date,p_recurrence_interval_weeks,p_lines,p_note,p_idempotency_key,false);
  v_standing:=(v_result->>'standingOrderId')::uuid;
  v_occurrence:=atlas.materialize_flower_standing_demand_occurrence_core_v1(v_standing,p_first_due_date,v_membership,v_role,'standing-occurrence:'||v_standing::text||':'||p_first_due_date::text,false);
  return v_result||jsonb_build_object('firstDemandOccurrence',v_occurrence);
end; $$;

create or replace function atlas.owner_operator_record_flower_standing_order_v1(
  p_effective_membership_id uuid,p_buyer_relationship_id uuid,p_customer_label text,p_sales_channel text,p_fulfillment_mode text,p_fulfillment_due_time time without time zone,
  p_first_due_date date,p_active_end_date date,p_recurrence_interval_weeks integer,p_lines jsonb,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb; v_farm uuid; v_result jsonb; v_occurrence jsonb; v_standing uuid; v_effective uuid; v_role text;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id); v_farm:=nullif(v_context->>'farmId','')::uuid; v_effective:=(v_context#>>'{effective,membershipId}')::uuid; v_role:=v_context#>>'{effective,role}';
  v_result:=atlas.record_flower_standing_order_core_v1(v_farm,v_effective,v_role,p_buyer_relationship_id,p_customer_label,p_sales_channel,p_fulfillment_mode,p_fulfillment_due_time,p_first_due_date,p_active_end_date,p_recurrence_interval_weeks,p_lines,p_note,p_idempotency_key,true);
  v_standing:=(v_result->>'standingOrderId')::uuid;
  v_occurrence:=atlas.materialize_flower_standing_demand_occurrence_core_v1(v_standing,p_first_due_date,v_effective,v_role,'standing-occurrence:'||v_standing::text||':'||p_first_due_date::text,true);
  return v_result||jsonb_build_object('firstDemandOccurrence',v_occurrence);
end; $$;

revoke all on function atlas.materialize_flower_standing_demand_occurrence_core_v1(uuid,date,uuid,text,text,boolean),atlas.ensure_flower_standing_demand_window_core_v1(uuid,date,date,uuid,text,boolean) from public,anon,authenticated;
grant execute on function atlas.materialize_flower_standing_demand_occurrence_core_v1(uuid,date,uuid,text,text,boolean),atlas.ensure_flower_standing_demand_window_core_v1(uuid,date,date,uuid,text,boolean) to service_role;
revoke all on function atlas.ensure_flower_standing_demand_window_for_member_v1(uuid,date,date),atlas.owner_operator_ensure_flower_standing_demand_window_v1(uuid,date,date) from public,anon;
grant execute on function atlas.ensure_flower_standing_demand_window_for_member_v1(uuid,date,date),atlas.owner_operator_ensure_flower_standing_demand_window_v1(uuid,date,date) to authenticated,service_role;