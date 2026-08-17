-- Harvest Pass 5: Ready -> commercial commitment -> Going out -> Fulfilled.
--
-- Ready lots remain immutable birth truth. Sale lines claim specific Ready lots without
-- mutating them. Future pickup/delivery becomes a normal farm operating obligation through
-- planned work. Fulfillment is an explicit append-only handoff fact. Outreach remains upstream.

create table atlas.flower_sale_orders (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  buyer_relationship_id uuid references atlas.buyer_relationship_reconstruction(id) on delete restrict,
  customer_label text,
  sales_channel text not null,
  event_key text,
  sale_date date not null default ((now() at time zone 'America/Chicago')::date),
  fulfillment_mode text not null,
  fulfillment_due_date date,
  fulfillment_due_time time,
  fulfillment_membership_id uuid references atlas.farm_memberships(id) on delete restrict,
  subtotal_amount numeric(12,2) not null,
  tax_amount numeric(12,2) not null default 0,
  tip_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  currency text not null default 'USD',
  source_task_id uuid references atlas.tasks(id) on delete restrict,
  note text,
  idempotency_key text not null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_sale_orders_idempotency_unique unique (farm_id,idempotency_key),
  constraint flower_sale_orders_channel_check check (
    sales_channel in ('wholesale','farm_pickup','delivery','market','subscription','event','other')
  ),
  constraint flower_sale_orders_fulfillment_mode_check check (
    fulfillment_mode in ('immediate_handoff','pickup','delivery')
  ),
  constraint flower_sale_orders_amounts_check check (
    subtotal_amount >= 0 and tax_amount >= 0 and tip_amount >= 0
    and total_amount = subtotal_amount + tax_amount + tip_amount
  ),
  constraint flower_sale_orders_currency_check check (currency='USD'),
  constraint flower_sale_orders_future_fulfillment_check check (
    (fulfillment_mode='immediate_handoff' and fulfillment_due_date is null and fulfillment_due_time is null)
    or
    (fulfillment_mode in ('pickup','delivery') and fulfillment_due_date is not null and fulfillment_membership_id is not null)
  )
);

comment on table atlas.flower_sale_orders is
  'Append-only commercial commitment header. A row means a sale was explicitly recorded; outreach or availability never creates one by inference.';

create table atlas.flower_sale_order_lines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  sale_order_id uuid not null references atlas.flower_sale_orders(id) on delete restrict,
  ready_lot_id uuid not null references atlas.flower_ready_inventory_lots(id) on delete restrict,
  inventory_kind text not null,
  quantity numeric(10,2) not null,
  unit text not null,
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) generated always as (round(quantity * unit_price,2)) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_sale_order_lines_order_lot_unique unique (sale_order_id,ready_lot_id),
  constraint flower_sale_order_lines_quantity_check check (quantity > 0),
  constraint flower_sale_order_lines_price_check check (unit_price >= 0)
);

comment on table atlas.flower_sale_order_lines is
  'Immutable line-level Ready inventory claims. Each line claims one specific Ready birth lot and preserves that lot product kind/unit.';

create table atlas.flower_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  sale_order_id uuid not null references atlas.flower_sale_orders(id) on delete restrict,
  task_id uuid references atlas.tasks(id) on delete restrict,
  fulfilled_at timestamptz not null default now(),
  fulfillment_method text not null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  note text,
  idempotency_key text not null,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_fulfillment_events_order_unique unique (sale_order_id),
  constraint flower_fulfillment_events_idempotency_unique unique (farm_id,idempotency_key),
  constraint flower_fulfillment_events_method_check check (
    fulfillment_method in ('immediate_handoff','pickup','delivery')
  )
);

comment on table atlas.flower_fulfillment_events is
  'Append-only actual full-order handoff truth. A sale or fulfillment task does not imply this event occurred.';

