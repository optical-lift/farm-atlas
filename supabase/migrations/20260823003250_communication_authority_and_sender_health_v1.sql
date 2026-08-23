create table if not exists local_intel.communication_classes (
  class_key text primary key,
  description text not null,
  is_marketing boolean not null default false,
  requires_explicit_opt_in boolean not null default false,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now()
);

create table if not exists local_intel.communication_providers (
  provider_key text primary key,
  provider_class text not null check (provider_class in ('mailbox','transactional_esp','marketing_esp')),
  connection_mode text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists local_intel.communication_provider_connection_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references local_intel.communication_providers(provider_key) on delete restrict,
  connection_state text not null check (connection_state in ('not_connected','connected','degraded','disconnected','revoked')),
  basis text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists communication_provider_connection_events_latest_idx on local_intel.communication_provider_connection_events(provider_key,occurred_at desc,created_at desc);

create table if not exists local_intel.communication_class_provider_policies (
  class_key text not null references local_intel.communication_classes(class_key) on delete restrict,
  provider_class text not null check (provider_class in ('mailbox','transactional_esp','marketing_esp')),
  allowed boolean not null,
  machine_execution_allowed boolean not null default false,
  human_authorization_required boolean not null default true,
  one_recipient_per_send boolean not null default true,
  policy_version text not null,
  status text not null default 'active' check (status in ('active','retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (class_key,provider_class,policy_version)
);
create unique index if not exists communication_class_provider_active_unique on local_intel.communication_class_provider_policies(class_key,provider_class) where status='active';

create table if not exists local_intel.communication_class_relationship_policies (
  class_key text not null references local_intel.communication_classes(class_key) on delete restrict,
  relationship_basis text not null,
  allowed boolean not null default true,
  policy_version text not null,
  status text not null default 'active' check (status in ('active','retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (class_key,relationship_basis,policy_version)
);
create unique index if not exists communication_class_relationship_active_unique on local_intel.communication_class_relationship_policies(class_key,relationship_basis) where status='active';

create table if not exists local_intel.communication_permission_events (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references local_intel.entities(id) on delete cascade,
  contact_point_id uuid references local_intel.contact_points(id) on delete cascade,
  scope_key text not null check (scope_key in ('all','marketing','conversation','transactional','subscribed_marketing','prospecting')),
  permission_state text not null check (permission_state in ('allowed','denied')),
  basis text not null check (basis in ('explicit_opt_in','explicit_opt_out','unsubscribe','complaint','contractual','manual','provider','relationship')),
  evidence_ref text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists communication_permission_events_latest_idx on local_intel.communication_permission_events(entity_id,contact_point_id,scope_key,occurred_at desc,created_at desc);

create table if not exists local_intel.communication_sender_identities (
  id uuid primary key default gen_random_uuid(),
  sender_identity_key text not null unique,
  provider_key text not null references local_intel.communication_providers(provider_key) on delete restrict,
  from_address text not null,
  from_domain text not null,
  status text not null default 'active' check (status in ('active','paused','retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key,from_address)
);

create table if not exists local_intel.communication_sender_health_policies (
  class_key text not null references local_intel.communication_classes(class_key) on delete restrict,
  provider_class text not null check (provider_class in ('mailbox','transactional_esp','marketing_esp')),
  max_sends_per_hour integer check (max_sends_per_hour is null or max_sends_per_hour > 0),
  max_sends_per_day integer check (max_sends_per_day is null or max_sends_per_day > 0),
  min_rate_sample integer not null default 20 check (min_rate_sample > 0),
  max_hard_bounce_rate numeric check (max_hard_bounce_rate is null or (max_hard_bounce_rate >= 0 and max_hard_bounce_rate <= 1)),
  max_complaint_rate numeric check (max_complaint_rate is null or (max_complaint_rate >= 0 and max_complaint_rate <= 1)),
  policy_version text not null,
  status text not null default 'active' check (status in ('active','retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (class_key,provider_class,policy_version)
);
create unique index if not exists communication_sender_health_active_unique on local_intel.communication_sender_health_policies(class_key,provider_class) where status='active';

create table if not exists local_intel.communication_sender_health_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  sender_identity_id uuid not null references local_intel.communication_sender_identities(id) on delete restrict,
  event_type text not null check (event_type in ('accepted','delivered','soft_bounce','hard_bounce','complaint','unsubscribe','provider_rejection','provider_pause','provider_resume')),
  campaign_send_receipt_id uuid references local_intel.campaign_send_receipts(id) on delete restrict,
  contact_point_id uuid references local_intel.contact_points(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists communication_sender_health_events_sender_time_idx on local_intel.communication_sender_health_events(sender_identity_id,occurred_at desc);

create table if not exists local_intel.communication_authority_assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_key text not null unique,
  communication_class text not null references local_intel.communication_classes(class_key) on delete restrict,
  provider_key text not null references local_intel.communication_providers(provider_key) on delete restrict,
  sender_identity_id uuid references local_intel.communication_sender_identities(id) on delete restrict,
  entity_id uuid not null references local_intel.entities(id) on delete restrict,
  contact_point_id uuid not null references local_intel.contact_points(id) on delete restrict,
  relationship_basis text not null,
  permission_state text not null check (permission_state in ('send','human_review','research_first','deny')),
  human_send_allowed boolean not null,
  machine_send_allowed boolean not null,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  policy_snapshot jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table local_intel.campaign_send_receipts
  add column if not exists sender_identity_id uuid references local_intel.communication_sender_identities(id) on delete restrict,
  add column if not exists communication_authority_assessment_id uuid references local_intel.communication_authority_assessments(id) on delete restrict;

create or replace function local_intel.block_communication_history_mutation_v1() returns trigger language plpgsql set search_path to 'pg_catalog','local_intel' as $function$ begin raise exception 'communication governance history is append-only; append a new event or assessment instead'; end; $function$;

drop trigger if exists communication_provider_connection_events_append_only_v1 on local_intel.communication_provider_connection_events;
create trigger communication_provider_connection_events_append_only_v1 before update or delete on local_intel.communication_provider_connection_events for each row execute function local_intel.block_communication_history_mutation_v1();
drop trigger if exists communication_permission_events_append_only_v1 on local_intel.communication_permission_events;
create trigger communication_permission_events_append_only_v1 before update or delete on local_intel.communication_permission_events for each row execute function local_intel.block_communication_history_mutation_v1();
drop trigger if exists communication_sender_health_events_append_only_v1 on local_intel.communication_sender_health_events;
create trigger communication_sender_health_events_append_only_v1 before update or delete on local_intel.communication_sender_health_events for each row execute function local_intel.block_communication_history_mutation_v1();
drop trigger if exists communication_authority_assessments_append_only_v1 on local_intel.communication_authority_assessments;
create trigger communication_authority_assessments_append_only_v1 before update or delete on local_intel.communication_authority_assessments for each row execute function local_intel.block_communication_history_mutation_v1();

create or replace view local_intel.v_communication_provider_connection_v1 as
select distinct on (p.provider_key) p.provider_key,p.provider_class,p.connection_mode,p.display_name,e.connection_state,e.basis,e.occurred_at,e.metadata
from local_intel.communication_providers p left join local_intel.communication_provider_connection_events e on e.provider_key=p.provider_key
order by p.provider_key,e.occurred_at desc nulls last,e.created_at desc nulls last;

create or replace view local_intel.v_communication_permission_latest_v1 as
select distinct on (entity_id,contact_point_id,scope_key) id,entity_id,contact_point_id,scope_key,permission_state,basis,evidence_ref,occurred_at,metadata
from local_intel.communication_permission_events order by entity_id,contact_point_id,scope_key,occurred_at desc,created_at desc;

create or replace view local_intel.v_communication_sender_health_v1 as
with base as (
  select si.id sender_identity_id,si.sender_identity_key,si.provider_key,p.provider_class,si.from_address,si.status sender_status,hp.class_key,hp.policy_version,hp.max_sends_per_hour,hp.max_sends_per_day,hp.min_rate_sample,hp.max_hard_bounce_rate,hp.max_complaint_rate,
    (select count(*) from local_intel.campaign_send_receipts r where r.sender_identity_id=si.id and r.occurred_at>=now()-interval '1 hour') sends_1h,
    (select count(*) from local_intel.campaign_send_receipts r where r.sender_identity_id=si.id and r.occurred_at>=now()-interval '24 hours') sends_24h,
    (select count(*) from local_intel.campaign_send_receipts r where r.sender_identity_id=si.id and r.occurred_at>=now()-interval '30 days') sends_30d,
    (select count(*) from local_intel.communication_sender_health_events e where e.sender_identity_id=si.id and e.event_type='hard_bounce' and e.occurred_at>=now()-interval '30 days') hard_bounces_30d,
    (select count(*) from local_intel.communication_sender_health_events e where e.sender_identity_id=si.id and e.event_type='complaint' and e.occurred_at>=now()-interval '30 days') complaints_30d,
    coalesce((select e.event_type='provider_pause' from local_intel.communication_sender_health_events e where e.sender_identity_id=si.id and e.event_type in ('provider_pause','provider_resume') order by e.occurred_at desc,e.created_at desc limit 1),false) provider_paused
  from local_intel.communication_sender_identities si join local_intel.communication_providers p on p.provider_key=si.provider_key join local_intel.communication_sender_health_policies hp on hp.provider_class=p.provider_class and hp.status='active'
)
select base.*,
 case when sends_30d>0 then hard_bounces_30d::numeric/sends_30d else null end hard_bounce_rate_30d,
 case when sends_30d>0 then complaints_30d::numeric/sends_30d else null end complaint_rate_30d,
 case when sender_status<>'active' then 'paused' when provider_paused then 'paused'
      when max_sends_per_hour is not null and sends_1h>=max_sends_per_hour then 'paused'
      when max_sends_per_day is not null and sends_24h>=max_sends_per_day then 'paused'
      when sends_30d>=min_rate_sample and max_hard_bounce_rate is not null and hard_bounces_30d::numeric/sends_30d>max_hard_bounce_rate then 'paused'
      when sends_30d>=min_rate_sample and max_complaint_rate is not null and complaints_30d::numeric/sends_30d>max_complaint_rate then 'paused'
      when sends_30d<min_rate_sample then 'insufficient_sample' else 'healthy' end health_state
from base;

insert into local_intel.communication_classes(class_key,description,is_marketing,requires_explicit_opt_in) values
 ('conversation','Human or business correspondence within an existing relationship or conversation.',false,false),
 ('transactional','Operational messages required by an existing transaction, account, employment, vendor, or contractual relationship.',false,false),
 ('subscribed_marketing','Marketing or subscription communication to a recipient with explicit opt-in.',true,true),
 ('prospecting','One-to-one new-business outreach to a governed public business contact route.',true,false)
on conflict (class_key) do nothing;
insert into local_intel.communication_providers(provider_key,provider_class,connection_mode,display_name) values ('gmail','mailbox','oauth_mailbox','Gmail') on conflict (provider_key) do nothing;
insert into local_intel.communication_provider_connection_events(provider_key,connection_state,basis,metadata)
select 'gmail','not_connected','migration_initial_state',jsonb_build_object('truth','Atlas has a Gmail transport contract but no Atlas-owned Gmail OAuth connection yet')
where not exists(select 1 from local_intel.communication_provider_connection_events where provider_key='gmail');
insert into local_intel.communication_class_provider_policies(class_key,provider_class,allowed,machine_execution_allowed,human_authorization_required,one_recipient_per_send,policy_version,metadata) values
 ('conversation','mailbox',true,false,true,true,'1.0',jsonb_build_object('reason','Connected mailbox correspondence remains human-authorized in v1.')),
 ('transactional','transactional_esp',true,true,false,true,'1.0',jsonb_build_object('reason','Dedicated transactional infrastructure may automate governed operational messages.')),
 ('transactional','mailbox',true,false,true,true,'1.0',jsonb_build_object('reason','Mailbox transactional sends remain human-authorized in v1.')),
 ('subscribed_marketing','marketing_esp',true,true,false,true,'1.0',jsonb_build_object('reason','Opted-in marketing belongs on dedicated marketing infrastructure.')),
 ('subscribed_marketing','mailbox',false,false,true,true,'1.0',jsonb_build_object('reason','Do not use a human mailbox as the bulk subscription-marketing rail.')),
 ('prospecting','mailbox',true,false,true,true,'1.0',jsonb_build_object('reason','Prospecting begins as low-volume, one-recipient, human-authorized mailbox outreach.')),
 ('prospecting','marketing_esp',false,false,true,true,'1.0',jsonb_build_object('reason','Do not convert cold prospecting into bulk marketing transport in v1.'))
on conflict do nothing;
insert into local_intel.communication_class_relationship_policies(class_key,relationship_basis,allowed,policy_version,metadata) values
 ('conversation','existing_correspondence',true,'1.0','{}'),('conversation','existing_customer',true,'1.0','{}'),('conversation','vendor',true,'1.0','{}'),('conversation','employee',true,'1.0','{}'),('conversation','contractual',true,'1.0','{}'),
 ('transactional','existing_customer',true,'1.0','{}'),('transactional','system_user',true,'1.0','{}'),('transactional','employee',true,'1.0','{}'),('transactional','vendor',true,'1.0','{}'),('transactional','contractual',true,'1.0','{}'),
 ('subscribed_marketing','subscriber_opt_in',true,'1.0','{}'),('prospecting','public_business_prospect',true,'1.0','{}') on conflict do nothing;
insert into local_intel.communication_sender_health_policies(class_key,provider_class,max_sends_per_hour,max_sends_per_day,min_rate_sample,max_hard_bounce_rate,max_complaint_rate,policy_version,metadata)
values ('prospecting','mailbox',10,30,20,0.05,0.001,'pilot_conservative_v1',jsonb_build_object('threshold_semantics','Atlas governance thresholds, not provider-published sending limits','purpose','Keep initial prospecting human-scale and stop when sender-health evidence deteriorates')) on conflict do nothing;

create or replace function local_intel.get_communication_authority_v1(p_payload jsonb) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$
declare
 v_class text:=nullif(btrim(p_payload->>'communication_class'),''); v_provider text:=lower(nullif(btrim(p_payload->>'provider_key'),'')); v_relationship text:=nullif(btrim(p_payload->>'relationship_basis'),'');
 v_entity uuid; v_contact uuid; v_sender uuid; cp local_intel.contact_points%rowtype; si local_intel.communication_sender_identities%rowtype; pp local_intel.communication_class_provider_policies%rowtype; pc local_intel.v_communication_provider_connection_v1%rowtype; h local_intel.v_communication_sender_health_v1%rowtype;
 v_provider_class text; v_is_marketing boolean:=false; v_requires_optin boolean:=false; blockers text[]:=array[]::text[]; warnings text[]:=array[]::text[]; v_human_allowed boolean:=true; v_machine_allowed boolean:=false; v_permission text; v_pref text; v_denied boolean:=false; v_opted_in boolean:=false;
begin
 begin v_entity:=(p_payload->>'entity_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'entity_id must be UUID'; end;
 begin v_contact:=(p_payload->>'contact_point_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'contact_point_id must be UUID'; end;
 begin v_sender:=nullif(p_payload->>'sender_identity_id','')::uuid; exception when invalid_text_representation then raise exception 'sender_identity_id must be UUID'; end;
 if v_class is null or not exists(select 1 from local_intel.communication_classes where class_key=v_class and status='active') then blockers:=array_append(blockers,'communication_class_unknown'); else select is_marketing,requires_explicit_opt_in into v_is_marketing,v_requires_optin from local_intel.communication_classes where class_key=v_class; end if;
 select * into cp from local_intel.contact_points where id=v_contact; if not found then blockers:=array_append(blockers,'contact_point_missing'); elsif cp.entity_id is distinct from v_entity then blockers:=array_append(blockers,'contact_point_entity_mismatch'); end if;
 select * into pc from local_intel.v_communication_provider_connection_v1 where provider_key=v_provider; if not found then blockers:=array_append(blockers,'provider_unknown'); else v_provider_class:=pc.provider_class; if coalesce(pc.connection_state,'not_connected')<>'connected' then blockers:=array_append(blockers,'provider_not_connected'); end if; end if;
 if v_provider_class is not null and v_class is not null then select * into pp from local_intel.communication_class_provider_policies where class_key=v_class and provider_class=v_provider_class and status='active'; if not found or not pp.allowed then blockers:=array_append(blockers,'provider_class_not_allowed_for_communication_class'); end if; end if;
 if v_class is not null and v_relationship is not null then if not exists(select 1 from local_intel.communication_class_relationship_policies where class_key=v_class and relationship_basis=v_relationship and status='active' and allowed) then blockers:=array_append(blockers,'relationship_basis_not_authorized_for_class'); end if; else blockers:=array_append(blockers,'relationship_basis_required'); end if;
 if cp.id is not null then
   if cp.suppression_reason is not null then blockers:=array_append(blockers,'contact_point_suppressed'); end if;
   if lower(coalesce(cp.deliverability_state,'')) in ('undeliverable','bounced','suppressed','invalid') then blockers:=array_append(blockers,'contact_point_not_deliverable'); end if;
   if lower(coalesce(cp.verification_state,'')) in ('unverified','stale','invalid','rejected') then blockers:=array_append(blockers,'contact_point_verification_not_current'); end if;
   select preference_state into v_pref from local_intel.entity_contact_preferences where entity_id=v_entity and channel_type=cp.contact_type and valid_from<=now() and (valid_to is null or valid_to>=now()) order by valid_from desc,created_at desc limit 1;
   if v_pref='do_not_contact' then blockers:=array_append(blockers,'entity_channel_do_not_contact'); end if; if v_pref='avoid' then warnings:=array_append(warnings,'entity_channel_avoid_preference'); end if;
   select exists(select 1 from local_intel.v_communication_permission_latest_v1 x where x.entity_id=v_entity and (x.contact_point_id is null or x.contact_point_id=v_contact) and x.permission_state='denied' and x.scope_key in ('all',v_class,case when v_is_marketing then 'marketing' else '__not_marketing__' end)) into v_denied;
   if v_denied then blockers:=array_append(blockers,'communication_permission_denied'); end if;
   if v_is_marketing and cp.marketing_status<>'eligible' then blockers:=array_append(blockers,'contact_point_marketing_not_eligible'); end if;
   if v_class='prospecting' and cp.visibility<>'public' then blockers:=array_append(blockers,'prospecting_requires_public_contact_route'); end if;
   if v_requires_optin then select exists(select 1 from local_intel.v_communication_permission_latest_v1 x where x.entity_id=v_entity and (x.contact_point_id is null or x.contact_point_id=v_contact) and x.permission_state='allowed' and x.basis='explicit_opt_in' and x.scope_key in ('marketing',v_class)) into v_opted_in; if not v_opted_in then blockers:=array_append(blockers,'explicit_opt_in_required'); end if; end if;
 end if;
 if v_sender is null then blockers:=array_append(blockers,'sender_identity_required'); else select * into si from local_intel.communication_sender_identities where id=v_sender; if not found then blockers:=array_append(blockers,'sender_identity_unknown'); else if si.status<>'active' then blockers:=array_append(blockers,'sender_identity_not_active'); end if; if si.provider_key is distinct from v_provider then blockers:=array_append(blockers,'sender_identity_provider_mismatch'); end if; if v_provider_class is not null then select * into h from local_intel.v_communication_sender_health_v1 where sender_identity_id=v_sender and class_key=v_class; if not found then warnings:=array_append(warnings,'sender_health_policy_or_sample_missing'); elsif h.health_state='paused' then blockers:=array_append(blockers,'sender_health_paused'); elsif h.health_state='insufficient_sample' then warnings:=array_append(warnings,'sender_health_insufficient_sample'); end if; end if; end if; end if;
 if cardinality(blockers)>0 then if blockers && array['communication_permission_denied','entity_channel_do_not_contact','contact_point_suppressed','contact_point_not_deliverable','provider_class_not_allowed_for_communication_class','relationship_basis_not_authorized_for_class','sender_health_paused'] then v_permission:='deny'; else v_permission:='research_first'; end if; v_human_allowed:=false; v_machine_allowed:=false; else v_human_allowed:=true; v_machine_allowed:=coalesce(pp.machine_execution_allowed,false) and not coalesce(pp.human_authorization_required,true) and coalesce(h.health_state,'insufficient_sample')='healthy'; if coalesce(pp.human_authorization_required,true) or cardinality(warnings)>0 then v_permission:='human_review'; else v_permission:='send'; end if; end if;
 return jsonb_build_object('permission_state',v_permission,'human_send_allowed',v_human_allowed,'machine_send_allowed',v_machine_allowed,'communication_class',v_class,'provider_key',v_provider,'provider_class',v_provider_class,'provider_connection_state',pc.connection_state,'sender_identity_id',v_sender,'sender_health_state',h.health_state,'relationship_basis',v_relationship,'blockers',to_jsonb(blockers),'warnings',to_jsonb(warnings),'policy_snapshot',jsonb_build_object('provider_policy_version',pp.policy_version,'human_authorization_required',pp.human_authorization_required,'machine_execution_allowed_by_class_policy',pp.machine_execution_allowed,'one_recipient_per_send',pp.one_recipient_per_send,'sender_health_policy_version',h.policy_version,'purpose_specific_permissions',true,'marketing_opt_out_does_not_silently_block_transactional_or_conversation',true));
end;$function$;

create or replace function local_intel.record_communication_authority_assessment_v1(p_payload jsonb) returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$ declare v_key text:=nullif(btrim(p_payload->>'assessment_key'),''); v_result jsonb; v_id uuid; begin if v_key is null then raise exception 'assessment_key is required'; end if; select id into v_id from local_intel.communication_authority_assessments where assessment_key=v_key; if v_id is not null then return v_id; end if; v_result:=local_intel.get_communication_authority_v1(p_payload); insert into local_intel.communication_authority_assessments(assessment_key,communication_class,provider_key,sender_identity_id,entity_id,contact_point_id,relationship_basis,permission_state,human_send_allowed,machine_send_allowed,blockers,warnings,policy_snapshot,assessed_at,metadata) values(v_key,p_payload->>'communication_class',lower(p_payload->>'provider_key'),nullif(p_payload->>'sender_identity_id','')::uuid,(p_payload->>'entity_id')::uuid,(p_payload->>'contact_point_id')::uuid,p_payload->>'relationship_basis',v_result->>'permission_state',(v_result->>'human_send_allowed')::boolean,(v_result->>'machine_send_allowed')::boolean,coalesce(v_result->'blockers','[]'::jsonb),coalesce(v_result->'warnings','[]'::jsonb),coalesce(v_result->'policy_snapshot','{}'::jsonb),now(),coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_id; return v_id; end;$function$;
create or replace function local_intel.record_communication_permission_event_v1(p_payload jsonb) returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$ declare v_id uuid; v_entity uuid; v_contact uuid; begin begin v_entity:=(p_payload->>'entity_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'entity_id must be UUID'; end; begin v_contact:=nullif(p_payload->>'contact_point_id','')::uuid; exception when invalid_text_representation then raise exception 'contact_point_id must be UUID'; end; if v_contact is not null and not exists(select 1 from local_intel.contact_points where id=v_contact and entity_id=v_entity) then raise exception 'contact_point_id does not belong to entity_id'; end if; insert into local_intel.communication_permission_events(entity_id,contact_point_id,scope_key,permission_state,basis,evidence_ref,occurred_at,metadata) values(v_entity,v_contact,p_payload->>'scope_key',p_payload->>'permission_state',p_payload->>'basis',nullif(p_payload->>'evidence_ref',''),coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()),coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_id; return v_id; end;$function$;
create or replace function local_intel.record_communication_provider_connection_event_v1(p_payload jsonb) returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$ declare v_id uuid; begin if not exists(select 1 from local_intel.communication_providers where provider_key=lower(p_payload->>'provider_key')) then raise exception 'Unknown communication provider'; end if; insert into local_intel.communication_provider_connection_events(provider_key,connection_state,basis,occurred_at,metadata) values(lower(p_payload->>'provider_key'),p_payload->>'connection_state',p_payload->>'basis',coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()),coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_id; return v_id; end;$function$;
create or replace function local_intel.register_communication_sender_identity_v1(p_payload jsonb) returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$ declare v_id uuid; v_provider text:=lower(nullif(btrim(p_payload->>'provider_key'),'')); v_address text:=lower(nullif(btrim(p_payload->>'from_address'),'')); v_domain text; v_key text:=nullif(btrim(p_payload->>'sender_identity_key'),''); begin if v_provider is null or not exists(select 1 from local_intel.communication_providers where provider_key=v_provider) then raise exception 'Unknown communication provider'; end if; if v_address is null or position('@' in v_address)=0 then raise exception 'from_address must be an email address'; end if; if v_key is null then raise exception 'sender_identity_key is required'; end if; v_domain:=split_part(v_address,'@',2); insert into local_intel.communication_sender_identities(sender_identity_key,provider_key,from_address,from_domain,status,metadata) values(v_key,v_provider,v_address,v_domain,'active',coalesce(p_payload->'metadata','{}'::jsonb)) on conflict (provider_key,from_address) do update set sender_identity_key=excluded.sender_identity_key,status='active',metadata=local_intel.communication_sender_identities.metadata||excluded.metadata,updated_at=now() returning id into v_id; return v_id; end;$function$;
create or replace function local_intel.record_communication_sender_health_event_v1(p_payload jsonb) returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$ declare v_id uuid; v_sender uuid; begin begin v_sender:=(p_payload->>'sender_identity_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'sender_identity_id must be UUID'; end; if not exists(select 1 from local_intel.communication_sender_identities where id=v_sender) then raise exception 'Unknown sender identity'; end if; insert into local_intel.communication_sender_health_events(event_key,sender_identity_id,event_type,campaign_send_receipt_id,contact_point_id,occurred_at,metadata) values(p_payload->>'event_key',v_sender,p_payload->>'event_type',nullif(p_payload->>'campaign_send_receipt_id','')::uuid,nullif(p_payload->>'contact_point_id','')::uuid,coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()),coalesce(p_payload->'metadata','{}'::jsonb)) on conflict(event_key) do nothing returning id into v_id; if v_id is null then select id into v_id from local_intel.communication_sender_health_events where event_key=p_payload->>'event_key'; end if; return v_id; end;$function$;

create or replace function local_intel.get_campaign_email_send_packet_v2(p_campaign_contact_id uuid,p_sender_identity_id uuid) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$ declare v_base jsonb; c local_intel.campaign_contacts%rowtype; v_authority jsonb; blockers jsonb; begin v_base:=local_intel.get_campaign_email_send_packet_v1(p_campaign_contact_id); select * into c from local_intel.campaign_contacts where id=p_campaign_contact_id; if not found then raise exception 'Unknown campaign contact %',p_campaign_contact_id; end if; v_authority:=local_intel.get_communication_authority_v1(jsonb_build_object('communication_class','prospecting','provider_key','gmail','sender_identity_id',p_sender_identity_id,'entity_id',c.entity_id,'contact_point_id',c.contact_point_id,'relationship_basis','public_business_prospect')); blockers:=coalesce(v_base->'blockers','[]'::jsonb)||coalesce(v_authority->'blockers','[]'::jsonb); return v_base||jsonb_build_object('send_ready',jsonb_array_length(blockers)=0 and coalesce((v_authority->>'human_send_allowed')::boolean,false),'blockers',blockers,'communication_authority',v_authority,'communication_class','prospecting','sender_identity_id',p_sender_identity_id); end;$function$;

create or replace function local_intel.record_campaign_email_send_receipt_v2(p_payload jsonb) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','local_intel','extensions' as $function$
declare v_provider text:=lower(nullif(btrim(p_payload->>'provider'),'')); v_message_id text:=nullif(btrim(p_payload->>'provider_message_id'),''); v_thread_id text:=nullif(btrim(p_payload->>'provider_thread_id'),''); v_sender_address text:=lower(nullif(btrim(p_payload->>'sender_address'),''); v_recipient text:=lower(nullif(btrim(p_payload->>'recipient_address'),''); v_subject text:=nullif(p_payload->>'subject',''); v_body_hash text:=lower(nullif(btrim(p_payload->>'body_sha256'),''); v_actor_kind text:=nullif(btrim(p_payload->>'actor_kind'),''); v_actor_ref text:=nullif(btrim(p_payload->>'actor_ref'),''); v_auth_ref text:=nullif(btrim(p_payload->>'human_authorization_reference'),''); v_occurred_at timestamptz:=coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()); v_contact_id uuid; v_sender_identity_id uuid; v_packet jsonb; v_comm_auth jsonb; v_comm_assessment_id uuid; v_action_id uuid; v_receipt_id uuid; v_existing local_intel.campaign_send_receipts%rowtype; v_execution_key text; si local_intel.communication_sender_identities%rowtype;
begin begin v_contact_id:=(p_payload->>'campaign_contact_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'campaign_contact_id must be UUID'; end; begin v_sender_identity_id:=(p_payload->>'sender_identity_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'sender_identity_id must be UUID'; end; if v_provider<>'gmail' then raise exception 'Unsupported campaign email provider %',v_provider; end if; if v_message_id is null then raise exception 'provider_message_id is required'; end if; if v_sender_address is null or position('@' in v_sender_address)=0 then raise exception 'sender_address must be an email address'; end if; if v_recipient is null or position('@' in v_recipient)=0 then raise exception 'recipient_address must be an email address'; end if; if v_subject is null then raise exception 'subject is required'; end if; if v_body_hash is null or v_body_hash !~ '^[0-9a-f]{64}$' then raise exception 'body_sha256 must be a lowercase SHA-256 hex digest'; end if; if v_actor_kind is null then raise exception 'actor_kind is required'; end if;
 select * into si from local_intel.communication_sender_identities where id=v_sender_identity_id; if not found then raise exception 'Unknown sender identity'; end if; if si.provider_key<>v_provider then raise exception 'Sender identity provider does not match receipt provider'; end if; if lower(si.from_address)<>v_sender_address then raise exception 'Sender address does not match governed sender identity'; end if;
 select * into v_existing from local_intel.campaign_send_receipts where provider=v_provider and provider_message_id=v_message_id; if found then if v_existing.campaign_contact_id is distinct from v_contact_id or v_existing.sender_identity_id is distinct from v_sender_identity_id or lower(v_existing.recipient_address) is distinct from v_recipient or v_existing.subject is distinct from v_subject or v_existing.body_sha256 is distinct from v_body_hash then raise exception 'Provider message % already belongs to a different immutable campaign send receipt',v_message_id; end if; return jsonb_build_object('receipt_id',v_existing.id,'action_id',v_existing.action_id,'communication_authority_assessment_id',v_existing.communication_authority_assessment_id,'idempotent_replay',true); end if;
 v_packet:=local_intel.get_campaign_email_send_packet_v2(v_contact_id,v_sender_identity_id); if coalesce((v_packet->>'send_ready')::boolean,false)=false then raise exception 'Campaign email is not send-ready: %',v_packet->'blockers'; end if; v_comm_auth:=v_packet->'communication_authority'; if not coalesce((v_comm_auth->>'human_send_allowed')::boolean,false) then raise exception 'Communication authority does not allow human send'; end if; if coalesce((v_comm_auth->'policy_snapshot'->>'human_authorization_required')::boolean,true) and v_auth_ref is null then raise exception 'human_authorization_reference is required for this communication class'; end if; if lower(v_packet->>'recipient_address') is distinct from v_recipient then raise exception 'Provider recipient does not match governed campaign contact point'; end if; if v_packet->>'subject' is distinct from v_subject then raise exception 'Provider subject does not match approved campaign message'; end if; if lower(v_packet->>'body_sha256') is distinct from v_body_hash then raise exception 'Provider body hash does not match approved campaign message'; end if;
 v_comm_assessment_id:=local_intel.record_communication_authority_assessment_v1(jsonb_build_object('assessment_key','campaign_email:'||v_provider||':'||v_message_id||':communication_authority:v1','communication_class','prospecting','provider_key',v_provider,'sender_identity_id',v_sender_identity_id,'entity_id',(select entity_id from local_intel.campaign_contacts where id=v_contact_id),'contact_point_id',v_packet->>'contact_point_id','relationship_basis','public_business_prospect','metadata',jsonb_build_object('human_authorization_reference',v_auth_ref,'campaign_contact_id',v_contact_id)));
 v_execution_key:=v_provider||':'||v_message_id; v_action_id:=local_intel.record_campaign_outreach_execution_v1(jsonb_build_object('campaign_target_id',v_packet->>'campaign_target_id','campaign_contact_id',v_contact_id,'execution_key',v_execution_key,'actor_kind',v_actor_kind,'actor_ref',v_actor_ref,'channel','email','occurred_at',v_occurred_at,'evidence_snapshot',jsonb_build_object('provider',v_provider,'provider_message_id',v_message_id,'provider_thread_id',v_thread_id,'sender_identity_id',v_sender_identity_id,'sender_address',v_sender_address,'recipient_address',v_recipient,'subject',v_subject,'body_sha256',v_body_hash,'communication_class','prospecting','communication_authority_assessment_id',v_comm_assessment_id,'provider_receipt',coalesce(p_payload->'provider_receipt','{}'::jsonb),'receipt_semantics','provider-confirmed transport receipt; not proof of delivery, reading, response, or causality')));
 insert into local_intel.campaign_send_receipts(provider,provider_message_id,provider_thread_id,campaign_id,campaign_target_id,campaign_contact_id,contact_point_id,campaign_asset_id,action_id,sender_address,recipient_address,subject,body_sha256,occurred_at,provider_receipt,metadata,sender_identity_id,communication_authority_assessment_id) values(v_provider,v_message_id,v_thread_id,(v_packet->>'campaign_id')::uuid,(v_packet->>'campaign_target_id')::uuid,v_contact_id,(v_packet->>'contact_point_id')::uuid,(v_packet->>'campaign_asset_id')::uuid,v_action_id,v_sender_address,v_recipient,v_subject,v_body_hash,v_occurred_at,coalesce(p_payload->'provider_receipt','{}'::jsonb),jsonb_build_object('send_receipt_membrane_version','2.0','communication_class','prospecting','human_authorization_reference',v_auth_ref),v_sender_identity_id,v_comm_assessment_id) returning id into v_receipt_id;
 perform local_intel.record_communication_sender_health_event_v1(jsonb_build_object('event_key','campaign_send_receipt:'||v_receipt_id::text||':accepted','sender_identity_id',v_sender_identity_id,'event_type','accepted','campaign_send_receipt_id',v_receipt_id,'contact_point_id',v_packet->>'contact_point_id','occurred_at',v_occurred_at,'metadata',jsonb_build_object('provider',v_provider,'provider_message_id',v_message_id)));
 return jsonb_build_object('receipt_id',v_receipt_id,'action_id',v_action_id,'communication_authority_assessment_id',v_comm_assessment_id,'idempotent_replay',false);
end;$function$;

revoke execute on function local_intel.block_communication_history_mutation_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.get_communication_authority_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.record_communication_authority_assessment_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.record_communication_permission_event_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.record_communication_provider_connection_event_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.register_communication_sender_identity_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.record_communication_sender_health_event_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.get_campaign_email_send_packet_v2(uuid,uuid) from public,anon,authenticated;
revoke execute on function local_intel.record_campaign_email_send_receipt_v2(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.record_campaign_email_send_receipt_v1(jsonb) from service_role;
grant execute on function local_intel.get_communication_authority_v1(jsonb) to service_role;
grant execute on function local_intel.record_communication_authority_assessment_v1(jsonb) to service_role;
grant execute on function local_intel.record_communication_permission_event_v1(jsonb) to service_role;
grant execute on function local_intel.record_communication_provider_connection_event_v1(jsonb) to service_role;
grant execute on function local_intel.register_communication_sender_identity_v1(jsonb) to service_role;
grant execute on function local_intel.record_communication_sender_health_event_v1(jsonb) to service_role;
grant execute on function local_intel.get_campaign_email_send_packet_v2(uuid,uuid) to service_role;
grant execute on function local_intel.record_campaign_email_send_receipt_v2(jsonb) to service_role;

revoke all on local_intel.communication_classes from public,anon,authenticated,service_role;
revoke all on local_intel.communication_providers from public,anon,authenticated,service_role;
revoke all on local_intel.communication_class_provider_policies from public,anon,authenticated,service_role;
revoke all on local_intel.communication_class_relationship_policies from public,anon,authenticated,service_role;
revoke all on local_intel.communication_sender_health_policies from public,anon,authenticated,service_role;
revoke all on local_intel.communication_provider_connection_events from public,anon,authenticated,service_role;
revoke all on local_intel.communication_permission_events from public,anon,authenticated,service_role;
revoke all on local_intel.communication_sender_identities from public,anon,authenticated,service_role;
revoke all on local_intel.communication_sender_health_events from public,anon,authenticated,service_role;
revoke all on local_intel.communication_authority_assessments from public,anon,authenticated,service_role;
revoke all on local_intel.v_communication_provider_connection_v1 from public,anon,authenticated,service_role;
revoke all on local_intel.v_communication_permission_latest_v1 from public,anon,authenticated,service_role;
revoke all on local_intel.v_communication_sender_health_v1 from public,anon,authenticated,service_role;
grant select on local_intel.communication_classes to service_role;
grant select on local_intel.communication_providers to service_role;
grant select on local_intel.communication_class_provider_policies to service_role;
grant select on local_intel.communication_class_relationship_policies to service_role;
grant select on local_intel.communication_sender_health_policies to service_role;
grant select on local_intel.communication_provider_connection_events to service_role;
grant select on local_intel.communication_permission_events to service_role;
grant select on local_intel.communication_sender_identities to service_role;
grant select on local_intel.communication_sender_health_events to service_role;
grant select on local_intel.communication_authority_assessments to service_role;
grant select on local_intel.v_communication_provider_connection_v1 to service_role;
grant select on local_intel.v_communication_permission_latest_v1 to service_role;
grant select on local_intel.v_communication_sender_health_v1 to service_role;