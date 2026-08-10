create table if not exists atlas.buyer_contact_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  buyer_relationship_id uuid not null references atlas.buyer_relationship_reconstruction(id) on delete cascade,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  occurred_at timestamptz not null default now(),
  contact_method text not null default 'phone',
  outcome text not null,
  contact_name text,
  contact_details text,
  follow_up text,
  notes text,
  sales_channel text,
  offer_key text,
  quantity integer,
  quoted_weekly_price numeric(10,2),
  agreed_start_date date,
  recorded_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint buyer_contact_events_outcome_check check (outcome in ('interested','maybe','not_interested','voicemail','no_answer','wrong_contact')),
  constraint buyer_contact_events_quantity_check check (quantity is null or quantity > 0),
  constraint buyer_contact_events_price_check check (quoted_weekly_price is null or quoted_weekly_price >= 0)
);

create index if not exists buyer_contact_events_relationship_idx
  on atlas.buyer_contact_events (buyer_relationship_id, occurred_at desc);
create index if not exists buyer_contact_events_farm_idx
  on atlas.buyer_contact_events (farm_id, occurred_at desc);
create index if not exists buyer_contact_events_task_idx
  on atlas.buyer_contact_events (source_task_id, occurred_at desc);

alter table atlas.buyer_contact_events enable row level security;

create or replace function atlas.record_buyer_outreach_result_v1(
  p_task_id uuid,
  p_contact_result text,
  p_reached_name text,
  p_contact_details text,
  p_follow_up text,
  p_notes text,
  p_quantity integer,
  p_quoted_weekly_price numeric,
  p_agreed_start_date date,
  p_effective_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_role text;
  v_relationship atlas.buyer_relationship_reconstruction%rowtype;
  v_event_id uuid;
  v_stable_key text;
  v_business_name text;
  v_sales_channel text;
  v_offer_key text;
  v_relationship_status text;
  v_result jsonb;
begin
  if p_contact_result not in ('interested','maybe','not_interested','voicemail','no_answer','wrong_contact') then
    raise exception using errcode = '22023', message = 'Choose what happened on the call.';
  end if;
  if p_quantity is not null and p_quantity < 1 then
    raise exception using errcode = '22023', message = 'Quantity must be at least 1.';
  end if;
  if p_quoted_weekly_price is not null and p_quoted_weekly_price < 0 then
    raise exception using errcode = '22023', message = 'Price cannot be negative.';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Buyer outreach task not found.';
  end if;

  if coalesce(v_task.metadata->>'subtask_kind','') <> 'network_outreach_contact' then
    raise exception using errcode = '22023', message = 'This task is not a buyer outreach contact.';
  end if;

  v_sales_channel := nullif(btrim(coalesce(v_task.metadata->>'sales_channel','')), '');
  if v_sales_channel is null then
    raise exception using errcode = '22023', message = 'This outreach task is not linked to a buyer sales channel.';
  end if;

  select role into v_role
  from atlas.farm_memberships
  where id = p_effective_membership_id
    and farm_id = v_task.farm_id
    and active = true;

  if v_role is null then
    raise exception using errcode = '42501', message = 'No active farm membership is available.';
  end if;

  if p_effective_membership_id is distinct from v_task.assigned_membership_id
     and v_role not in ('owner','manager') then
    raise exception using errcode = '42501', message = 'This buyer outreach contact belongs to another worker.';
  end if;

  v_stable_key := nullif(btrim(coalesce(v_task.metadata->>'buyer_relationship_stable_key','')), '');
  v_business_name := nullif(btrim(coalesce(v_task.metadata->>'business_name','')), '');

  if v_stable_key is not null then
    select * into v_relationship
    from atlas.buyer_relationship_reconstruction
    where farm_id = v_task.farm_id
      and stable_key = v_stable_key
    limit 1;
  elsif v_business_name is not null then
    select * into v_relationship
    from atlas.buyer_relationship_reconstruction
    where farm_id = v_task.farm_id
      and business_name = v_business_name
    order by updated_at desc
    limit 1;
  end if;

  if v_relationship.id is null then
    raise exception using errcode = 'P0002', message = 'No buyer relationship is linked to this outreach task.';
  end if;

  v_offer_key := nullif(btrim(coalesce(v_task.metadata->>'offer_key', v_task.metadata->>'sales_channel', '')), '');

  insert into atlas.buyer_contact_events (
    farm_id,
    buyer_relationship_id,
    source_task_id,
    contact_method,
    outcome,
    contact_name,
    contact_details,
    follow_up,
    notes,
    sales_channel,
    offer_key,
    quantity,
    quoted_weekly_price,
    agreed_start_date,
    recorded_by_membership_id,
    metadata
  ) values (
    v_task.farm_id,
    v_relationship.id,
    v_task.id,
    'phone',
    p_contact_result,
    nullif(btrim(coalesce(p_reached_name,'')),''),
    nullif(btrim(coalesce(p_contact_details,'')),''),
    nullif(btrim(coalesce(p_follow_up,'')),''),
    nullif(btrim(coalesce(p_notes,'')),''),
    v_sales_channel,
    v_offer_key,
    p_quantity,
    p_quoted_weekly_price,
    p_agreed_start_date,
    p_effective_membership_id,
    jsonb_build_object(
      'source','atlas_network_outreach',
      'task_title',v_task.title,
      'parent_task_id',v_task.parent_task_id
    )
  )
  returning id into v_event_id;

  v_relationship_status := case p_contact_result
    when 'interested' then 'interested'
    when 'maybe' then 'follow_up'
    when 'not_interested' then 'not_interested'
    when 'wrong_contact' then 'needs_buyer_contact'
    when 'voicemail' then 'contact_attempted'
    when 'no_answer' then 'contact_attempted'
    else v_relationship.relationship_status
  end;

  update atlas.buyer_relationship_reconstruction
  set primary_contact_name = coalesce(nullif(btrim(coalesce(p_reached_name,'')),''), primary_contact_name),
      relationship_status = v_relationship_status,
      next_action = coalesce(nullif(btrim(coalesce(p_follow_up,'')),''), next_action),
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'last_buyer_contact_event_id', v_event_id,
        'last_contact_at', now(),
        'last_contact_outcome', p_contact_result,
        'last_contact_task_id', v_task.id,
        'last_sales_channel', v_sales_channel
      ),
      updated_at = now()
  where id = v_relationship.id;

  v_result := jsonb_build_object(
    'contact_result', p_contact_result,
    'reached_name', nullif(btrim(coalesce(p_reached_name,'')),''),
    'contact_details', nullif(btrim(coalesce(p_contact_details,'')),''),
    'follow_up', nullif(btrim(coalesce(p_follow_up,'')),''),
    'notes', nullif(btrim(coalesce(p_notes,'')),''),
    'quantity', p_quantity,
    'quoted_weekly_price', p_quoted_weekly_price,
    'agreed_start_date', p_agreed_start_date,
    'buyer_relationship_id', v_relationship.id,
    'buyer_contact_event_id', v_event_id,
    'recorded_at', now()
  );

  update atlas.tasks
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'buyer_outreach_result', v_result,
        'result_storage', 'atlas.buyer_contact_events'
      ),
      updated_at = now()
  where id = v_task.id;

  return jsonb_build_object(
    'ok', true,
    'taskId', v_task.id,
    'buyerRelationshipId', v_relationship.id,
    'buyerContactEventId', v_event_id,
    'result', v_result
  );
