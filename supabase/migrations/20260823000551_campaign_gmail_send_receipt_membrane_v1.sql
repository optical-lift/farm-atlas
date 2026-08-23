create table if not exists local_intel.campaign_send_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_message_id text not null,
  provider_thread_id text,
  campaign_id uuid not null references local_intel.campaigns(id) on delete restrict,
  campaign_target_id uuid not null references local_intel.campaign_targets(id) on delete restrict,
  campaign_contact_id uuid not null references local_intel.campaign_contacts(id) on delete restrict,
  contact_point_id uuid not null references local_intel.contact_points(id) on delete restrict,
  campaign_asset_id uuid not null references local_intel.campaign_assets(id) on delete restrict,
  action_id uuid not null references local_intel.intelligence_actions(id) on delete restrict,
  sender_address text not null,
  recipient_address text not null,
  subject text not null,
  body_sha256 text not null,
  occurred_at timestamptz not null,
  provider_receipt jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint campaign_send_receipts_provider_message_key unique(provider,provider_message_id),
  constraint campaign_send_receipts_action_key unique(action_id),
  constraint campaign_send_receipts_provider_nonblank check (length(btrim(provider)) > 0),
  constraint campaign_send_receipts_message_nonblank check (length(btrim(provider_message_id)) > 0),
  constraint campaign_send_receipts_sender_nonblank check (length(btrim(sender_address)) > 0),
  constraint campaign_send_receipts_recipient_nonblank check (length(btrim(recipient_address)) > 0),
  constraint campaign_send_receipts_subject_nonblank check (length(btrim(subject)) > 0),
  constraint campaign_send_receipts_body_hash check (body_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists campaign_send_receipts_target_time_idx
  on local_intel.campaign_send_receipts(campaign_target_id,occurred_at desc);
create index if not exists campaign_send_receipts_contact_time_idx
  on local_intel.campaign_send_receipts(campaign_contact_id,occurred_at desc);

create or replace function local_intel.block_campaign_send_receipt_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  raise exception 'campaign send receipts are append-only provider evidence; insert a new receipt instead of rewriting history';
end;
$function$;

drop trigger if exists campaign_send_receipts_append_only_v1 on local_intel.campaign_send_receipts;
create trigger campaign_send_receipts_append_only_v1
before update or delete on local_intel.campaign_send_receipts
for each row execute function local_intel.block_campaign_send_receipt_mutation_v1();

create or replace function local_intel.get_campaign_email_send_packet_v1(p_campaign_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel','extensions'
as $function$
declare
  c local_intel.campaign_contacts%rowtype;
  t local_intel.campaign_targets%rowtype;
  cp local_intel.contact_points%rowtype;
  a local_intel.campaign_assets%rowtype;
  cam local_intel.campaigns%rowtype;
  blockers text[] := array[]::text[];
  v_body text;
  v_content_type text;
  v_body_hash text;
begin
  select * into c from local_intel.campaign_contacts where id=p_campaign_contact_id;
  if not found then
    raise exception 'Unknown campaign contact %',p_campaign_contact_id;
  end if;

  select * into cam from local_intel.campaigns where id=c.campaign_id;
  if not found then blockers := array_append(blockers,'campaign_missing'); end if;

  if c.campaign_target_id is null then
    blockers := array_append(blockers,'campaign_target_missing');
  else
    select * into t from local_intel.campaign_targets where id=c.campaign_target_id;
    if not found then
      blockers := array_append(blockers,'campaign_target_missing');
    else
      if t.campaign_id is distinct from c.campaign_id then blockers := array_append(blockers,'campaign_target_campaign_mismatch'); end if;
      if t.organization_entity_id is distinct from c.entity_id then blockers := array_append(blockers,'campaign_target_entity_mismatch'); end if;
      if t.marketing_clearance_state <> 'eligible' then blockers := array_append(blockers,'target_marketing_clearance_not_eligible'); end if;
      if t.target_state not in ('send_eligible','in_market') then blockers := array_append(blockers,'target_not_send_eligible'); end if;
    end if;
  end if;

  if cam.id is not null then
    if cam.status not in ('ready','active') then blockers := array_append(blockers,'campaign_not_ready_or_active'); end if;
    if cam.starts_at is not null and cam.starts_at > now() then blockers := array_append(blockers,'campaign_not_started'); end if;
    if cam.ends_at is not null and cam.ends_at < now() then blockers := array_append(blockers,'campaign_ended'); end if;
  end if;

  if c.state not in ('eligible','queued','contacted') then blockers := array_append(blockers,'campaign_contact_not_executable'); end if;

  if c.contact_point_id is null then
    blockers := array_append(blockers,'contact_point_missing');
  else
    select * into cp from local_intel.contact_points where id=c.contact_point_id;
    if not found then
      blockers := array_append(blockers,'contact_point_missing');
    else
      if cp.entity_id is distinct from c.entity_id then blockers := array_append(blockers,'contact_point_entity_mismatch'); end if;
      if cp.contact_type <> 'email' then blockers := array_append(blockers,'contact_point_not_email'); end if;
      if cp.visibility <> 'public' then blockers := array_append(blockers,'contact_point_not_public'); end if;
      if cp.marketing_status <> 'eligible' then blockers := array_append(blockers,'contact_point_marketing_not_eligible'); end if;
      if cp.suppression_reason is not null then blockers := array_append(blockers,'contact_point_suppressed'); end if;
      if lower(coalesce(cp.deliverability_state,'')) in ('undeliverable','bounced','suppressed','invalid') then blockers := array_append(blockers,'contact_point_not_deliverable'); end if;
      if lower(coalesce(cp.verification_state,'')) in ('unverified','stale','invalid','rejected') then blockers := array_append(blockers,'contact_point_verification_not_current'); end if;
      if nullif(btrim(cp.normalized_value),'') is null or position('@' in cp.normalized_value) = 0 then blockers := array_append(blockers,'contact_point_email_invalid'); end if;
    end if;
  end if;

  if c.campaign_asset_id is null then
    blockers := array_append(blockers,'campaign_asset_missing');
  else
    select * into a from local_intel.campaign_assets where id=c.campaign_asset_id;
    if not found then
      blockers := array_append(blockers,'campaign_asset_missing');
    else
      if a.campaign_id is distinct from c.campaign_id then blockers := array_append(blockers,'campaign_asset_campaign_mismatch'); end if;
      if a.status <> 'approved' then blockers := array_append(blockers,'campaign_asset_not_approved'); end if;
      if a.channel <> 'email' then blockers := array_append(blockers,'campaign_asset_not_email'); end if;
      if a.asset_kind <> 'email_message' then blockers := array_append(blockers,'campaign_asset_not_rendered_message'); end if;
      if t.id is not null and a.segment_id is not null and a.segment_id is distinct from t.segment_id then blockers := array_append(blockers,'campaign_asset_segment_mismatch'); end if;
      if nullif(btrim(a.content->>'subject'),'') is null then blockers := array_append(blockers,'campaign_asset_subject_missing'); end if;
      if nullif(a.content->>'body','') is null then blockers := array_append(blockers,'campaign_asset_body_missing'); end if;
      v_content_type := coalesce(nullif(btrim(a.content->>'content_type'),''),'text/plain');
      if v_content_type not in ('text/plain','text/markdown','text/html') then blockers := array_append(blockers,'campaign_asset_content_type_invalid'); end if;
      v_body := a.content->>'body';
      if v_body is not null then v_body_hash := encode(extensions.digest(v_body,'sha256'),'hex'); end if;
    end if;
  end if;

  return jsonb_build_object(
    'send_ready',cardinality(blockers)=0,
    'blockers',to_jsonb(blockers),
    'provider','gmail',
    'campaign_id',c.campaign_id,
    'campaign_status',cam.status,
    'campaign_target_id',c.campaign_target_id,
    'campaign_contact_id',c.id,
    'contact_state',c.state,
    'contact_point_id',c.contact_point_id,
    'recipient_address',case when cp.id is null then null else cp.normalized_value end,
    'contact_marketing_status',cp.marketing_status,
    'contact_verification_state',cp.verification_state,
    'contact_deliverability_state',cp.deliverability_state,
    'campaign_asset_id',c.campaign_asset_id,
    'asset_kind',a.asset_kind,
    'asset_status',a.status,
    'asset_channel',a.channel,
    'subject',a.content->>'subject',
    'body',v_body,
    'content_type',v_content_type,
    'body_sha256',v_body_hash,
    'truth_contract',jsonb_build_object(
      'transport_provider','gmail',
      'provider_receipt_required_before_executed_action',true,
      'one_recipient_per_send',true,
      'contact_level_marketing_clearance_required',true,
      'approved_rendered_message_required',true,
      'send_ready_is_not_execution',true
    )
  );
end;
$function$;

create or replace function local_intel.record_campaign_email_send_receipt_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel','extensions'
as $function$
declare
  v_provider text := lower(nullif(btrim(p_payload->>'provider'),''));
  v_message_id text := nullif(btrim(p_payload->>'provider_message_id'),'');
  v_thread_id text := nullif(btrim(p_payload->>'provider_thread_id'),'');
  v_sender text := lower(nullif(btrim(p_payload->>'sender_address'),''));
  v_recipient text := lower(nullif(btrim(p_payload->>'recipient_address'),''));
  v_subject text := nullif(p_payload->>'subject','');
  v_body_hash text := lower(nullif(btrim(p_payload->>'body_sha256'),''));
  v_actor_kind text := nullif(btrim(p_payload->>'actor_kind'),'');
  v_actor_ref text := nullif(btrim(p_payload->>'actor_ref'),'');
  v_occurred_at timestamptz := coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now());
  v_contact_id uuid;
  v_packet jsonb;
  v_action_id uuid;
  v_receipt_id uuid;
  v_existing local_intel.campaign_send_receipts%rowtype;
  v_execution_key text;
begin
  begin
    v_contact_id := (p_payload->>'campaign_contact_id')::uuid;
  exception when invalid_text_representation or null_value_not_allowed then
    raise exception 'campaign_contact_id must be UUID';
  end;

  if v_provider is null then raise exception 'provider is required'; end if;
  if v_provider <> 'gmail' then raise exception 'Unsupported campaign email provider %',v_provider; end if;
  if v_message_id is null then raise exception 'provider_message_id is required'; end if;
  if length(v_message_id) > 500 then raise exception 'provider_message_id is too long'; end if;
  if v_sender is null or position('@' in v_sender)=0 then raise exception 'sender_address must be an email address'; end if;
  if v_recipient is null or position('@' in v_recipient)=0 then raise exception 'recipient_address must be an email address'; end if;
  if v_subject is null then raise exception 'subject is required'; end if;
  if v_body_hash is null or v_body_hash !~ '^[0-9a-f]{64}$' then raise exception 'body_sha256 must be a lowercase SHA-256 hex digest'; end if;
  if v_actor_kind is null then raise exception 'actor_kind is required'; end if;

  select * into v_existing
  from local_intel.campaign_send_receipts
  where provider=v_provider and provider_message_id=v_message_id;
  if found then
    if v_existing.campaign_contact_id is distinct from v_contact_id
       or lower(v_existing.recipient_address) is distinct from v_recipient
       or v_existing.subject is distinct from v_subject
       or v_existing.body_sha256 is distinct from v_body_hash then
      raise exception 'Provider message % already belongs to a different immutable campaign send receipt',v_message_id;
    end if;
    return jsonb_build_object('receipt_id',v_existing.id,'action_id',v_existing.action_id,'idempotent_replay',true);
  end if;

  v_packet := local_intel.get_campaign_email_send_packet_v1(v_contact_id);
  if coalesce((v_packet->>'send_ready')::boolean,false)=false then
    raise exception 'Campaign email is not send-ready: %',v_packet->'blockers';
  end if;
  if lower(v_packet->>'provider') is distinct from v_provider then raise exception 'Provider does not match send packet'; end if;
  if lower(v_packet->>'recipient_address') is distinct from v_recipient then raise exception 'Provider recipient does not match governed campaign contact point'; end if;
  if v_packet->>'subject' is distinct from v_subject then raise exception 'Provider subject does not match approved campaign message'; end if;
  if lower(v_packet->>'body_sha256') is distinct from v_body_hash then raise exception 'Provider body hash does not match approved campaign message'; end if;

  v_execution_key := v_provider || ':' || v_message_id;
  v_action_id := local_intel.record_campaign_outreach_execution_v1(jsonb_build_object(
    'campaign_target_id',v_packet->>'campaign_target_id',
    'campaign_contact_id',v_contact_id,
    'execution_key',v_execution_key,
    'actor_kind',v_actor_kind,
    'actor_ref',v_actor_ref,
    'channel','email',
    'occurred_at',v_occurred_at,
    'evidence_snapshot',jsonb_build_object(
      'provider',v_provider,
      'provider_message_id',v_message_id,
      'provider_thread_id',v_thread_id,
      'sender_address',v_sender,
      'recipient_address',v_recipient,
      'subject',v_subject,
      'body_sha256',v_body_hash,
      'campaign_asset_id',v_packet->>'campaign_asset_id',
      'contact_point_id',v_packet->>'contact_point_id',
      'provider_receipt',coalesce(p_payload->'provider_receipt','{}'::jsonb),
      'receipt_semantics','provider-confirmed transport receipt; not proof of delivery, reading, response, or causality'
    )
  ));

  insert into local_intel.campaign_send_receipts(
    provider,provider_message_id,provider_thread_id,campaign_id,campaign_target_id,
    campaign_contact_id,contact_point_id,campaign_asset_id,action_id,sender_address,
    recipient_address,subject,body_sha256,occurred_at,provider_receipt,metadata
  ) values (
    v_provider,v_message_id,v_thread_id,(v_packet->>'campaign_id')::uuid,(v_packet->>'campaign_target_id')::uuid,
    v_contact_id,(v_packet->>'contact_point_id')::uuid,(v_packet->>'campaign_asset_id')::uuid,v_action_id,v_sender,
    v_recipient,v_subject,v_body_hash,v_occurred_at,coalesce(p_payload->'provider_receipt','{}'::jsonb),
    jsonb_build_object(
      'send_receipt_membrane_version','1.0',
      'provider_receipt_precedes_executed_action',true,
      'transport_receipt_is_not_delivery_or_response',true,
      'human_authorization_reference',nullif(p_payload->>'human_authorization_reference','')
    )
  ) returning id into v_receipt_id;

  return jsonb_build_object('receipt_id',v_receipt_id,'action_id',v_action_id,'idempotent_replay',false);
end;
$function$;

revoke all on table local_intel.campaign_send_receipts from public,anon,authenticated,service_role;
grant select on table local_intel.campaign_send_receipts to service_role;

revoke execute on function local_intel.block_campaign_send_receipt_mutation_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.get_campaign_email_send_packet_v1(uuid) from public,anon,authenticated;
revoke execute on function local_intel.record_campaign_email_send_receipt_v1(jsonb) from public,anon,authenticated;
grant execute on function local_intel.get_campaign_email_send_packet_v1(uuid) to service_role;
grant execute on function local_intel.record_campaign_email_send_receipt_v1(jsonb) to service_role;