create index flower_sale_orders_farm_date_idx on atlas.flower_sale_orders(farm_id,sale_date desc);
create index flower_sale_orders_buyer_date_idx on atlas.flower_sale_orders(buyer_relationship_id,sale_date desc) where buyer_relationship_id is not null;
create index flower_sale_orders_fulfillment_member_due_idx on atlas.flower_sale_orders(fulfillment_membership_id,fulfillment_due_date) where fulfillment_membership_id is not null;
create index flower_sale_orders_source_task_idx on atlas.flower_sale_orders(source_task_id) where source_task_id is not null;
create index flower_sale_orders_recorded_member_idx on atlas.flower_sale_orders(recorded_by_membership_id,created_at desc);
create index flower_sale_order_lines_order_idx on atlas.flower_sale_order_lines(sale_order_id,created_at);
create index flower_sale_order_lines_ready_lot_idx on atlas.flower_sale_order_lines(ready_lot_id,created_at);
create index flower_sale_order_lines_farm_idx on atlas.flower_sale_order_lines(farm_id,sale_order_id);
create index flower_fulfillment_events_farm_date_idx on atlas.flower_fulfillment_events(farm_id,fulfilled_at desc);
create index flower_fulfillment_events_task_idx on atlas.flower_fulfillment_events(task_id) where task_id is not null;
create index flower_fulfillment_events_membership_idx on atlas.flower_fulfillment_events(recorded_by_membership_id,fulfilled_at desc);

create or replace function atlas.prevent_flower_commercial_truth_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  raise exception 'Flower sale and fulfillment truth is append-only.' using errcode='55000';
end;
$function$;

revoke all on function atlas.prevent_flower_commercial_truth_mutation_v1() from public,anon,authenticated;
grant execute on function atlas.prevent_flower_commercial_truth_mutation_v1() to service_role;

create trigger flower_sale_orders_append_only_v1
before update or delete on atlas.flower_sale_orders
for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();

create trigger flower_sale_order_lines_append_only_v1
before update or delete on atlas.flower_sale_order_lines
for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();

create trigger flower_fulfillment_events_append_only_v1
before update or delete on atlas.flower_fulfillment_events
for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();

create or replace function atlas.validate_flower_sale_order_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_buyer_farm uuid;
  v_member atlas.farm_memberships%rowtype;
begin
  if new.buyer_relationship_id is not null then
    select farm_id into v_buyer_farm from atlas.buyer_relationship_reconstruction where id=new.buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from new.farm_id then
      raise exception 'Buyer relationship is outside the sale farm.' using errcode='22023';
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

create trigger flower_sale_orders_validate_v1
before insert on atlas.flower_sale_orders
for each row execute function atlas.validate_flower_sale_order_v1();

create or replace function atlas.validate_flower_sale_order_line_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_order atlas.flower_sale_orders%rowtype;
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_claimed numeric(10,2);
begin
  select * into v_order from atlas.flower_sale_orders where id=new.sale_order_id;
  if v_order.id is null or v_order.farm_id is distinct from new.farm_id then
    raise exception 'Sale line order is outside this farm.' using errcode='22023';
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

  select coalesce(sum(quantity),0) into v_claimed
  from atlas.flower_sale_order_lines
  where ready_lot_id=v_ready.id;

  if v_claimed + new.quantity > v_ready.quantity then
    raise exception 'Sale would claim more than the Ready quantity still available.' using errcode='22023';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_flower_sale_order_line_v1() from public,anon,authenticated;
grant execute on function atlas.validate_flower_sale_order_line_v1() to service_role;

create trigger flower_sale_order_lines_validate_v1
before insert on atlas.flower_sale_order_lines
for each row execute function atlas.validate_flower_sale_order_line_v1();

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

create trigger flower_fulfillment_events_validate_v1
before insert on atlas.flower_fulfillment_events
for each row execute function atlas.validate_flower_fulfillment_event_v1();

alter table atlas.flower_sale_orders enable row level security;
alter table atlas.flower_sale_order_lines enable row level security;
alter table atlas.flower_fulfillment_events enable row level security;

create policy flower_sale_orders_member_read_v1 on atlas.flower_sale_orders
for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_sale_order_lines_member_read_v1 on atlas.flower_sale_order_lines
for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_fulfillment_events_member_read_v1 on atlas.flower_fulfillment_events
for select to authenticated using (atlas.is_farm_member(farm_id));

revoke all on atlas.flower_sale_orders from public,anon,authenticated;
revoke all on atlas.flower_sale_order_lines from public,anon,authenticated;
revoke all on atlas.flower_fulfillment_events from public,anon,authenticated;
grant select on atlas.flower_sale_orders to authenticated;
grant select on atlas.flower_sale_order_lines to authenticated;
grant select on atlas.flower_fulfillment_events to authenticated;
grant all on atlas.flower_sale_orders to service_role;
grant all on atlas.flower_sale_order_lines to service_role;
grant all on atlas.flower_fulfillment_events to service_role;

