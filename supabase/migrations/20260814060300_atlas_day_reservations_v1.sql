create table atlas.day_reservations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  stable_key text not null,
  kind text not null check (kind in ('routine', 'meal', 'external_commitment')),
  service_date date not null,
  title text not null check (btrim(title) <> ''),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'owner_instruction',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint day_reservations_valid_span check (ends_at > starts_at),
  constraint day_reservations_stable_key_nonempty check (btrim(stable_key) <> ''),
  constraint day_reservations_membership_day_key unique (membership_id, service_date, stable_key)
);

create index day_reservations_member_day_active_idx
  on atlas.day_reservations (membership_id, service_date, starts_at)
  where active = true;

create index day_reservations_farm_day_active_idx
  on atlas.day_reservations (farm_id, service_date, starts_at)
  where active = true;

create trigger day_reservations_set_updated_at
before update on atlas.day_reservations
for each row execute function atlas.set_updated_at();

alter table atlas.day_reservations enable row level security;

create policy day_reservations_read_authorized
on atlas.day_reservations
for select
to authenticated
using (
  exists (
    select 1
    from atlas.farm_memberships membership
    where membership.id = day_reservations.membership_id
      and membership.farm_id = day_reservations.farm_id
      and membership.active
      and membership.user_id = (select auth.uid())
  )
  or atlas.can_read_farm_operations(farm_id)
);

grant select on atlas.day_reservations to authenticated;
grant select, insert, update, delete on atlas.day_reservations to service_role;

comment on table atlas.day_reservations is
  'Exact-time non-task occupancy for a worker service day. Whole-day absence remains in member_unavailability; task/cue truth remains separate.';
comment on column atlas.day_reservations.kind is
  'routine, meal, or external_commitment. These rows reserve time but are not tasks.';
