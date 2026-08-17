create table atlas.flower_prospect_sale_line_links (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  prospect_route_line_id uuid not null references atlas.flower_prospect_route_lines(id) on delete restrict,
  prospect_release_event_id uuid not null references atlas.flower_prospect_route_release_events(id) on delete restrict,
  sale_order_line_id uuid not null references atlas.flower_sale_order_lines(id) on delete restrict,
  quantity numeric(10,2) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_prospect_sale_links_quantity_check check(quantity>0),
  constraint flower_prospect_sale_links_release_unique unique(prospect_release_event_id)
);
create index flower_prospect_sale_links_route_line_idx on atlas.flower_prospect_sale_line_links(prospect_route_line_id,created_at);
create index flower_prospect_sale_links_sale_line_idx on atlas.flower_prospect_sale_line_links(sale_order_line_id);
alter table atlas.flower_prospect_sale_line_links enable row level security;
create policy flower_prospect_sale_links_member_read_v1 on atlas.flower_prospect_sale_line_links for select to authenticated using(atlas.is_farm_member(farm_id));
revoke all on atlas.flower_prospect_sale_line_links from public,anon,authenticated;
grant select on atlas.flower_prospect_sale_line_links to authenticated;
grant all on atlas.flower_prospect_sale_line_links to service_role;

create or replace function atlas.validate_flower_prospect_sale_line_link_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare
  v_route_line atlas.flower_prospect_route_lines%rowtype;
  v_release atlas.flower_prospect_route_release_events%rowtype;
  v_sale_farm uuid; v_sale_ready uuid;
begin
  select * into v_route_line from atlas.flower_prospect_route_lines where id=new.prospect_route_line_id;
  select * into v_release from atlas.flower_prospect_route_release_events where id=new.prospect_release_event_id;
  select sol.farm_id,sol.ready_lot_id into v_sale_farm,v_sale_ready from atlas.flower_sale_order_lines sol where sol.id=new.sale_order_line_id;
  if v_route_line.id is null or v_release.id is null or v_sale_farm is null
     or v_route_line.farm_id is distinct from new.farm_id or v_release.farm_id is distinct from new.farm_id or v_sale_farm is distinct from new.farm_id then
    raise exception 'Prospect-to-sale link crosses farm boundaries.' using errcode='22023';
  end if;
  if v_release.prospect_route_line_id is distinct from v_route_line.id or v_release.reason_kind<>'converted_to_sale' then
    raise exception 'Prospect sale link requires a converted-to-sale release from the same route line.' using errcode='22023';
  end if;
  if v_sale_ready is distinct from v_route_line.ready_lot_id or new.quantity is distinct from v_release.quantity then
    raise exception 'Prospect sale link must preserve Ready lot and converted quantity.' using errcode='22023';
  end if;
  return new;
end; $$;
create trigger flower_prospect_sale_links_validate_v1 before insert on atlas.flower_prospect_sale_line_links for each row execute function atlas.validate_flower_prospect_sale_line_link_v1();
create trigger flower_prospect_sale_links_append_only_v1 before update or delete on atlas.flower_prospect_sale_line_links for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
revoke all on function atlas.validate_flower_prospect_sale_line_link_v1() from public,anon,authenticated;