end;
$function$;

revoke all on function atlas.record_buyer_outreach_result_v1(uuid,text,text,text,text,text,integer,numeric,date,uuid) from public;
grant execute on function atlas.record_buyer_outreach_result_v1(uuid,text,text,text,text,text,integer,numeric,date,uuid) to authenticated, service_role;

create or replace view intelligence.v_noel_buyer_contact_events as
select
  e.id,
  e.farm_id,
  f.stable_key as farm_key,
  f.name as farm_name,
  e.buyer_relationship_id,
  r.stable_key as buyer_stable_key,
  r.business_name,
  r.buyer_type,
  r.city,
  e.occurred_at,
  e.contact_method,
  e.outcome,
  e.contact_name,
  e.contact_details,
  e.follow_up,
  e.notes,
  e.sales_channel,
  e.offer_key,
  e.quantity,
  e.quoted_weekly_price,
  e.agreed_start_date,
  e.source_task_id,
  e.recorded_by_membership_id,
  e.metadata,
  e.created_at
from atlas.buyer_contact_events e
join atlas.buyer_relationship_reconstruction r on r.id = e.buyer_relationship_id
join atlas.farms f on f.id = e.farm_id;

create or replace view intelligence.v_noel_buyer_relationships as
select
  r.id,
  r.farm_id,
  f.stable_key as farm_key,
  f.name as farm_name,
  r.stable_key,
  r.business_name,
  r.buyer_type,
  r.city,
  r.primary_contact_name,
  r.relationship_status,
  r.priority_rank,
  r.volume_tier,
  r.purchase_history_summary,
  r.product_interests,
  r.buying_preferences,
  r.payment_behavior,
  r.access_notes,
  r.pursuit_recommendation,
  r.next_action,
  r.source_person,
  r.source_date,
  r.metadata,
  r.created_at,
  r.updated_at,
  latest.occurred_at as last_contact_at,
  latest.outcome as last_contact_outcome,
  latest.contact_name as last_contact_name,
  latest.follow_up as last_contact_follow_up,
  coalesce(counts.contact_event_count,0) as contact_event_count
from atlas.buyer_relationship_reconstruction r
join atlas.farms f on f.id = r.farm_id
left join lateral (
  select e.occurred_at, e.outcome, e.contact_name, e.follow_up
  from atlas.buyer_contact_events e
  where e.buyer_relationship_id = r.id
  order by e.occurred_at desc, e.created_at desc
  limit 1
) latest on true
left join lateral (
  select count(*)::integer as contact_event_count
  from atlas.buyer_contact_events e
  where e.buyer_relationship_id = r.id
) counts on true;

create or replace view intelligence.v_noel_restaurant_relationships as
select *
from intelligence.v_noel_buyer_relationships
where buyer_type = 'restaurant_bud_vase';
