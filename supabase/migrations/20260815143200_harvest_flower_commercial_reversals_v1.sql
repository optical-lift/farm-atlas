-- Harvest commercial safety layer: append-only cancellation and Ready disposition truth.
--
-- Ready birth rows and original sale rows remain immutable. Availability changes only by
-- projection from active sale claims and explicit disposition/cancellation events.

create table atlas.flower_sale_order_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  sale_order_id uuid not null references atlas.flower_sale_orders(id) on delete restrict,
  reason_kind text not null,
  note text,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_sale_order_cancellation_order_unique unique (sale_order_id),
  constraint flower_sale_order_cancellation_idempotency_unique unique (farm_id,idempotency_key),
  constraint flower_sale_order_cancellation_reason_check check (
    reason_kind in ('customer_cancelled','seller_cancelled','entry_correction','other')
  )
);

comment on table atlas.flower_sale_order_cancellation_events is
  'Append-only cancellation fact for an unfulfilled flower sale. It releases the sale claims by projection; it does not delete the order or Ready lineage and does not imply a financial refund.';

create table atlas.flower_ready_inventory_disposition_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  ready_lot_id uuid not null references atlas.flower_ready_inventory_lots(id) on delete restrict,
  disposition_kind text not null,
  quantity numeric(10,2) not null,
  unit text not null,
  note text,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_ready_disposition_idempotency_unique unique (farm_id,idempotency_key),
  constraint flower_ready_disposition_kind_check check (
    disposition_kind in ('spoilage','donation','write_off')
  ),
  constraint flower_ready_disposition_quantity_check check (quantity > 0)
);

comment on table atlas.flower_ready_inventory_disposition_events is
  'Append-only removal of otherwise Available Ready inventory for spoilage, donation, or write-off. Ready birth truth is never rewritten.';

create index flower_sale_order_cancellation_farm_date_idx
  on atlas.flower_sale_order_cancellation_events(farm_id,created_at desc);
create index flower_sale_order_cancellation_membership_idx
  on atlas.flower_sale_order_cancellation_events(recorded_by_membership_id,created_at desc);
create index flower_ready_disposition_farm_date_idx
  on atlas.flower_ready_inventory_disposition_events(farm_id,created_at desc);
create index flower_ready_disposition_lot_date_idx
  on atlas.flower_ready_inventory_disposition_events(ready_lot_id,created_at desc);
create index flower_ready_disposition_membership_idx
  on atlas.flower_ready_inventory_disposition_events(recorded_by_membership_id,created_at desc);

create or replace function atlas.prevent_flower_commercial_reversal_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  raise exception 'Flower cancellation and disposition truth is append-only.' using errcode='55000';
end;
$function$;

revoke all on function atlas.prevent_flower_commercial_reversal_mutation_v1() from public,anon,authenticated;
grant execute on function atlas.prevent_flower_commercial_reversal_mutation_v1() to service_role;

create trigger flower_sale_order_cancellation_append_only_v1
before update or delete on atlas.flower_sale_order_cancellation_events
for each row execute function atlas.prevent_flower_commercial_reversal_mutation_v1();

create trigger flower_ready_disposition_append_only_v1
before update or delete on atlas.flower_ready_inventory_disposition_events
for each row execute function atlas.prevent_flower_commercial_reversal_mutation_v1();

alter table atlas.flower_sale_order_cancellation_events enable row level security;
alter table atlas.flower_ready_inventory_disposition_events enable row level security;

create policy flower_sale_order_cancellation_member_read_v1
on atlas.flower_sale_order_cancellation_events
for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy flower_ready_disposition_member_read_v1
on atlas.flower_ready_inventory_disposition_events
for select to authenticated
using (atlas.is_farm_member(farm_id));