create or replace function atlas.ensure_flower_fulfillment_task_v1(
  p_sale_order_id uuid,
  p_assigned_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_order atlas.flower_sale_orders%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_existing_task uuid;
  v_existing_occurrence uuid;
  v_occurrence uuid;
  v_released_task uuid;
  v_signal jsonb;
  v_customer text;
begin
  select * into v_order from atlas.flower_sale_orders where id=p_sale_order_id;
  if v_order.id is null then raise exception 'Flower sale order not found.' using errcode='P0002'; end if;
  if v_order.fulfillment_mode='immediate_handoff' then
    return jsonb_build_object('taskId',null,'occurrenceId',null,'action','immediate_handoff');
  end if;
  if exists (select 1 from atlas.flower_fulfillment_events where sale_order_id=v_order.id) then
    return jsonb_build_object('taskId',null,'occurrenceId',null,'action','already_fulfilled');
  end if;

  select * into v_member from atlas.farm_memberships where id=p_assigned_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_order.farm_id then
    raise exception 'Fulfillment assignee must be an active member of this farm.' using errcode='22023';
  end if;

  select t.id,t.planned_occurrence_id into v_existing_task,v_existing_occurrence
  from atlas.tasks t
  where t.farm_id=v_order.farm_id
    and t.status in ('open','blocked')
    and t.task_type='flower_fulfillment'
    and t.metadata->>'flower_sale_order_id'=v_order.id::text
  order by t.created_at limit 1;
  if v_existing_task is not null then
    return jsonb_build_object('taskId',v_existing_task,'occurrenceId',v_existing_occurrence,'action','kept_current');
  end if;

  v_customer:=coalesce(nullif(btrim(v_order.customer_label),''),'Flower customer');
  v_occurrence:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_order.farm_id,
    p_definition_key=>'flower-fulfillment:'||v_order.id::text,
    p_policy_key=>'flower-fulfillment:'||v_order.id::text||':one-active',
    p_occurrence_key=>'flower-fulfillment:'||v_order.id::text,
    p_title=>case v_order.fulfillment_mode when 'delivery' then 'Deliver flower order · ' else 'Flower pickup · ' end||v_customer,
    p_task_type=>'flower_fulfillment',
    p_due_date=>v_order.fulfillment_due_date,
    p_source_kind=>'flower_sale_order',
    p_source_id=>v_order.id,
    p_gate_type=>'event',
    p_horizon_days=>0,
    p_maximum_active_instances=>1,
    p_task_payload=>jsonb_build_object(
      'task_type','flower_fulfillment',
      'priority','high',
      'generated_from','flower_sale_order',
      'generated_from_id',v_order.id,
      'note','Fulfill the committed flower order. Record completion only after the flowers are actually handed off.',
      'action_key','fulfill',
      'work_class','fulfillment',
      'task_series_key','flower-fulfillment:'||v_order.id::text,
      'engine_instance_key','flower-fulfillment:'||v_order.id::text,
      'visibility_scope','assigned_worker',
      'assigned_membership_id',p_assigned_membership_id,
      'metadata',jsonb_build_object(
        'task_style','flower_fulfillment',
        'structured_result_required',true,
        'flower_sale_order_id',v_order.id,
        'fulfillment_mode',v_order.fulfillment_mode,
        'fulfillment_due_time',v_order.fulfillment_due_time,
        'sales_channel',v_order.sales_channel,
        'display_action',case v_order.fulfillment_mode when 'delivery' then 'Deliver' else 'Hand off' end,
        'display_subject',v_customer,
        'display_detail','Committed flower order',
        'time_claims_handoff',false
      )
    ),
    p_relation_payload=>'{}'::jsonb,
    p_gate_config=>jsonb_build_object('requiresSaleCommitment',true,'timeClaimsHandoff',false),
    p_not_before_date=>least(v_order.sale_date,v_order.fulfillment_due_date),
    p_metadata=>jsonb_build_object('flowerSaleOrderId',v_order.id)
  );

  v_signal:=atlas.signal_work_occurrence_v1(
    v_occurrence,
    'sale_commitment_recorded',
    jsonb_build_object('flowerSaleOrderId',v_order.id)
  );
  select released_task_id into v_released_task from atlas.planned_work_occurrences where id=v_occurrence;

  return jsonb_build_object(
    'taskId',v_released_task,
    'occurrenceId',v_occurrence,
    'action',case when v_released_task is null then 'planned_awaiting_capacity' else 'released' end,
    'release',v_signal->'release'
  );
end;
$function$;

comment on function atlas.ensure_flower_fulfillment_task_v1(uuid,uuid) is
  'Creates at most one active operational fulfillment obligation for a committed non-immediate flower sale. Worker Day/Clock owns exact placement.';
