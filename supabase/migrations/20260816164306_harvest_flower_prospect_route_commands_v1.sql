create or replace function atlas.record_flower_prospect_route_core_v1(
  p_farm_id uuid,p_effective_membership_id uuid,p_effective_role text,p_assigned_membership_id uuid,
  p_route_date date,p_route_label text,p_lines jsonb,p_note text,p_idempotency_key text,p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_today date:=(now() at time zone 'America/Chicago')::date;
  v_member atlas.farm_memberships%rowtype; v_assignee atlas.farm_memberships%rowtype; v_existing atlas.flower_prospect_routes%rowtype; v_route atlas.flower_prospect_routes%rowtype;
  v_line jsonb; v_ready atlas.flower_ready_inventory_lots%rowtype; v_ready_id uuid; v_buyer uuid; v_quantity numeric; v_available numeric; v_dest text; v_rows jsonb:='[]'::jsonb; v_inserted atlas.flower_prospect_route_lines%rowtype;
begin
  if v_key is null then raise exception 'Prospect-route idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to put Ready inventory on a prospect route.' using errcode='42501'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  select * into v_assignee from atlas.farm_memberships where id=p_assigned_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_assignee.id is null or not v_assignee.active or v_assignee.farm_id is distinct from p_farm_id then raise exception 'Prospect-route assignee must be active on this farm.' using errcode='22023'; end if;
  if p_route_date is null or p_route_date>v_today then raise exception 'ON_PROSPECT_ROUTE is an actual custody state and cannot be recorded for a future date.' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_route_label,'')),'') is null then raise exception 'Prospect route requires a label.' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>48 then raise exception 'Prospect route requires between 1 and 48 Ready inventory lines.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':flower-prospect:'||v_key,0));
  select * into v_existing from atlas.flower_prospect_routes where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'readyLotId',l.ready_lot_id,'quantity',l.quantity,'buyerRelationshipId',l.buyer_relationship_id,'destinationLabel',l.destination_label) order by l.created_at),'[]'::jsonb) into v_rows from atlas.flower_prospect_route_lines l where l.prospect_route_id=v_existing.id;
    return jsonb_build_object('prospectRouteId',v_existing.id,'lines',v_rows,'deduplicated',true);
  end if;
  insert into atlas.flower_prospect_routes(farm_id,route_date,route_label,assigned_membership_id,recorded_by_membership_id,note,idempotency_key,created_by_user_id,metadata)
  values(p_farm_id,p_route_date,btrim(p_route_label),p_assigned_membership_id,p_effective_membership_id,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','actual_prospect_custody','saleTruth',false,'workerTimeScheduled',false)) returning * into v_route;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_ready_id:=nullif(v_line->>'readyLotId','')::uuid; exception when others then raise exception 'Invalid readyLotId in prospect route.' using errcode='22023'; end;
    begin v_buyer:=nullif(v_line->>'buyerRelationshipId','')::uuid; exception when others then raise exception 'Invalid buyerRelationshipId in prospect route.' using errcode='22023'; end;
    begin v_quantity:=(v_line->>'quantity')::numeric; exception when others then raise exception 'Invalid quantity in prospect route.' using errcode='22023'; end;
    v_dest:=nullif(btrim(coalesce(v_line->>'destinationLabel','')),'');
    select * into v_ready from atlas.flower_ready_inventory_lots where id=v_ready_id for update;
    if v_ready.id is null or v_ready.farm_id is distinct from p_farm_id then raise exception 'Prospect Ready lot is outside this farm.' using errcode='22023'; end if;
    if v_quantity is null or v_quantity<=0 then raise exception 'Prospect quantity must be positive.' using errcode='22023'; end if;
    if v_ready.unit='bucket_equivalent' then
      if mod(v_quantity*4,1)<>0 then raise exception 'Prospect bucket quantity must use quarter-bucket increments.' using errcode='22023'; end if;
    elsif mod(v_quantity,1)<>0 then raise exception 'Prospect counted units must be whole numbers.' using errcode='22023'; end if;
    if v_buyer is not null and not exists(select 1 from atlas.buyer_relationship_reconstruction b where b.id=v_buyer and b.farm_id=p_farm_id) then raise exception 'Prospect buyer is outside this farm.' using errcode='22023'; end if;
    v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
    if v_quantity>coalesce(v_available,0) then raise exception 'Prospect route would exceed Ready quantity still Available.' using errcode='22023'; end if;
    insert into atlas.flower_prospect_route_lines(farm_id,prospect_route_id,ready_lot_id,buyer_relationship_id,destination_label,quantity,metadata)
    values(p_farm_id,v_route.id,v_ready.id,v_buyer,v_dest,v_quantity,jsonb_build_object('truthBoundary','on_prospect_route','saleTruth',false)) returning * into v_inserted;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_inserted.id,'readyLotId',v_inserted.ready_lot_id,'quantity',v_inserted.quantity,'buyerRelationshipId',v_inserted.buyer_relationship_id,'destinationLabel',v_inserted.destination_label));
  end loop;
  return jsonb_build_object('prospectRouteId',v_route.id,'routeDate',v_route.route_date,'assignedMembershipId',v_route.assigned_membership_id,'lines',v_rows,'deduplicated',false);