revoke all on atlas.flower_sale_order_cancellation_events from public,anon,authenticated;
revoke all on atlas.flower_ready_inventory_disposition_events from public,anon,authenticated;
grant select on atlas.flower_sale_order_cancellation_events to authenticated;
grant select on atlas.flower_ready_inventory_disposition_events to authenticated;
grant all on atlas.flower_sale_order_cancellation_events to service_role;
grant all on atlas.flower_ready_inventory_disposition_events to service_role;

create or replace function atlas.flower_ready_available_quantity_v1(p_ready_lot_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select greatest(
    0::numeric,
    ready.quantity
      - coalesce((
          select sum(line.quantity)
          from atlas.flower_sale_order_lines line
          join atlas.flower_sale_orders sale on sale.id=line.sale_order_id
          where line.ready_lot_id=ready.id
            and not exists (
              select 1
              from atlas.flower_sale_order_cancellation_events cancellation
              where cancellation.sale_order_id=sale.id
            )
        ),0::numeric)
      - coalesce((
          select sum(disposition.quantity)
          from atlas.flower_ready_inventory_disposition_events disposition
          where disposition.ready_lot_id=ready.id
        ),0::numeric)
  )
  from atlas.flower_ready_inventory_lots ready
  where ready.id=p_ready_lot_id;
$function$;

comment on function atlas.flower_ready_available_quantity_v1(uuid) is
  'Canonical remaining Ready quantity: immutable birth quantity minus active sale claims minus append-only physical/commercial dispositions. Cancelled sale claims are released by projection.';

revoke all on function atlas.flower_ready_available_quantity_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.flower_ready_available_quantity_v1(uuid) to service_role;

create or replace function atlas.validate_flower_ready_disposition_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_available numeric;
begin
  select * into v_ready
  from atlas.flower_ready_inventory_lots
  where id=new.ready_lot_id
  for update;
  if v_ready.id is null or v_ready.farm_id is distinct from new.farm_id then
    raise exception 'Ready lot is outside this disposition farm.' using errcode='22023';
  end if;
  if new.unit is distinct from v_ready.unit then
    raise exception 'Disposition unit must preserve the Ready lot unit exactly.' using errcode='22023';
  end if;
  if v_ready.unit='bucket_equivalent' then
    if mod(new.quantity*4,1)<>0 then
      raise exception 'Bucket disposition quantity must use quarter-bucket increments.' using errcode='22023';
    end if;
  elsif mod(new.quantity,1)<>0 then
    raise exception 'Counted disposition units must be whole numbers.' using errcode='22023';
  end if;

  select * into v_member from atlas.farm_memberships where id=new.recorded_by_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from new.farm_id then
    raise exception 'Disposition recorder must be an active member of this farm.' using errcode='22023';
  end if;

  v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
  if new.quantity>coalesce(v_available,0) then
    raise exception 'Disposition would remove more than the Ready quantity currently Available.' using errcode='22023';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_flower_ready_disposition_v1() from public,anon,authenticated;
grant execute on function atlas.validate_flower_ready_disposition_v1() to service_role;

create trigger flower_ready_disposition_validate_v1
before insert on atlas.flower_ready_inventory_disposition_events
for each row execute function atlas.validate_flower_ready_disposition_v1();

-- Harden sale-line claims so released cancellation claims and prior dispositions are
-- reflected in the same authoritative availability function.
create or replace function atlas.validate_flower_sale_order_line_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_order atlas.flower_sale_orders%rowtype;
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_available numeric;
begin
  select * into v_order from atlas.flower_sale_orders where id=new.sale_order_id;
  if v_order.id is null or v_order.farm_id is distinct from new.farm_id then
    raise exception 'Sale line order is outside this farm.' using errcode='22023';
  end if;
  if exists (
    select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=v_order.id
  ) then
    raise exception 'A cancelled sale cannot receive new Ready claims.' using errcode='22023';
  end if;

  select * into v_ready from atlas.flower_ready_inventory_lots where id=new.ready_lot_id for update;
  if v_ready.id is null or v_ready.farm_id is distinct from new.farm_id then
    raise exception 'Ready lot is outside this sale farm.' using errcode='22023';
  end if;
  if new.inventory_kind is distinct from v_ready.inventory_kind or new.unit is distinct from v_ready.unit then
    raise exception 'Sale line must preserve Ready product kind and unit exactly.' using errcode='22023';
  end if;
  if v_ready.unit='bucket_equivalent' then
    if mod(new.quantity*4,1)<>0 then
      raise exception 'Bucket-equivalent sale quantity must use quarter-bucket increments.' using errcode='22023';
    end if;
  elsif mod(new.quantity,1)<>0 then
    raise exception 'Counted sale units must be whole numbers.' using errcode='22023';
  end if;

  v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
  if new.quantity>coalesce(v_available,0) then
    raise exception 'Sale would claim more than the Ready quantity still Available.' using errcode='22023';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_flower_sale_order_line_v1() from public,anon,authenticated;
grant execute on function atlas.validate_flower_sale_order_line_v1() to service_role;

-- A cancelled sale can never be fulfilled, even if a stale task somehow survives.
create or replace function atlas.validate_flower_fulfillment_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_order atlas.flower_sale_orders%rowtype;
  v_member atlas.farm_memberships%rowtype;
begin
  select * into v_order from atlas.flower_sale_orders where id=new.sale_order_id;
  if v_order.id is null or v_order.farm_id is distinct from new.farm_id then
    raise exception 'Fulfillment order is outside this farm.' using errcode='22023';
  end if;
  if exists (
    select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=v_order.id
  ) then
    raise exception 'A cancelled flower sale cannot be fulfilled.' using errcode='22023';
  end if;
  if new.fulfillment_method is distinct from v_order.fulfillment_mode then
    raise exception 'Fulfillment method must match the committed order method.' using errcode='22023';
  end if;
  select * into v_member from atlas.farm_memberships where id=new.recorded_by_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from new.farm_id then
    raise exception 'Fulfillment recorder must be an active member of this farm.' using errcode='22023';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_flower_fulfillment_event_v1() from public,anon,authenticated;
grant execute on function atlas.validate_flower_fulfillment_event_v1() to service_role;

create or replace function atlas.cancel_flower_sale_core_v1(
  p_farm_id uuid,
  p_sale_order_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_reason_kind text,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_order atlas.flower_sale_orders%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.flower_sale_order_cancellation_events%rowtype;
  v_event atlas.flower_sale_order_cancellation_events%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_task atlas.tasks%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_reason text:=lower(btrim(coalesce(p_reason_kind,'')));
  v_transition jsonb;
begin
  if v_key is null then raise exception 'Sale cancellation idempotency key is required.' using errcode='22023'; end if;
  if v_reason not in ('customer_cancelled','seller_cancelled','entry_correction','other') then
    raise exception 'Choose a supported flower sale cancellation reason.' using errcode='22023';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot cancel flower sales.' using errcode='42501';
  end if;

  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_order from atlas.flower_sale_orders where id=p_sale_order_id for update;
  if v_order.id is null then raise exception 'Flower sale order not found.' using errcode='P0002'; end if;
  if v_order.farm_id is distinct from p_farm_id then
    raise exception 'Flower sale order is outside this farm.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and v_order.recorded_by_membership_id is distinct from p_effective_membership_id then
    raise exception 'Farm Hand may cancel only a flower sale they recorded.' using errcode='42501';
  end if;
  if exists (select 1 from atlas.flower_fulfillment_events f where f.sale_order_id=v_order.id) then
    raise exception 'A fulfilled flower sale cannot be cancelled by the claim-release path.' using errcode='22023';
  end if;

  select * into v_existing
  from atlas.flower_sale_order_cancellation_events
  where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('cancellationEventId',v_existing.id,'saleOrderId',v_existing.sale_order_id,'deduplicated',true);
  end if;
  select * into v_existing
  from atlas.flower_sale_order_cancellation_events
  where sale_order_id=v_order.id;
  if v_existing.id is not null then
    return jsonb_build_object('cancellationEventId',v_existing.id,'saleOrderId',v_existing.sale_order_id,'deduplicated',true,'alreadyCancelled',true);
  end if;

  insert into atlas.flower_sale_order_cancellation_events(
    farm_id,sale_order_id,reason_kind,note,recorded_by_membership_id,idempotency_key,
    created_by_user_id,metadata
  ) values (
    p_farm_id,v_order.id,v_reason,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key,
    auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','commercial_claim_release')
  ) returning * into v_event;

  select * into v_occurrence
  from atlas.planned_work_occurrences
  where farm_id=p_farm_id
    and source_kind='flower_sale_order'
    and source_id=v_order.id
    and state not in ('completed','cancelled')
  order by created_at desc
  limit 1
  for update;

  if v_occurrence.id is not null then
    if v_occurrence.released_task_id is not null then
      select * into v_task from atlas.tasks where id=v_occurrence.released_task_id for update;
      if v_task.id is not null and v_task.status in ('open','blocked') then
        v_transition:=atlas.record_task_transition_v1_internal(
          v_task.id,'changed_plan',left(v_key,110)||':fulfillment-task',null,
          coalesce(nullif(btrim(coalesce(p_note,'')),''),'Flower sale cancelled'),
          'sale_cancelled','fulfill','flower_fulfillment',
          jsonb_build_object('flower_sale_order_id',v_order.id,'flower_sale_cancellation_event_id',v_event.id),null
        );
      end if;
    end if;
    update atlas.planned_work_occurrences
    set state='cancelled',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'cancelledBy','flower_sale_cancellation_v1',
          'flowerSaleCancellationEventId',v_event.id,
          'cancelledAt',now()
        ),
        updated_at=now()
    where id=v_occurrence.id and state<>'completed';
  end if;

  return jsonb_build_object(
    'cancellationEventId',v_event.id,
    'saleOrderId',v_order.id,
    'fulfillmentOccurrenceId',v_occurrence.id,
    'fulfillmentTaskTransition',v_transition,
    'deduplicated',false
  );
end;
$function$;

comment on function atlas.cancel_flower_sale_core_v1(uuid,uuid,uuid,text,text,text,text,boolean) is
  'Append-only unfulfilled flower-sale cancellation. Releases Ready claims by projection and retires future fulfillment work without deleting the original sale.';
revoke all on function atlas.cancel_flower_sale_core_v1(uuid,uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.cancel_flower_sale_core_v1(uuid,uuid,uuid,text,text,text,text,boolean) to service_role;

create or replace function atlas.record_flower_ready_disposition_core_v1(
  p_farm_id uuid,
  p_ready_lot_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_disposition_kind text,
  p_quantity numeric,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.flower_ready_inventory_disposition_events%rowtype;
  v_event atlas.flower_ready_inventory_disposition_events%rowtype;
  v_kind text:=lower(btrim(coalesce(p_disposition_kind,'')));
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_available numeric;
begin
  if v_key is null then raise exception 'Ready disposition idempotency key is required.' using errcode='22023'; end if;
  if v_kind not in ('spoilage','donation','write_off') then
    raise exception 'Choose a supported Ready disposition.' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Disposition quantity must be positive.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record Ready disposition.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and v_kind<>'spoilage' then
    raise exception 'Farm Hand may record physical spoilage; donation and write-off require management authority.' using errcode='42501';
  end if;

  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_existing
  from atlas.flower_ready_inventory_disposition_events
  where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('dispositionEventId',v_existing.id,'readyLotId',v_existing.ready_lot_id,'deduplicated',true);
  end if;

  select * into v_ready from atlas.flower_ready_inventory_lots where id=p_ready_lot_id for update;
  if v_ready.id is null then raise exception 'Ready inventory lot not found.' using errcode='P0002'; end if;
  if v_ready.farm_id is distinct from p_farm_id then raise exception 'Ready inventory lot is outside this farm.' using errcode='42501'; end if;

  v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
  if p_quantity>coalesce(v_available,0) then
    raise exception 'Disposition would remove more than the Ready quantity currently Available.' using errcode='22023';
  end if;

  insert into atlas.flower_ready_inventory_disposition_events(
    farm_id,ready_lot_id,disposition_kind,quantity,unit,note,recorded_by_membership_id,
    idempotency_key,created_by_user_id,metadata
  ) values (
    p_farm_id,v_ready.id,v_kind,p_quantity,v_ready.unit,nullif(btrim(coalesce(p_note,'')),''),
    p_effective_membership_id,v_key,auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','ready_inventory_disposition')
  ) returning * into v_event;

  return jsonb_build_object(
    'dispositionEventId',v_event.id,
    'readyLotId',v_ready.id,
    'dispositionKind',v_event.disposition_kind,
    'quantity',v_event.quantity,
    'unit',v_event.unit,
    'availableAfter',atlas.flower_ready_available_quantity_v1(v_ready.id),
    'deduplicated',false
  );
end;
$function$;

revoke all on function atlas.record_flower_ready_disposition_core_v1(uuid,uuid,uuid,text,text,numeric,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_ready_disposition_core_v1(uuid,uuid,uuid,text,text,numeric,text,text,boolean) to service_role;

create or replace function atlas.cancel_flower_sale_for_member_v1(
  p_farm_id uuid,p_sale_order_id uuid,p_reason_kind text,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.cancel_flower_sale_core_v1(p_farm_id,p_sale_order_id,v_membership,v_role,p_reason_kind,p_note,p_idempotency_key,false);
end;
$function$;

create or replace function atlas.owner_operator_cancel_flower_sale_v1(
  p_effective_membership_id uuid,p_sale_order_id uuid,p_reason_kind text,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare v_context jsonb; v_farm_id uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id:=nullif(v_context->>'farmId','')::uuid;
  if v_farm_id is null then raise exception 'Owner operator context has no farm scope.' using errcode='42501'; end if;
  return atlas.cancel_flower_sale_core_v1(
    v_farm_id,p_sale_order_id,(v_context#>>'{effective,membershipId}')::uuid,
    v_context#>>'{effective,role}',p_reason_kind,p_note,p_idempotency_key,true
  );
end;
$function$;

create or replace function atlas.record_flower_ready_disposition_for_member_v1(
  p_farm_id uuid,p_ready_lot_id uuid,p_disposition_kind text,p_quantity numeric,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_flower_ready_disposition_core_v1(
    p_farm_id,p_ready_lot_id,v_membership,v_role,p_disposition_kind,p_quantity,p_note,p_idempotency_key,false
  );
end;
$function$;

create or replace function atlas.owner_operator_record_flower_ready_disposition_v1(
  p_effective_membership_id uuid,p_ready_lot_id uuid,p_disposition_kind text,p_quantity numeric,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare v_context jsonb; v_farm_id uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id:=nullif(v_context->>'farmId','')::uuid;
  if v_farm_id is null then raise exception 'Owner operator context has no farm scope.' using errcode='42501'; end if;
  return atlas.record_flower_ready_disposition_core_v1(
    v_farm_id,p_ready_lot_id,(v_context#>>'{effective,membershipId}')::uuid,
    v_context#>>'{effective,role}',p_disposition_kind,p_quantity,p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.cancel_flower_sale_for_member_v1(uuid,uuid,text,text,text) from public,anon;
revoke all on function atlas.owner_operator_cancel_flower_sale_v1(uuid,uuid,text,text,text) from public,anon;
revoke all on function atlas.record_flower_ready_disposition_for_member_v1(uuid,uuid,text,numeric,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_ready_disposition_v1(uuid,uuid,text,numeric,text,text) from public,anon;
grant execute on function atlas.cancel_flower_sale_for_member_v1(uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_cancel_flower_sale_v1(uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function atlas.record_flower_ready_disposition_for_member_v1(uuid,uuid,text,numeric,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_ready_disposition_v1(uuid,uuid,text,numeric,text,text) to authenticated,service_role;

-- v2 commercial write keeps the public wrapper signatures stable while making availability
-- cancellation/disposition aware. Deterministic Ready-row locks serialize competing claims.
create or replace function atlas.record_flower_sale_core_v2(
  p_farm_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
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
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_existing atlas.flower_sale_orders%rowtype;
  v_order atlas.flower_sale_orders%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_buyer_farm uuid;
  v_source_task_farm uuid;
  v_line jsonb;
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_ready_id uuid;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_available numeric;
  v_subtotal numeric(12,2):=0;
  v_tax numeric(12,2):=coalesce(p_tax_amount,0);
  v_tip numeric(12,2):=coalesce(p_tip_amount,0);
  v_line_count integer;
  v_distinct_lot_count integer;
  v_line_rows jsonb:='[]'::jsonb;
  v_inserted_line atlas.flower_sale_order_lines%rowtype;
  v_fulfillment atlas.flower_fulfillment_events%rowtype;
  v_fulfillment_task jsonb;
  v_assignee uuid;
  v_customer_label text:=nullif(btrim(coalesce(p_customer_label,'')),'');
begin
  if v_key is null then raise exception 'Sale idempotency key is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||v_key,0));
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record flower sales.' using errcode='42501'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  select * into v_existing from atlas.flower_sale_orders where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'readyLotId',l.ready_lot_id,'inventoryKind',l.inventory_kind,'quantity',l.quantity,'unit',l.unit,'unitPrice',l.unit_price,'lineTotal',l.line_total) order by l.created_at),'[]'::jsonb)
    into v_line_rows from atlas.flower_sale_order_lines l where l.sale_order_id=v_existing.id;
    select * into v_fulfillment from atlas.flower_fulfillment_events where sale_order_id=v_existing.id;
    return jsonb_build_object('saleOrderId',v_existing.id,'lines',v_line_rows,'totalAmount',v_existing.total_amount,'fulfilled',v_fulfillment.id is not null,'deduplicated',true);
  end if;

  if p_sales_channel not in ('wholesale','farm_pickup','delivery','market','subscription','event','other') then raise exception 'Choose a supported flower sales channel.' using errcode='22023'; end if;
  if p_fulfillment_mode not in ('immediate_handoff','pickup','delivery') then raise exception 'Choose a supported fulfillment mode.' using errcode='22023'; end if;
  if v_tax<0 or v_tip<0 then raise exception 'Tax and tip cannot be negative.' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>24 then raise exception 'Sale requires between 1 and 24 Ready inventory lines.' using errcode='22023'; end if;
  select count(*),count(distinct value->>'readyLotId') into v_line_count,v_distinct_lot_count from jsonb_array_elements(p_lines);
  if v_line_count<>v_distinct_lot_count then raise exception 'A Ready lot may appear only once in a sale.' using errcode='22023'; end if;

  if p_buyer_relationship_id is not null then
    select farm_id,business_name into v_buyer_farm,v_customer_label
    from atlas.buyer_relationship_reconstruction where id=p_buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from p_farm_id then raise exception 'Buyer relationship is outside this farm.' using errcode='22023'; end if;
    v_customer_label:=coalesce(nullif(btrim(coalesce(p_customer_label,'')),''),v_customer_label);
  end if;
  if p_source_task_id is not null then
    select farm_id into v_source_task_farm from atlas.tasks where id=p_source_task_id;
    if v_source_task_farm is null or v_source_task_farm is distinct from p_farm_id then raise exception 'Sale source task is outside the sale farm.' using errcode='22023'; end if;
  end if;

  if p_fulfillment_mode='immediate_handoff' then
    if p_fulfillment_due_date is not null or p_fulfillment_due_time is not null then raise exception 'Immediate handoff cannot carry a future fulfillment window.' using errcode='22023'; end if;
    v_assignee:=null;
  else
    if p_fulfillment_due_date is null then raise exception 'Future pickup or delivery requires a due date.' using errcode='22023'; end if;
    v_assignee:=coalesce(p_fulfillment_membership_id,p_effective_membership_id);
    select * into v_member from atlas.farm_memberships where id=v_assignee;
    if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then raise exception 'Fulfillment assignee must be an active member of this farm.' using errcode='22023'; end if;
    if p_effective_role='farm_hand' and v_assignee is distinct from p_effective_membership_id then raise exception 'Farm Hand may assign fulfillment only to self.' using errcode='42501'; end if;
  end if;

  -- Lock every referenced Ready lot in deterministic UUID order before evaluating availability.
  for v_ready in
    select ready.*
    from atlas.flower_ready_inventory_lots ready
    where ready.id in (
      select (value->>'readyLotId')::uuid from jsonb_array_elements(p_lines)
    )
    order by ready.id
    for update
  loop
    if v_ready.farm_id is distinct from p_farm_id then raise exception 'Sale line Ready lot is outside this farm.' using errcode='22023'; end if;
  end loop;
  if (select count(*) from atlas.flower_ready_inventory_lots ready where ready.id in (select (value->>'readyLotId')::uuid from jsonb_array_elements(p_lines)))<>v_line_count then
    raise exception 'One or more Ready inventory lots were not found.' using errcode='22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin v_ready_id:=(v_line->>'readyLotId')::uuid; v_quantity:=(v_line->>'quantity')::numeric; v_unit_price:=(v_line->>'unitPrice')::numeric;
    exception when others then raise exception 'Each sale line requires a valid Ready lot, quantity, and unit price.' using errcode='22023'; end;
    if v_quantity is null or v_quantity<=0 or v_unit_price is null or v_unit_price<0 then raise exception 'Sale line quantity must be positive and unit price cannot be negative.' using errcode='22023'; end if;
    select * into v_ready from atlas.flower_ready_inventory_lots where id=v_ready_id;
    if v_ready.unit='bucket_equivalent' then
      if mod(v_quantity*4,1)<>0 then raise exception 'Bucket sale quantity must use quarter-bucket increments.' using errcode='22023'; end if;
    elsif mod(v_quantity,1)<>0 then raise exception 'Counted sale units must be whole numbers.' using errcode='22023'; end if;
    v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
    if v_quantity>coalesce(v_available,0) then raise exception 'Sale would claim more than the Ready quantity still Available.' using errcode='22023'; end if;
    v_subtotal:=v_subtotal+round(v_quantity*v_unit_price,2);
  end loop;

  insert into atlas.flower_sale_orders(
    farm_id,buyer_relationship_id,customer_label,sales_channel,event_key,sale_date,fulfillment_mode,
    fulfillment_due_date,fulfillment_due_time,fulfillment_membership_id,subtotal_amount,tax_amount,tip_amount,
    total_amount,currency,source_task_id,note,idempotency_key,recorded_by_membership_id,created_by_user_id,metadata
  ) values (
    p_farm_id,p_buyer_relationship_id,v_customer_label,p_sales_channel,nullif(btrim(coalesce(p_event_key,'')),''),
    (now() at time zone 'America/Chicago')::date,p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,
    v_assignee,v_subtotal,v_tax,v_tip,v_subtotal+v_tax+v_tip,'USD',p_source_task_id,
    nullif(btrim(coalesce(p_note,'')),''),v_key,p_effective_membership_id,auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','commercial_commitment','availabilityContract','cancellation_and_disposition_aware_v1')
  ) returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_ready_id:=(v_line->>'readyLotId')::uuid; v_quantity:=(v_line->>'quantity')::numeric; v_unit_price:=(v_line->>'unitPrice')::numeric;
    select * into v_ready from atlas.flower_ready_inventory_lots where id=v_ready_id;
    insert into atlas.flower_sale_order_lines(farm_id,sale_order_id,ready_lot_id,inventory_kind,quantity,unit,unit_price,metadata)
    values (p_farm_id,v_order.id,v_ready.id,v_ready.inventory_kind,v_quantity,v_ready.unit,v_unit_price,
      jsonb_build_object('quantityExactness',v_ready.quantity_exactness,'truthBoundary','ready_inventory_claim'))
    returning * into v_inserted_line;
    v_line_rows:=v_line_rows||jsonb_build_array(jsonb_build_object('id',v_inserted_line.id,'readyLotId',v_inserted_line.ready_lot_id,'inventoryKind',v_inserted_line.inventory_kind,'quantity',v_inserted_line.quantity,'unit',v_inserted_line.unit,'unitPrice',v_inserted_line.unit_price,'lineTotal',v_inserted_line.line_total));
  end loop;

  if p_fulfillment_mode='immediate_handoff' then
    insert into atlas.flower_fulfillment_events(farm_id,sale_order_id,task_id,fulfilled_at,fulfillment_method,recorded_by_membership_id,note,idempotency_key,created_by_user_id,metadata)
    values (p_farm_id,v_order.id,null,now(),'immediate_handoff',p_effective_membership_id,nullif(btrim(coalesce(p_note,'')),''),v_key||':fulfillment',auth.uid(),jsonb_build_object('truthBoundary','actual_handoff','saleRecordedAtomically',true))
    returning * into v_fulfillment;
  else
    v_fulfillment_task:=atlas.ensure_flower_fulfillment_task_v1(v_order.id,v_assignee);
  end if;

  return jsonb_build_object('saleOrderId',v_order.id,'lines',v_line_rows,'subtotalAmount',v_order.subtotal_amount,'taxAmount',v_order.tax_amount,'tipAmount',v_order.tip_amount,'totalAmount',v_order.total_amount,'fulfilled',v_fulfillment.id is not null,'fulfillmentEventId',v_fulfillment.id,'fulfillmentTask',v_fulfillment_task,'deduplicated',false);
end;
$function$;

revoke all on function atlas.record_flower_sale_core_v2(uuid,uuid,text,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_sale_core_v2(uuid,uuid,text,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text,boolean) to service_role;

create or replace function atlas.record_flower_sale_for_member_v1(
  p_farm_id uuid,p_buyer_relationship_id uuid,p_customer_label text,p_sales_channel text,p_event_key text,
  p_lines jsonb,p_tax_amount numeric,p_tip_amount numeric,p_fulfillment_mode text,p_fulfillment_due_date date,
  p_fulfillment_due_time time,p_fulfillment_membership_id uuid,p_source_task_id uuid,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_sale_core_v2(p_farm_id,v_membership,v_role,p_buyer_relationship_id,p_customer_label,p_sales_channel,p_event_key,p_lines,p_tax_amount,p_tip_amount,p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,p_fulfillment_membership_id,p_source_task_id,p_note,p_idempotency_key,false);
end;
$function$;

create or replace function atlas.owner_operator_record_flower_sale_v1(
  p_effective_membership_id uuid,p_buyer_relationship_id uuid,p_customer_label text,p_sales_channel text,p_event_key text,
  p_lines jsonb,p_tax_amount numeric,p_tip_amount numeric,p_fulfillment_mode text,p_fulfillment_due_date date,
  p_fulfillment_due_time time,p_fulfillment_membership_id uuid,p_source_task_id uuid,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare v_context jsonb; v_farm_id uuid;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id); v_farm_id:=nullif(v_context->>'farmId','')::uuid;
  if v_farm_id is null then raise exception 'Owner operator context has no farm scope.' using errcode='42501'; end if;
  return atlas.record_flower_sale_core_v2(v_farm_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_buyer_relationship_id,p_customer_label,p_sales_channel,p_event_key,p_lines,p_tax_amount,p_tip_amount,p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,p_fulfillment_membership_id,p_source_task_id,p_note,p_idempotency_key,true);
end;
$function$;

revoke all on function atlas.record_flower_sale_for_member_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
grant execute on function atlas.record_flower_sale_for_member_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;