create or replace function atlas.record_flower_sale_from_prospect_core_v1(
  p_prospect_route_line_id uuid,p_quantity numeric,p_unit_price numeric,
  p_effective_membership_id uuid,p_effective_role text,
  p_customer_label text,p_sales_channel text,p_tax_amount numeric,p_tip_amount numeric,
  p_note text,p_idempotency_key text,p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_line atlas.flower_prospect_route_lines%rowtype;
  v_route atlas.flower_prospect_routes%rowtype;
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_remaining numeric; v_customer text:=nullif(btrim(coalesce(p_customer_label,'')),''); v_buyer_name text;
  v_release atlas.flower_prospect_route_release_events%rowtype;
  v_sale_result jsonb; v_sale_id uuid; v_sale_line_id uuid; v_existing_sale uuid; v_existing_link uuid;
begin
  if v_key is null then raise exception 'Prospect-sale idempotency key is required.' using errcode='22023'; end if;
  select * into v_line from atlas.flower_prospect_route_lines where id=p_prospect_route_line_id for update;
  if v_line.id is null then raise exception 'Flower prospect route line not found.' using errcode='P0002'; end if;
  select * into v_route from atlas.flower_prospect_routes where id=v_line.prospect_route_id for update;
  select * into v_ready from atlas.flower_ready_inventory_lots where id=v_line.ready_lot_id for update;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_route.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record a prospect sale.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and v_route.assigned_membership_id is distinct from p_effective_membership_id then
    raise exception 'Farm Hand may record prospect sales only from a route assigned to them.' using errcode='42501';
  end if;
  if p_sales_channel not in ('wholesale','farm_pickup','delivery','market','subscription','event','other') then raise exception 'Choose a supported flower sales channel.' using errcode='22023'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Prospect sale quantity must be positive.' using errcode='22023'; end if;
  if p_unit_price is null or p_unit_price<0 then raise exception 'Prospect sale unit price is required and cannot be negative.' using errcode='22023'; end if;
  if v_ready.unit='bucket_equivalent' then
    if mod(p_quantity*4,1)<>0 then raise exception 'Prospect bucket sale must use quarter-bucket increments.' using errcode='22023'; end if;
  elsif mod(p_quantity,1)<>0 then raise exception 'Prospect counted sale units must be whole numbers.' using errcode='22023'; end if;

  select sl.id,so.id into v_existing_link,v_existing_sale
  from atlas.flower_prospect_sale_line_links psl
  join atlas.flower_sale_order_lines sl on sl.id=psl.sale_order_line_id
  join atlas.flower_sale_orders so on so.id=sl.sale_order_id
  where psl.prospect_route_line_id=v_line.id and so.farm_id=v_route.farm_id and so.idempotency_key=v_key
  limit 1;
  if v_existing_sale is not null then
    return jsonb_build_object('prospectRouteLineId',v_line.id,'saleOrderId',v_existing_sale,'saleLineId',v_existing_link,'deduplicated',true);
  end if;

  select greatest(v_line.quantity-coalesce(sum(r.quantity),0),0) into v_remaining
  from atlas.flower_prospect_route_release_events r where r.prospect_route_line_id=v_line.id;
  if p_quantity>v_remaining then raise exception 'Prospect sale exceeds quantity still on route.' using errcode='22023'; end if;

  if v_line.buyer_relationship_id is not null then
    select business_name into v_buyer_name from atlas.buyer_relationship_reconstruction where id=v_line.buyer_relationship_id and farm_id=v_route.farm_id;
  end if;
  v_customer:=coalesce(v_customer,v_buyer_name,v_line.destination_label);
  if v_line.buyer_relationship_id is null and v_customer is null then raise exception 'Prospect sale requires buyer relationship or customer label.' using errcode='22023'; end if;

  insert into atlas.flower_prospect_route_release_events(
    farm_id,prospect_route_line_id,reason_kind,quantity,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata
  ) values (
    v_route.farm_id,v_line.id,'converted_to_sale',p_quantity,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key||':release',auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','atomic_prospect_to_sale_conversion')
  ) returning * into v_release;

  v_sale_result:=atlas.record_flower_sale_core_v2(
    v_route.farm_id,p_effective_membership_id,p_effective_role,v_line.buyer_relationship_id,v_customer,p_sales_channel,
    'prospect-route-line:'||v_line.id::text,
    jsonb_build_array(jsonb_build_object('readyLotId',v_line.ready_lot_id,'quantity',p_quantity,'unitPrice',p_unit_price)),
    coalesce(p_tax_amount,0),coalesce(p_tip_amount,0),'immediate_handoff',null,null,null,null,
    coalesce(nullif(btrim(coalesce(p_note,'')),''),'Sold from prospect route '||v_route.route_label),v_key,p_operator_mode
  );
  v_sale_id:=(v_sale_result->>'saleOrderId')::uuid;
  if v_sale_id is null then raise exception 'Prospect conversion did not produce a sale order.' using errcode='P0001'; end if;
  select id into v_sale_line_id from atlas.flower_sale_order_lines where sale_order_id=v_sale_id and ready_lot_id=v_line.ready_lot_id order by created_at limit 1;
  if v_sale_line_id is null then raise exception 'Prospect conversion did not produce its Ready sale line.' using errcode='P0001'; end if;

  insert into atlas.flower_prospect_sale_line_links(farm_id,prospect_route_line_id,prospect_release_event_id,sale_order_line_id,quantity,metadata)
  values(v_route.farm_id,v_line.id,v_release.id,v_sale_line_id,p_quantity,jsonb_build_object('truthBoundary','prospect_to_sale_provenance','conversionIdempotencyKey',v_key));

  return jsonb_build_object(
    'prospectRouteId',v_route.id,'prospectRouteLineId',v_line.id,'convertedQuantity',p_quantity,
    'remainingOnProspectRoute',greatest(v_remaining-p_quantity,0),'saleOrderId',v_sale_id,'saleLineId',v_sale_line_id,
    'releaseEventId',v_release.id,'sale',v_sale_result,'deduplicated',false
  );
end; $$;

create or replace function atlas.record_flower_sale_from_prospect_for_member_v1(
  p_farm_id uuid,p_prospect_route_line_id uuid,p_quantity numeric,p_unit_price numeric,p_customer_label text,p_sales_channel text,p_tax_amount numeric,p_tip_amount numeric,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_sale_from_prospect_core_v1(p_prospect_route_line_id,p_quantity,p_unit_price,v_membership,v_role,p_customer_label,p_sales_channel,p_tax_amount,p_tip_amount,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_record_flower_sale_from_prospect_v1(
  p_effective_membership_id uuid,p_prospect_route_line_id uuid,p_quantity numeric,p_unit_price numeric,p_customer_label text,p_sales_channel text,p_tax_amount numeric,p_tip_amount numeric,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_sale_from_prospect_core_v1(p_prospect_route_line_id,p_quantity,p_unit_price,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_customer_label,p_sales_channel,p_tax_amount,p_tip_amount,p_note,p_idempotency_key,true);
end; $$;

revoke all on function atlas.record_flower_sale_from_prospect_core_v1(uuid,numeric,numeric,uuid,text,text,text,numeric,numeric,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_sale_from_prospect_core_v1(uuid,numeric,numeric,uuid,text,text,text,numeric,numeric,text,text,boolean) to service_role;
revoke all on function atlas.record_flower_sale_from_prospect_for_member_v1(uuid,uuid,numeric,numeric,text,text,numeric,numeric,text,text),atlas.owner_operator_record_flower_sale_from_prospect_v1(uuid,uuid,numeric,numeric,text,text,numeric,numeric,text,text) from public,anon;
grant execute on function atlas.record_flower_sale_from_prospect_for_member_v1(uuid,uuid,numeric,numeric,text,text,numeric,numeric,text,text),atlas.owner_operator_record_flower_sale_from_prospect_v1(uuid,uuid,numeric,numeric,text,text,numeric,numeric,text,text) to authenticated,service_role;