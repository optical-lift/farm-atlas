create table if not exists atlas.community_registration_participants (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references atlas.community_registrations(id) on delete cascade,
  display_name text not null,
  participant_role text not null default 'family_member' check (participant_role in ('adult','child','family_member','other_family_member')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas.community_registration_payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references atlas.community_registrations(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded','partially_refunded')),
  payment_processor text,
  external_payment_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  beneficiary_type text,
  beneficiary_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_registration_offerings_program_idx
  on atlas.community_registration_offerings(program_id);
create index if not exists community_registration_offerings_event_idx
  on atlas.community_registration_offerings(event_id);
create index if not exists community_registrations_offering_idx
  on atlas.community_registrations(offering_id, created_at desc);
create unique index if not exists community_registrations_active_email_uq
  on atlas.community_registrations(offering_id, lower(primary_email))
  where status not in ('cancelled','refunded');
create index if not exists community_registration_participants_registration_idx
  on atlas.community_registration_participants(registration_id);
create index if not exists community_registration_payments_registration_idx
  on atlas.community_registration_payments(registration_id, created_at desc);

alter table atlas.community_registration_offerings enable row level security;
alter table atlas.community_registrations enable row level security;
alter table atlas.community_registration_participants enable row level security;
alter table atlas.community_registration_payments enable row level security;

revoke all on atlas.community_registration_offerings from anon, authenticated;
revoke all on atlas.community_registrations from anon, authenticated;
revoke all on atlas.community_registration_participants from anon, authenticated;
revoke all on atlas.community_registration_payments from anon, authenticated;

grant all on atlas.community_registration_offerings to service_role;
grant all on atlas.community_registrations to service_role;
grant all on atlas.community_registration_participants to service_role;
grant all on atlas.community_registration_payments to service_role;
