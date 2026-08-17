create or replace function atlas.record_flower_demand_order_core_v1(
  p_farm_id uuid, p_effective_membership_id uuid, p_effective_role text,
  p_buyer_relationship_id uuid, p_customer_label text, p_demand_strength text,
  p_sales_channel text, p_requested_for_date date, p_fulfillment_mode text,
  p_fulfillment_due_time time without time zone, p_lines jsonb, p_note text,
  p_idempotency_key text, p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_member atlas.farm_memberships%rowtype; v_existing atlas.flower_demand_orders%rowtype;
  v_order atlas.flower_demand_orders%rowtype; v_line jsonb; v_kind text; v_unit text;
  v_quantity numeric; v_price numeric; v_crop uuid; v_buyer_farm uuid; v_customer text:=nullif(btrim(coalesce(p_customer_label,'')),'');
  v_rows jsonb:='[]'::jsonb; v_inserted atlas.flower_demand_order_lines%rowtype;
begin
  if v_key is null then raise exception 'Demand idempotency key is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':flower-demand:'||v_key,0));
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record flower demand.' using errcode='42501'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select * into v_existing from atlas.flower_demand_orders where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'inventoryKind',l.inventory_kind,'cropProfileId',l.crop_profile_id,'productLabel',l.product_label,'quantity',l.quantity,'unit',l.unit,'targetUnitPrice',l.target_unit_price) order by l.created_at),'[]'::jsonb) into v_rows
    from atlas.flower_demand_order_lines l where l.demand_order_id=v_existing.id;
    return jsonb_build_object('demandOrderId',v_existing.id,'lines',v_rows,'deduplicated',true);
  end if;
  if p_demand_strength not in ('requested','committed') then raise exception 'Demand strength must be requested or committed.' using errcode='22023'; end if;
  if p_sales_channel not in ('wholesale','farm_pickup','delivery','market','subscription','event','other') then raise exception 'Choose a supported flower demand channel.' using errcode='22023'; end if;
  if p_fulfillment_mode not in ('immediate_handoff','pickup','delivery') then raise exception 'Choose a supported demand fulfillment mode.' using errcode='22023'; end if;
  if p_requested_for_date is null then raise exception 'Demand requires a requested date.' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>24 then raise exception 'Demand requires between 1 and 24 product lines.' using errcode='22023'; end if;
  if p_buyer_relationship_id is not null then
    select farm_id,business_name into v_buyer_farm,v_customer from atlas.buyer_relationship_reconstruction where id=p_buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from p_farm_id then raise exception 'Demand buyer is outside this farm.' using errcode='22023'; end if;
    v_customer:=coalesce(nullif(btrim(coalesce(p_customer_label,'')),''),v_customer);
  elsif v_customer is null then raise exception 'Demand requires a buyer relationship or customer label.' using errcode='22023'; end if;
  insert into atlas.flower_demand_orders(farm_id,buyer_relationship_id,customer_label,demand_strength,sales_channel,requested_for_date,fulfillment_mode,fulfillment_due_time,recorded_by_membership_id,note,idempotency_key,created_by_user_id,metadata)
  values(p_farm_id,p_buyer_relationship_id,v_customer,p_demand_strength,p_sales_channel,p_requested_for_date,p_fulfillment_mode,p_fulfillment_due_time,p_effective_membership_id,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','independent_demand','supplyClaimed',false,'workerTimeScheduled',false)) returning * into v_order;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_kind:=nullif(btrim(v_line->>'inventoryKind'),''); v_unit:=atlas.flower_demand_line_unit_v1(v_kind);
    begin v_quantity:=(v_line->>'quantity')::numeric; exception when others then raise exception 'Invalid quantity in flower demand line.' using errcode='22023'; end;
    begin v_price:=nullif(v_line->>'targetUnitPrice','')::numeric; exception when others then raise exception 'Invalid targetUnitPrice in flower demand line.' using errcode='22023'; end;
    begin v_crop:=nullif(v_line->>'cropProfileId','')::uuid; exception when others then raise exception 'Invalid cropProfileId in flower demand line.' using errcode='22023'; end;
    if v_unit is null then raise exception 'Unsupported flower demand inventory kind.' using errcode='22023'; end if;
    if v_quantity is null or v_quantity<=0 then raise exception 'Flower demand quantity must be positive.' using errcode='22023'; end if;
    if v_price is not null and v_price<0 then raise exception 'Flower demand target price cannot be negative.' using errcode='22023'; end if;
    if v_crop is not null and not exists(select 1 from atlas.crop_profiles where id=v_crop) then raise exception 'Flower demand crop profile was not found.' using errcode='22023'; end if;
    insert into atlas.flower_demand_order_lines(farm_id,demand_order_id,inventory_kind,crop_profile_id,product_label,quantity,unit,target_unit_price,currency,metadata)
    values(p_farm_id,v_order.id,v_kind,v_crop,nullif(btrim(coalesce(v_line->>'productLabel','')),''),v_quantity,v_unit,v_price,'USD',jsonb_build_object('truthBoundary','demand_product_requirement')) returning * into v_inserted;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_inserted.id,'inventoryKind',v_inserted.inventory_kind,'cropProfileId',v_inserted.crop_profile_id,'productLabel',v_inserted.product_label,'quantity',v_inserted.quantity,'unit',v_inserted.unit,'targetUnitPrice',v_inserted.target_unit_price));
  end loop;
  return jsonb_build_object('demandOrderId',v_order.id,'lines',v_rows,'demandStrength',v_order.demand_strength,'requestedForDate',v_order.requested_for_date,'deduplicated',false);
