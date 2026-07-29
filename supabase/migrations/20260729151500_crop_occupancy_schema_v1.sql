alter table atlas.crop_profiles
  add column if not exists plants_per_sqft numeric;

create table if not exists atlas.crop_placements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  planting_claim_id uuid references atlas.planting_claims(id) on delete set null,
  object_content_id uuid references atlas.object_contents(id) on delete set null,
  placement_key text not null,
  placement_mode text not null default 'unknown' check (placement_mode in (
    'full_rows','partial_rows','square_foot_block','individual_plants','edge_strip',
    'clumps','scattered','broadcast_area','unknown'
  )),
  placement_label text,
  row_count numeric check (row_count is null or row_count > 0),
  row_length_ft numeric check (row_length_ft is null or row_length_ft > 0),
  area_sqft numeric check (area_sqft is null or area_sqft > 0),
  explicit_plant_count numeric check (explicit_plant_count is null or explicit_plant_count >= 0),
  clump_count numeric check (clump_count is null or clump_count >= 0),
  spacing_in numeric check (spacing_in is null or spacing_in > 0),
  plants_per_sqft numeric check (plants_per_sqft is null or plants_per_sqft > 0),
  expected_quantity numeric check (expected_quantity is null or expected_quantity >= 0),
  expected_quantity_kind text not null default 'unknown' check (expected_quantity_kind in ('recorded','calculated','unknown')),
  expected_quantity_unit text,
  expected_quantity_basis text,
  confidence text not null default 'medium' check (confidence in ('low','medium','high','owner_confirmed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crop_cycle_id, placement_key)
);

create index if not exists crop_placements_object_idx
  on atlas.crop_placements(object_id, crop_cycle_id);
create index if not exists crop_placements_claim_idx
  on atlas.crop_placements(planting_claim_id)
  where planting_claim_id is not null;

create table if not exists atlas.crop_placement_cells (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references atlas.crop_placements(id) on delete cascade,
  cell_key text not null,
  bed_column text,
  foot_number integer check (foot_number is null or foot_number > 0),
  coverage_fraction numeric not null default 1 check (coverage_fraction > 0 and coverage_fraction <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (placement_id, cell_key)
);

create index if not exists crop_placement_cells_placement_idx
  on atlas.crop_placement_cells(placement_id, foot_number);

create table if not exists atlas.crop_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  placement_id uuid references atlas.crop_placements(id) on delete set null,
  object_content_id uuid references atlas.object_contents(id) on delete set null,
  field_log_id uuid references atlas.field_logs(id) on delete set null,
  observed_date date,
  stage text,
  observed_quantity numeric check (observed_quantity is null or observed_quantity >= 0),
  quantity_unit text,
  quantity_kind text check (quantity_kind is null or quantity_kind in ('count','estimate','seed_count','clump_count')),
  stand_percent numeric check (stand_percent is null or (stand_percent >= 0 and stand_percent <= 100)),
  condition text,
  confidence text not null default 'medium' check (confidence in ('low','medium','high','owner_confirmed')),
  source_kind text not null default 'manual',
  source_id text,
  note text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, idempotency_key)
);

create index if not exists crop_observations_cycle_date_idx
  on atlas.crop_observations(crop_cycle_id, observed_date desc, created_at desc);
create index if not exists crop_observations_object_idx
  on atlas.crop_observations(object_id, observed_date desc);