revoke all on function atlas.ensure_flower_fulfillment_task_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_flower_fulfillment_task_v1(uuid,uuid) to service_role;

create or replace function atlas.record_flower_sale_core_v1(
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
  v_line jsonb;
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_ready_id uuid;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_claimed numeric(10,2);
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
begin
  if v_key is null then raise exception 'Sale idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record flower sales.' using errcode='42501';
  end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_existing from atlas.flower_sale_orders where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.id,'readyLotId',l.ready_lot_id,'inventoryKind',l.inventory_kind,
      'quantity',l.quantity,'unit',l.unit,'unitPrice',l.unit_price,'lineTotal',l.line_total
    ) order by l.created_at),'[]'::jsonb) into v_line_rows
    from atlas.flower_sale_order_lines l where l.sale_order_id=v_existing.id;
    select * into v_fulfillment from atlas.flower_fulfillment_events where sale_order_id=v_existing.id;
    return jsonb_build_object(
      'saleOrderId',v_existing.id,'lines',v_line_rows,'totalAmount',v_existing.total_amount,
      'fulfilled',v_fulfillment.id is not null,'deduplicated',true
    );
  end if;

  if p_sales_channel not in ('wholesale','farm_pickup','delivery','market','subscription','event','other') then
    raise exception 'Choose a supported flower sales channel.' using errcode='22023';
  end if;
  if p_fulfillment_mode not in ('immediate_handoff','pickup','delivery') then
    raise exception 'Choose a supported fulfillment mode.' using errcode='22023';
  end if;
  if v_tax<0 or v_tip<0 then raise exception 'Tax and tip cannot be negative.' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>24 then
    raise exception 'Sale requires between 1 and 24 Ready inventory lines.' using errcode='22023';
  end if;

  select count(*),count(distinct value->>'readyLotId') into v_line_count,v_distinct_lot_count
  from jsonb_array_elements(p_lines);
  if v_line_count<>v_distinct_lot_count then
    raise exception 'A Ready lot may appear only once in a sale.' using errcode='22023';
  end if;

  if p_buyer_relationship_id is not null then
    select farm_id into v_buyer_farm from atlas.buyer_relationship_reconstruction where id=p_buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from p_farm_id then
      raise exception 'Buyer relationship is outside this farm.' using errcode='22023';
    end if;
  end if;

  if p_fulfillment_mode='immediate_handoff' then
    if p_fulfillment_due_date is not null or p_fulfillment_due_time is not null then
      raise exception 'Immediate handoff cannot carry a future fulfillment window.' using errcode='22023';
    end if;
    v_assignee:=null;
  else
    if p_fulfillment_due_date is null then raise exception 'Future pickup or delivery requires a due date.' using errcode='22023'; end if;
    v_assignee:=coalesce(p_fulfillment_membership_id,p_effective_membership_id);
    select * into v_member from atlas.farm_memberships where id=v_assignee;
    if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then
      raise exception 'Fulfillment assignee must be an active member of this farm.' using errcode='22023';
    end if;
    if p_effective_role='farm_hand' and v_assignee is distinct from p_effective_membership_id then
      raise exception 'Farm Hand may assign fulfillment only to self.' using errcode='42501';
    end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_ready_id:=(v_line->>'readyLotId')::uuid;
      v_quantity:=(v_line->>'quantity')::numeric;
      v_unit_price:=(v_line->>'unitPrice')::numeric;
    exception when others then
      raise exception 'Each sale line requires a valid Ready lot, quantity, and unit price.' using errcode='22023';
    end;
    if v_quantity is null or v_quantity<=0 or v_unit_price is null or v_unit_price<0 then
      raise exception 'Sale line quantity must be positive and unit price cannot be negative.' using errcode='22023';
    end if;

    select * into v_ready from atlas.flower_ready_inventory_lots where id=v_ready_id for update;
    if v_ready.id is null or v_ready.farm_id is distinct from p_farm_id then
      raise exception 'Sale line Ready lot is outside this farm.' using errcode='22023';
    end if;
    if v_ready.unit='bucket_equivalent' then
      if mod(v_quantity*4,1)<>0 then raise exception 'Bucket sale quantity must use quarter-bucket increments.' using errcode='22023'; end if;
    elsif mod(v_quantity,1)<>0 then
      raise exception 'Counted sale units must be whole numbers.' using errcode='22023';
    end if;
    select coalesce(sum(quantity),0) into v_claimed from atlas.flower_sale_order_lines where ready_lot_id=v_ready.id;
    if v_claimed+v_quantity>v_ready.quantity then
      raise exception 'Sale would claim more than the Ready quantity still available.' using errcode='22023';
    end if;
    v_subtotal:=v_subtotal+round(v_quantity*v_unit_price,2);
  end loop;

  insert into atlas.flower_sale_orders(
    farm_id,buyer_relationship_id,customer_label,sales_channel,event_key,sale_date,
    fulfillment_mode,fulfillment_due_date,fulfillment_due_time,fulfillment_membership_id,
    subtotal_amount,tax_amount,tip_amount,total_amount,currency,source_task_id,note,
    idempotency_key,recorded_by_membership_id,created_by_user_id,metadata
  ) values (
    p_farm_id,p_buyer_relationship_id,nullif(btrim(coalesce(p_customer_label,'')),''),p_sales_channel,
    nullif(btrim(coalesce(p_event_key,'')),''),(now() at time zone 'America/Chicago')::date,
    p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,v_assignee,
    v_subtotal,v_tax,v_tip,v_subtotal+v_tax+v_tip,'USD',p_source_task_id,
    nullif(btrim(coalesce(p_note,'')),''),v_key,p_effective_membership_id,auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','commercial_commitment')
  ) returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_ready_id:=(v_line->>'readyLotId')::uuid;
    v_quantity:=(v_line->>'quantity')::numeric;
    v_unit_price:=(v_line->>'unitPrice')::numeric;
    select * into v_ready from atlas.flower_ready_inventory_lots where id=v_ready_id;

    insert into atlas.flower_sale_order_lines(
      farm_id,sale_order_id,ready_lot_id,inventory_kind,quantity,unit,unit_price,metadata
    ) values (
      p_farm_id,v_order.id,v_ready.id,v_ready.inventory_kind,v_quantity,v_ready.unit,v_unit_price,
      jsonb_build_object('quantityExactness',v_ready.quantity_exactness,'truthBoundary','ready_inventory_claim')
    ) returning * into v_inserted_line;

    v_line_rows:=v_line_rows||jsonb_build_array(jsonb_build_object(
      'id',v_inserted_line.id,'readyLotId',v_inserted_line.ready_lot_id,
      'inventoryKind',v_inserted_line.inventory_kind,'quantity',v_inserted_line.quantity,
      'unit',v_inserted_line.unit,'unitPrice',v_inserted_line.unit_price,'lineTotal',v_inserted_line.line_total
    ));
  end loop;

  if p_fulfillment_mode='immediate_handoff' then
    insert into atlas.flower_fulfillment_events(
      farm_id,sale_order_id,task_id,fulfilled_at,fulfillment_method,recorded_by_membership_id,
      note,idempotency_key,created_by_user_id,metadata
    ) values (
      p_farm_id,v_order.id,null,now(),'immediate_handoff',p_effective_membership_id,
      nullif(btrim(coalesce(p_note,'')),''),v_key||':fulfillment',auth.uid(),
      jsonb_build_object('truthBoundary','actual_handoff','saleRecordedAtomically',true)
    ) returning * into v_fulfillment;
  else
    v_fulfillment_task:=atlas.ensure_flower_fulfillment_task_v1(v_order.id,v_assignee);
  end if;

  return jsonb_build_object(
    'saleOrderId',v_order.id,'lines',v_line_rows,'subtotalAmount',v_order.subtotal_amount,
    'taxAmount',v_order.tax_amount,'tipAmount',v_order.tip_amount,'totalAmount',v_order.total_amount,
    'fulfilled',v_fulfillment.id is not null,'fulfillmentEventId',v_fulfillment.id,
    'fulfillmentTask',v_fulfillment_task,'deduplicated',false
  );