end; $$;

create or replace function atlas.record_flower_demand_order_for_member_v1(
  p_farm_id uuid, p_buyer_relationship_id uuid, p_customer_label text, p_demand_strength text,
  p_sales_channel text, p_requested_for_date date, p_fulfillment_mode text,
  p_fulfillment_due_time time without time zone, p_lines jsonb, p_note text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_demand_order_core_v1(p_farm_id,v_membership,v_role,p_buyer_relationship_id,p_customer_label,p_demand_strength,p_sales_channel,p_requested_for_date,p_fulfillment_mode,p_fulfillment_due_time,p_lines,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_record_flower_demand_order_v1(
  p_effective_membership_id uuid, p_buyer_relationship_id uuid, p_customer_label text, p_demand_strength text,
  p_sales_channel text, p_requested_for_date date, p_fulfillment_mode text,
  p_fulfillment_due_time time without time zone, p_lines jsonb, p_note text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb; v_farm uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id); v_farm:=nullif(v_context->>'farmId','')::uuid;
  return atlas.record_flower_demand_order_core_v1(v_farm,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_buyer_relationship_id,p_customer_label,p_demand_strength,p_sales_channel,p_requested_for_date,p_fulfillment_mode,p_fulfillment_due_time,p_lines,p_note,p_idempotency_key,true);
end; $$;

create or replace function atlas.record_flower_standing_order_core_v1(
  p_farm_id uuid, p_effective_membership_id uuid, p_effective_role text,
  p_buyer_relationship_id uuid, p_customer_label text, p_sales_channel text,
  p_fulfillment_mode text, p_fulfillment_due_time time without time zone,
  p_first_due_date date, p_active_end_date date, p_recurrence_interval_weeks integer,
  p_lines jsonb, p_note text, p_idempotency_key text, p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_member atlas.farm_memberships%rowtype;
  v_existing atlas.flower_standing_orders%rowtype; v_order atlas.flower_standing_orders%rowtype;
  v_line jsonb; v_kind text; v_unit text; v_quantity numeric; v_price numeric; v_crop uuid;
  v_buyer_farm uuid; v_customer text:=nullif(btrim(coalesce(p_customer_label,'')),''); v_rows jsonb:='[]'::jsonb; v_inserted atlas.flower_standing_order_lines%rowtype;
begin
  if v_key is null then raise exception 'Standing-order idempotency key is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':flower-standing:'||v_key,0));
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required for standing flower orders.' using errcode='42501'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select * into v_existing from atlas.flower_standing_orders where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'inventoryKind',l.inventory_kind,'cropProfileId',l.crop_profile_id,'productLabel',l.product_label,'quantity',l.quantity,'unit',l.unit,'targetUnitPrice',l.target_unit_price) order by l.created_at),'[]'::jsonb) into v_rows from atlas.flower_standing_order_lines l where l.standing_order_id=v_existing.id;
    return jsonb_build_object('standingOrderId',v_existing.id,'lines',v_rows,'deduplicated',true);
  end if;
  if p_sales_channel not in ('wholesale','farm_pickup','delivery','market','subscription','event','other') then raise exception 'Choose a supported standing-order channel.' using errcode='22023'; end if;
  if p_fulfillment_mode not in ('immediate_handoff','pickup','delivery') then raise exception 'Choose a supported standing-order fulfillment mode.' using errcode='22023'; end if;
  if p_first_due_date is null then raise exception 'Standing order requires its first due date.' using errcode='22023'; end if;
  if p_active_end_date is not null and p_active_end_date<p_first_due_date then raise exception 'Standing-order end date cannot precede first due date.' using errcode='22023'; end if;
  if coalesce(p_recurrence_interval_weeks,0) not between 1 and 52 then raise exception 'Standing-order recurrence must be 1 to 52 weeks.' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>24 then raise exception 'Standing order requires between 1 and 24 product lines.' using errcode='22023'; end if;
  if p_buyer_relationship_id is not null then
    select farm_id,business_name into v_buyer_farm,v_customer from atlas.buyer_relationship_reconstruction where id=p_buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from p_farm_id then raise exception 'Standing-order buyer is outside this farm.' using errcode='22023'; end if;
    v_customer:=coalesce(nullif(btrim(coalesce(p_customer_label,'')),''),v_customer);
  elsif v_customer is null then raise exception 'Standing order requires a buyer relationship or customer label.' using errcode='22023'; end if;
  insert into atlas.flower_standing_orders(farm_id,buyer_relationship_id,customer_label,sales_channel,fulfillment_mode,fulfillment_due_time,first_due_date,active_end_date,recurrence_kind,recurrence_interval_weeks,recorded_by_membership_id,note,idempotency_key,created_by_user_id,metadata)
  values(p_farm_id,p_buyer_relationship_id,v_customer,p_sales_channel,p_fulfillment_mode,p_fulfillment_due_time,p_first_due_date,p_active_end_date,'weekly',p_recurrence_interval_weeks,p_effective_membership_id,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','standing_demand_definition','supplyClaimed',false,'workerTimeScheduled',false)) returning * into v_order;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_kind:=nullif(btrim(v_line->>'inventoryKind'),''); v_unit:=atlas.flower_demand_line_unit_v1(v_kind);
    begin v_quantity:=(v_line->>'quantity')::numeric; exception when others then raise exception 'Invalid quantity in standing-order line.' using errcode='22023'; end;
    begin v_price:=nullif(v_line->>'targetUnitPrice','')::numeric; exception when others then raise exception 'Invalid targetUnitPrice in standing-order line.' using errcode='22023'; end;
    begin v_crop:=nullif(v_line->>'cropProfileId','')::uuid; exception when others then raise exception 'Invalid cropProfileId in standing-order line.' using errcode='22023'; end;
    if v_unit is null then raise exception 'Unsupported standing-order inventory kind.' using errcode='22023'; end if;
    if v_quantity is null or v_quantity<=0 then raise exception 'Standing-order quantity must be positive.' using errcode='22023'; end if;
    if v_price is not null and v_price<0 then raise exception 'Standing-order target price cannot be negative.' using errcode='22023'; end if;
    if v_crop is not null and not exists(select 1 from atlas.crop_profiles where id=v_crop) then raise exception 'Standing-order crop profile was not found.' using errcode='22023'; end if;
    insert into atlas.flower_standing_order_lines(farm_id,standing_order_id,inventory_kind,crop_profile_id,product_label,quantity,unit,target_unit_price,currency,metadata)
    values(p_farm_id,v_order.id,v_kind,v_crop,nullif(btrim(coalesce(v_line->>'productLabel','')),''),v_quantity,v_unit,v_price,'USD',jsonb_build_object('truthBoundary','standing_demand_product_requirement')) returning * into v_inserted;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_inserted.id,'inventoryKind',v_inserted.inventory_kind,'cropProfileId',v_inserted.crop_profile_id,'productLabel',v_inserted.product_label,'quantity',v_inserted.quantity,'unit',v_inserted.unit,'targetUnitPrice',v_inserted.target_unit_price));
  end loop;
  return jsonb_build_object('standingOrderId',v_order.id,'lines',v_rows,'firstDueDate',v_order.first_due_date,'recurrenceIntervalWeeks',v_order.recurrence_interval_weeks,'deduplicated',false);
end; $$;

create or replace function atlas.record_flower_standing_order_for_member_v1(
  p_farm_id uuid, p_buyer_relationship_id uuid, p_customer_label text, p_sales_channel text,
  p_fulfillment_mode text, p_fulfillment_due_time time without time zone,
  p_first_due_date date, p_active_end_date date, p_recurrence_interval_weeks integer,
  p_lines jsonb, p_note text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_standing_order_core_v1(p_farm_id,v_membership,v_role,p_buyer_relationship_id,p_customer_label,p_sales_channel,p_fulfillment_mode,p_fulfillment_due_time,p_first_due_date,p_active_end_date,p_recurrence_interval_weeks,p_lines,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_record_flower_standing_order_v1(
  p_effective_membership_id uuid, p_buyer_relationship_id uuid, p_customer_label text, p_sales_channel text,
  p_fulfillment_mode text, p_fulfillment_due_time time without time zone,
  p_first_due_date date, p_active_end_date date, p_recurrence_interval_weeks integer,
  p_lines jsonb, p_note text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb; v_farm uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id); v_farm:=nullif(v_context->>'farmId','')::uuid;
  return atlas.record_flower_standing_order_core_v1(v_farm,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_buyer_relationship_id,p_customer_label,p_sales_channel,p_fulfillment_mode,p_fulfillment_due_time,p_first_due_date,p_active_end_date,p_recurrence_interval_weeks,p_lines,p_note,p_idempotency_key,true);
end; $$;

create or replace function atlas.cancel_flower_demand_order_core_v1(p_demand_order_id uuid,p_effective_membership_id uuid,p_effective_role text,p_reason_kind text,p_note text,p_idempotency_key text,p_operator_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_order atlas.flower_demand_orders%rowtype; v_member atlas.farm_memberships%rowtype; v_existing atlas.flower_demand_order_cancellation_events%rowtype; v_event atlas.flower_demand_order_cancellation_events%rowtype; v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
begin
  if v_key is null then raise exception 'Demand cancellation idempotency key is required.' using errcode='22023'; end if;
  select * into v_order from atlas.flower_demand_orders where id=p_demand_order_id for update;
  if v_order.id is null then raise exception 'Flower demand order not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_order.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot cancel flower demand.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and v_order.recorded_by_membership_id is distinct from p_effective_membership_id then raise exception 'Farm Hand may cancel only demand they recorded.' using errcode='42501'; end if;
  select * into v_existing from atlas.flower_demand_order_cancellation_events where demand_order_id=v_order.id;
  if v_existing.id is not null then return jsonb_build_object('demandOrderId',v_order.id,'cancellationEventId',v_existing.id,'deduplicated',true); end if;
  insert into atlas.flower_demand_order_cancellation_events(farm_id,demand_order_id,reason_kind,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata)
  values(v_order.farm_id,v_order.id,p_reason_kind,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','demand_cancellation')) returning * into v_event;
  return jsonb_build_object('demandOrderId',v_order.id,'cancellationEventId',v_event.id,'deduplicated',false);
end; $$;

create or replace function atlas.cancel_flower_demand_order_for_member_v1(p_farm_id uuid,p_demand_order_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.cancel_flower_demand_order_core_v1(p_demand_order_id,v_membership,v_role,p_reason_kind,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_cancel_flower_demand_order_v1(p_effective_membership_id uuid,p_demand_order_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.cancel_flower_demand_order_core_v1(p_demand_order_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_reason_kind,p_note,p_idempotency_key,true);
end; $$;

create or replace function atlas.cancel_flower_standing_order_core_v1(p_standing_order_id uuid,p_effective_membership_id uuid,p_effective_role text,p_reason_kind text,p_note text,p_idempotency_key text,p_operator_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_order atlas.flower_standing_orders%rowtype; v_member atlas.farm_memberships%rowtype; v_existing atlas.flower_standing_order_cancellation_events%rowtype; v_event atlas.flower_standing_order_cancellation_events%rowtype; v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
begin
  if v_key is null then raise exception 'Standing-order cancellation idempotency key is required.' using errcode='22023'; end if;
  select * into v_order from atlas.flower_standing_orders where id=p_standing_order_id for update;
  if v_order.id is null then raise exception 'Flower standing order not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_order.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to cancel a standing flower order.' using errcode='42501'; end if;
  select * into v_existing from atlas.flower_standing_order_cancellation_events where standing_order_id=v_order.id;
  if v_existing.id is not null then return jsonb_build_object('standingOrderId',v_order.id,'cancellationEventId',v_existing.id,'deduplicated',true); end if;
  insert into atlas.flower_standing_order_cancellation_events(farm_id,standing_order_id,reason_kind,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata)
  values(v_order.farm_id,v_order.id,p_reason_kind,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','standing_demand_cancellation')) returning * into v_event;
  return jsonb_build_object('standingOrderId',v_order.id,'cancellationEventId',v_event.id,'deduplicated',false);
end; $$;

create or replace function atlas.cancel_flower_standing_order_for_member_v1(p_farm_id uuid,p_standing_order_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.cancel_flower_standing_order_core_v1(p_standing_order_id,v_membership,v_role,p_reason_kind,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_cancel_flower_standing_order_v1(p_effective_membership_id uuid,p_standing_order_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.cancel_flower_standing_order_core_v1(p_standing_order_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_reason_kind,p_note,p_idempotency_key,true);
end; $$;

revoke all on function atlas.record_flower_demand_order_core_v1(uuid,uuid,text,uuid,text,text,text,date,text,time without time zone,jsonb,text,text,boolean), atlas.record_flower_standing_order_core_v1(uuid,uuid,text,uuid,text,text,text,time without time zone,date,date,integer,jsonb,text,text,boolean), atlas.cancel_flower_demand_order_core_v1(uuid,uuid,text,text,text,text,boolean), atlas.cancel_flower_standing_order_core_v1(uuid,uuid,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function atlas.record_flower_demand_order_core_v1(uuid,uuid,text,uuid,text,text,text,date,text,time without time zone,jsonb,text,text,boolean), atlas.record_flower_standing_order_core_v1(uuid,uuid,text,uuid,text,text,text,time without time zone,date,date,integer,jsonb,text,text,boolean), atlas.cancel_flower_demand_order_core_v1(uuid,uuid,text,text,text,text,boolean), atlas.cancel_flower_standing_order_core_v1(uuid,uuid,text,text,text,text,boolean) to service_role;

revoke all on function atlas.record_flower_demand_order_for_member_v1(uuid,uuid,text,text,text,date,text,time without time zone,jsonb,text,text), atlas.owner_operator_record_flower_demand_order_v1(uuid,uuid,text,text,text,date,text,time without time zone,jsonb,text,text), atlas.record_flower_standing_order_for_member_v1(uuid,uuid,text,text,text,time without time zone,date,date,integer,jsonb,text,text), atlas.owner_operator_record_flower_standing_order_v1(uuid,uuid,text,text,text,time without time zone,date,date,integer,jsonb,text,text), atlas.cancel_flower_demand_order_for_member_v1(uuid,uuid,text,text,text), atlas.owner_operator_cancel_flower_demand_order_v1(uuid,uuid,text,text,text), atlas.cancel_flower_standing_order_for_member_v1(uuid,uuid,text,text,text), atlas.owner_operator_cancel_flower_standing_order_v1(uuid,uuid,text,text,text) from public, anon;
grant execute on function atlas.record_flower_demand_order_for_member_v1(uuid,uuid,text,text,text,date,text,time without time zone,jsonb,text,text), atlas.owner_operator_record_flower_demand_order_v1(uuid,uuid,text,text,text,date,text,time without time zone,jsonb,text,text), atlas.record_flower_standing_order_for_member_v1(uuid,uuid,text,text,text,time without time zone,date,date,integer,jsonb,text,text), atlas.owner_operator_record_flower_standing_order_v1(uuid,uuid,text,text,text,time without time zone,date,date,integer,jsonb,text,text), atlas.cancel_flower_demand_order_for_member_v1(uuid,uuid,text,text,text), atlas.owner_operator_cancel_flower_demand_order_v1(uuid,uuid,text,text,text), atlas.cancel_flower_standing_order_for_member_v1(uuid,uuid,text,text,text), atlas.owner_operator_cancel_flower_standing_order_v1(uuid,uuid,text,text,text) to authenticated, service_role;