end; $$;

create or replace function atlas.record_flower_prospect_route_for_member_v1(p_farm_id uuid,p_assigned_membership_id uuid,p_route_date date,p_route_label text,p_lines jsonb,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_prospect_route_core_v1(p_farm_id,v_membership,v_role,p_assigned_membership_id,p_route_date,p_route_label,p_lines,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_record_flower_prospect_route_v1(p_effective_membership_id uuid,p_assigned_membership_id uuid,p_route_date date,p_route_label text,p_lines jsonb,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb; v_farm uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id); v_farm:=nullif(v_context->>'farmId','')::uuid;
  return atlas.record_flower_prospect_route_core_v1(v_farm,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_assigned_membership_id,p_route_date,p_route_label,p_lines,p_note,p_idempotency_key,true);
end; $$;

create or replace function atlas.release_flower_prospect_route_core_v1(p_prospect_route_id uuid,p_effective_membership_id uuid,p_effective_role text,p_reason_kind text,p_note text,p_idempotency_key text,p_operator_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_route atlas.flower_prospect_routes%rowtype; v_member atlas.farm_memberships%rowtype; v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_line atlas.flower_prospect_route_lines%rowtype; v_count integer:=0; v_existing integer;
begin
  if v_key is null then raise exception 'Prospect-route release idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to release prospect-route inventory.' using errcode='42501'; end if;
  if p_reason_kind not in ('returned','entry_correction','other') then raise exception 'Choose a supported manual prospect-route release reason.' using errcode='22023'; end if;
  select * into v_route from atlas.flower_prospect_routes where id=p_prospect_route_id for update;
  if v_route.id is null then raise exception 'Flower prospect route not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_route.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  for v_line in select * from atlas.flower_prospect_route_lines l where l.prospect_route_id=v_route.id order by l.created_at for update loop
    if not exists(select 1 from atlas.flower_prospect_route_release_events r where r.prospect_route_line_id=v_line.id) then
      insert into atlas.flower_prospect_route_release_events(farm_id,prospect_route_line_id,reason_kind,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata)
      values(v_route.farm_id,v_line.id,p_reason_kind,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key||':'||v_line.id::text,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','prospect_custody_release'));
      v_count:=v_count+1;
    end if;
  end loop;
  select count(*) into v_existing from atlas.flower_prospect_route_lines l join atlas.flower_prospect_route_release_events r on r.prospect_route_line_id=l.id where l.prospect_route_id=v_route.id;
  return jsonb_build_object('prospectRouteId',v_route.id,'releasedNowCount',v_count,'releasedTotalCount',v_existing,'lineCount',(select count(*) from atlas.flower_prospect_route_lines where prospect_route_id=v_route.id),'deduplicated',v_count=0);
end; $$;

create or replace function atlas.release_flower_prospect_route_for_member_v1(p_farm_id uuid,p_prospect_route_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.release_flower_prospect_route_core_v1(p_prospect_route_id,v_membership,v_role,p_reason_kind,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_release_flower_prospect_route_v1(p_effective_membership_id uuid,p_prospect_route_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.release_flower_prospect_route_core_v1(p_prospect_route_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_reason_kind,p_note,p_idempotency_key,true);
end; $$;

revoke all on function atlas.record_flower_prospect_route_core_v1(uuid,uuid,text,uuid,date,text,jsonb,text,text,boolean),atlas.release_flower_prospect_route_core_v1(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_prospect_route_core_v1(uuid,uuid,text,uuid,date,text,jsonb,text,text,boolean),atlas.release_flower_prospect_route_core_v1(uuid,uuid,text,text,text,text,boolean) to service_role;
revoke all on function atlas.record_flower_prospect_route_for_member_v1(uuid,uuid,date,text,jsonb,text,text),atlas.owner_operator_record_flower_prospect_route_v1(uuid,uuid,date,text,jsonb,text,text),atlas.release_flower_prospect_route_for_member_v1(uuid,uuid,text,text,text),atlas.owner_operator_release_flower_prospect_route_v1(uuid,uuid,text,text,text) from public,anon;
grant execute on function atlas.record_flower_prospect_route_for_member_v1(uuid,uuid,date,text,jsonb,text,text),atlas.owner_operator_record_flower_prospect_route_v1(uuid,uuid,date,text,jsonb,text,text),atlas.release_flower_prospect_route_for_member_v1(uuid,uuid,text,text,text),atlas.owner_operator_release_flower_prospect_route_v1(uuid,uuid,text,text,text) to authenticated,service_role;