end;
$function$;

comment on function atlas.record_flower_sale_core_v1(uuid,uuid,text,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text,boolean) is
  'Canonical flower commercial commitment write. Claims explicit Ready lots and either records an immediate handoff or releases one future operational fulfillment obligation.';
revoke all on function atlas.record_flower_sale_core_v1(uuid,uuid,text,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_sale_core_v1(uuid,uuid,text,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text,boolean) to service_role;

create or replace function atlas.record_flower_sale_for_member_v1(
  p_farm_id uuid,
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
  v_role text;
  v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_flower_sale_core_v1(
    p_farm_id,v_membership,v_role,p_buyer_relationship_id,p_customer_label,p_sales_channel,p_event_key,
    p_lines,p_tax_amount,p_tip_amount,p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,
    p_fulfillment_membership_id,p_source_task_id,p_note,p_idempotency_key,false
  );
end;
$function$;

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
  v_farm_id:=(v_context#>>'{effective,farmId}')::uuid;
  return atlas.record_flower_sale_core_v1(
    v_farm_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',
    p_buyer_relationship_id,p_customer_label,p_sales_channel,p_event_key,p_lines,p_tax_amount,p_tip_amount,
    p_fulfillment_mode,p_fulfillment_due_date,p_fulfillment_due_time,p_fulfillment_membership_id,p_source_task_id,
    p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.record_flower_sale_for_member_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
grant execute on function atlas.record_flower_sale_for_member_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;

create or replace function atlas.record_flower_fulfillment_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
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
  v_task atlas.tasks%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_order atlas.flower_sale_orders%rowtype;
  v_existing atlas.flower_fulfillment_events%rowtype;
  v_event atlas.flower_fulfillment_events%rowtype;
  v_order_id uuid;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_transition jsonb;
begin
  if v_key is null then raise exception 'Fulfillment idempotency key is required.' using errcode='22023'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Flower fulfillment task not found.' using errcode='P0002'; end if;
  if v_task.task_type<>'flower_fulfillment' or v_task.status not in ('open','blocked') then
    raise exception 'Task is not an open flower fulfillment.' using errcode='22023';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record flower fulfillment.' using errcode='42501';
  end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and (
    v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id is distinct from p_effective_membership_id
  ) then
    raise exception 'Fulfillment task is not assigned to this worker.' using errcode='42501';
  end if;

  begin v_order_id:=nullif(v_task.metadata->>'flower_sale_order_id','')::uuid;
  exception when invalid_text_representation then v_order_id:=null; end;
  if v_order_id is null then raise exception 'Fulfillment task has no sale order.' using errcode='22023'; end if;
  select * into v_order from atlas.flower_sale_orders where id=v_order_id;
  if v_order.id is null or v_order.farm_id is distinct from v_task.farm_id then
    raise exception 'Fulfillment sale order is outside the task farm.' using errcode='22023';
  end if;

  select * into v_existing from atlas.flower_fulfillment_events where sale_order_id=v_order.id;
  if v_existing.id is not null then
    return jsonb_build_object('fulfillmentEventId',v_existing.id,'saleOrderId',v_order.id,'taskId',v_task.id,'deduplicated',true);
  end if;

  insert into atlas.flower_fulfillment_events(
    farm_id,sale_order_id,task_id,fulfilled_at,fulfillment_method,recorded_by_membership_id,
    note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_order.farm_id,v_order.id,v_task.id,now(),v_order.fulfillment_mode,p_effective_membership_id,
    nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','actual_handoff')
  ) returning * into v_event;

  v_transition:=atlas.record_task_transition_v1_internal(
    v_task.id,'done','flower-fulfillment:'||v_event.id::text,null,p_note,null,
    'fulfill','flower_fulfillment',
    jsonb_build_object('flower_sale_order_id',v_order.id,'flower_fulfillment_event_id',v_event.id),null
  );

  return jsonb_build_object(
    'fulfillmentEventId',v_event.id,'saleOrderId',v_order.id,'taskId',v_task.id,
    'transition',v_transition,'deduplicated',false
  );
end;
$function$;

comment on function atlas.record_flower_fulfillment_core_v1(uuid,uuid,text,text,text,boolean) is
  'Canonical full-order flower handoff write. A future sale is Fulfilled only after this explicit event is recorded.';
revoke all on function atlas.record_flower_fulfillment_core_v1(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_fulfillment_core_v1(uuid,uuid,text,text,text,boolean) to service_role;

create or replace function atlas.record_flower_fulfillment_for_member_v1(
  p_farm_id uuid,p_task_id uuid,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_role text;
  v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_flower_fulfillment_core_v1(p_task_id,v_membership,v_role,p_note,p_idempotency_key,false);
end;
$function$;

create or replace function atlas.owner_operator_record_flower_fulfillment_v1(
  p_effective_membership_id uuid,p_task_id uuid,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_fulfillment_core_v1(
    p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.record_flower_fulfillment_for_member_v1(uuid,uuid,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_fulfillment_v1(uuid,uuid,text,text) from public,anon;
grant execute on function atlas.record_flower_fulfillment_for_member_v1(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_fulfillment_v1(uuid,uuid,text,text) to authenticated,service_role;