create table if not exists atlas.crop_occupancy_evidence (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  object_content_id uuid references atlas.object_contents(id) on delete set null,
  planting_claim_id uuid references atlas.planting_claims(id) on delete set null,
  field_log_id uuid references atlas.field_logs(id) on delete set null,
  evidence_role text not null check (evidence_role in ('identity','planting','placement','observation','stage','quantity')),
  evidence_date date,
  confidence text not null default 'medium' check (confidence in ('low','medium','high','owner_confirmed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists crop_occupancy_evidence_content_role_uidx
  on atlas.crop_occupancy_evidence(crop_cycle_id, object_content_id, evidence_role)
  where object_content_id is not null;
create index if not exists crop_occupancy_evidence_cycle_idx
  on atlas.crop_occupancy_evidence(crop_cycle_id, evidence_date desc);

alter table atlas.crop_placements enable row level security;
alter table atlas.crop_placement_cells enable row level security;
alter table atlas.crop_observations enable row level security;
alter table atlas.crop_occupancy_evidence enable row level security;

revoke all on atlas.crop_placements from public, anon, authenticated;
revoke all on atlas.crop_placement_cells from public, anon, authenticated;
revoke all on atlas.crop_observations from public, anon, authenticated;
revoke all on atlas.crop_occupancy_evidence from public, anon, authenticated;
grant all on atlas.crop_placements to service_role;
grant all on atlas.crop_placement_cells to service_role;
grant all on atlas.crop_observations to service_role;
grant all on atlas.crop_occupancy_evidence to service_role;

drop trigger if exists crop_placements_set_updated_at on atlas.crop_placements;
create trigger crop_placements_set_updated_at
before update on atlas.crop_placements
for each row execute function atlas.set_updated_at();

drop trigger if exists crop_observations_set_updated_at on atlas.crop_observations;
create trigger crop_observations_set_updated_at
before update on atlas.crop_observations
for each row execute function atlas.set_updated_at();

create or replace function atlas.try_numeric_v1(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, atlas
as $$
begin
  if nullif(btrim(coalesce(p_value,'')), '') is null then return null; end if;
  return p_value::numeric;
exception when others then
  return null;
end;
$$;

create or replace function atlas.normalize_crop_identity_v1(p_label text, p_variety text default null)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select lower(regexp_replace(
    regexp_replace(
      regexp_replace(
        btrim(concat_ws(' ', nullif(p_variety,''), nullif(p_label,''))),
        '\m(bearded )?iris\M', 'iris', 'gi'
      ),
      '\s+', ' ', 'g'
    ),
    '(sunflowers|zinnias|beans|dahlias|cosmoses)$',
    case
      when lower(btrim(concat_ws(' ', nullif(p_variety,''), nullif(p_label,'')))) like '%sunflowers' then 'sunflower'
      when lower(btrim(concat_ws(' ', nullif(p_variety,''), nullif(p_label,'')))) like '%zinnias' then 'zinnia'
      when lower(btrim(concat_ws(' ', nullif(p_variety,''), nullif(p_label,'')))) like '%beans' then 'bean'
      when lower(btrim(concat_ws(' ', nullif(p_variety,''), nullif(p_label,'')))) like '%dahlias' then 'dahlia'
      else 'cosmos'
    end,
    'i'
  ));
$$;

create or replace function atlas.crop_stage_from_state_v1(p_state text, p_life_cycle text default null)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case lower(btrim(coalesce(p_state,'')))
    when 'sown' then 'awaiting_germination'
    when 'sown_awaiting_emergence' then 'awaiting_germination'
    when 'germination_check' then 'germination_check'
    when 'germinated' then 'emerging'
    when 'emerging' then 'emerging'
    when 'planted' then case when lower(coalesce(p_life_cycle,''))='perennial' then 'establishing' else 'establishing' end
    when 'establishing' then 'establishing'
    when 'established' then 'established'
    when 'growing' then 'vegetative'
    when 'vegetative' then 'vegetative'
    when 'pinch' then 'pinch_stage'
    when 'pinch_stage' then 'pinch_stage'
    when 'budding' then 'budding'
    when 'blooming' then 'flowering'
    when 'flowering' then 'flowering'
    when 'fruiting' then 'fruiting'
    when 'harvest_watch' then 'harvest_watch'
    when 'harvesting' then 'harvesting'
    when 'browsed_alive' then 'browsed_alive'
    when 'compromised' then 'compromised'
    when 'stressed' then 'stressed'
    when 'declining' then 'declining'
    when 'ready_to_clear' then 'ready_to_clear'
    when 'cleared' then 'cleared'
    when 'failed' then 'failed'
    when 'dead' then 'dead'
    when 'absent' then 'absent'
    when 'abandoned' then 'abandoned'
    else nullif(lower(btrim(coalesce(p_state,''))), '')
  end;
$$;

create or replace function atlas.crop_stage_label_v1(p_stage text)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case lower(coalesce(p_stage,''))
    when 'awaiting_germination' then 'Awaiting germination'
    when 'germination_check' then 'Germination check'
    when 'emerging' then 'Emerging'
    when 'establishing' then 'Establishing'
    when 'established' then 'Established'
    when 'vegetative' then 'Vegetative'
    when 'pinch_stage' then 'Pinch stage'
    when 'budding' then 'Budding'
    when 'flowering' then 'Flowering'
    when 'fruiting' then 'Fruiting'
    when 'harvest_watch' then 'Harvest watch'
    when 'harvesting' then 'Harvesting'
    when 'browsed_alive' then 'Browsed, alive'
    when 'compromised' then 'Compromised'
    when 'stressed' then 'Stressed'
    when 'declining' then 'Declining'
    when 'ready_to_clear' then 'Ready to clear'
    when 'cleared' then 'Cleared'
    when 'failed' then 'Failed'
    when 'dead' then 'Dead'
    when 'absent' then 'Absent'
    when 'abandoned' then 'Abandoned'
    else initcap(replace(coalesce(p_stage,'Unknown'),'_',' '))
  end;
$$;

revoke all on function atlas.try_numeric_v1(text) from public;
revoke all on function atlas.normalize_crop_identity_v1(text,text) from public;
revoke all on function atlas.crop_stage_from_state_v1(text,text) from public;
revoke all on function atlas.crop_stage_label_v1(text) from public;
grant execute on function atlas.try_numeric_v1(text) to authenticated, service_role;
grant execute on function atlas.normalize_crop_identity_v1(text,text) to authenticated, service_role;
grant execute on function atlas.crop_stage_from_state_v1(text,text) to authenticated, service_role;
grant execute on function atlas.crop_stage_label_v1(text) to authenticated, service_role;