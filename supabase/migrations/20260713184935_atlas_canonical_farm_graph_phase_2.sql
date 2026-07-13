-- Atlas Phase 2: canonical farm graph
--
-- Converts legacy object_contents into addressable crop cycles and plant instances
-- without deleting or rewriting source observations. Uncertain records enter a
-- review queue instead of being guessed.

create or replace function atlas.identity_token(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]+', ' ', 'g')
    )
  );
$$;

revoke all on function atlas.identity_token(text) from public;
grant execute on function atlas.identity_token(text) to anon, authenticated, service_role;

create table atlas.identity_review_queue (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  review_key text not null,
  entity_type text not null check (entity_type in ('object_content', 'planting_claim', 'crop_cycle', 'plant_instance')),
  source_table text not null,
  source_id uuid,
  object_id uuid references atlas.growing_objects(id) on delete set null,
  issue_type text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  candidate_data jsonb not null default '{}'::jsonb,
  resolution_note text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, review_key)
);

create index identity_review_queue_open_idx
  on atlas.identity_review_queue (farm_id, priority, created_at)
  where status = 'open';

create table atlas.object_content_resolutions (
  object_content_id uuid primary key references atlas.object_contents(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  canonical_content_id uuid not null references atlas.object_contents(id) on delete restrict,
  identity_kind text not null check (identity_kind in ('crop_cycle', 'plant_instance', 'historical', 'review_required')),
  resolution_status text not null check (resolution_status in ('canonical', 'merged_duplicate', 'historical', 'review_required')),
  resolution_method text not null,
  confidence text not null default 'high' check (confidence in ('low', 'medium', 'high', 'confirmed')),
  review_id uuid references atlas.identity_review_queue(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz not null default now()
);

create index object_content_resolutions_canonical_idx
  on atlas.object_content_resolutions (farm_id, canonical_content_id, identity_kind);

create table atlas.object_content_entity_links (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_content_id uuid not null references atlas.object_contents(id) on delete cascade,
  crop_cycle_id uuid references atlas.crop_cycles(id) on delete cascade,
  plant_instance_id uuid references atlas.plant_instances(id) on delete cascade,
  relation_type text not null default 'represents',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(crop_cycle_id, plant_instance_id) = 1)
);

create unique index object_content_entity_links_cycle_unique
  on atlas.object_content_entity_links (object_content_id, crop_cycle_id)
  where crop_cycle_id is not null;

create unique index object_content_entity_links_plant_unique
  on atlas.object_content_entity_links (object_content_id, plant_instance_id)
  where plant_instance_id is not null;

alter table atlas.identity_review_queue enable row level security;
alter table atlas.object_content_resolutions enable row level security;
alter table atlas.object_content_entity_links enable row level security;

revoke all on atlas.identity_review_queue from public, anon, authenticated;
revoke all on atlas.object_content_resolutions from public, anon, authenticated;
revoke all on atlas.object_content_entity_links from public, anon, authenticated;

grant select, insert, update, delete on atlas.identity_review_queue to service_role;
grant select, insert, update, delete on atlas.object_content_resolutions to service_role;
grant select, insert, update, delete on atlas.object_content_entity_links to service_role;

-- Build a deterministic identity map. Distinct named varieties on the same
-- object stay distinct; blank-variety revisions collapse into the richer row.
create temporary table _p2_ranked on commit drop as
with normalized as (
  select
    oc.*,
    atlas.identity_token(oc.content_label) as label_token,
    atlas.identity_token(oc.variety) as variety_token
  from atlas.object_contents oc
), stats as (
  select
    farm_id,
    object_id,
    label_token,
    count(distinct variety_token) filter (where variety_token <> '') as named_variety_count,
    count(*) filter (where variety_token = '') as blank_variety_count
  from normalized
  group by farm_id, object_id, label_token
), identified as (
  select
    n.*,
    n.label_token || case
      when s.named_variety_count > 1 and s.blank_variety_count = 0
        then '|' || n.variety_token
      else ''
    end as identity_key
  from normalized n
  join stats s using (farm_id, object_id, label_token)
)
select
  i.*,
  row_number() over (
    partition by i.farm_id, i.object_id, i.identity_key
    order by
      (i.planting_claim_id is not null) desc,
      (i.crop_profile_id is not null) desc,
      (i.planted_date is not null) desc,
      (nullif(btrim(i.variety), '') is not null) desc,
      length(coalesce(i.note, '')) desc,
      i.updated_at desc,
      i.created_at desc,
      i.id
  ) as identity_rank
from identified i;

create temporary table _p2_groups on commit drop as
select
  c.*,
  coalesce(
    c.planting_claim_id,
    (
      select r.planting_claim_id
      from _p2_ranked r
      where r.farm_id = c.farm_id
        and r.object_id = c.object_id
        and r.identity_key = c.identity_key
        and r.planting_claim_id is not null
      order by r.identity_rank
      limit 1
    )
  ) as resolved_planting_claim_id,
  coalesce(
    c.crop_profile_id,
    (
      select r.crop_profile_id
      from _p2_ranked r
      where r.farm_id = c.farm_id
        and r.object_id = c.object_id
        and r.identity_key = c.identity_key
        and r.crop_profile_id is not null
      order by r.identity_rank
      limit 1
    )
  ) as resolved_source_profile_id,
  case
    when lower(c.status) in ('absent', 'failed', 'abandoned', 'no_emergence_observed')
      or lower(c.content_type) = 'crop_history'
      then 'historical'
    when lower(c.content_type) in ('mixed_planting', 'holding', 'tray_group', 'field_observation')
      or atlas.identity_token(c.content_label) in (
        'celosia navy beans',
        'zinnias celosia',
        'reserved for gift grow bag dahlias',
        'july seed start queue',
        'perennials fall zinnia pockets',
        'black oil sunflower queensland blue squash'
      )
      then 'review_required'
    when lower(c.content_type) in (
        'perennial', 'shrub', 'dahlia_stock', 'volunteer',
        'volunteer_or_existing', 'intentional_volunteer', 'herb'
      )
      or atlas.identity_token(c.content_label) like '%dahlia%'
      or exists (
        select 1
        from atlas.crop_profiles cp
        where cp.id = coalesce(
          c.crop_profile_id,
          (
            select r.crop_profile_id
            from _p2_ranked r
            where r.farm_id = c.farm_id
              and r.object_id = c.object_id
              and r.identity_key = c.identity_key
              and r.crop_profile_id is not null
            order by r.identity_rank
            limit 1
          )
        )
          and cp.life_cycle in ('perennial', 'tender_perennial', 'perennial_or_bulb')
      )
      then 'plant_instance'
    else 'crop_cycle'
  end as identity_kind
from _p2_ranked c
where c.identity_rank = 1;

create temporary table _p2_map on commit drop as
select
  r.id as object_content_id,
  r.farm_id,
  r.object_id,
  g.id as canonical_content_id,
  g.identity_key,
  g.identity_kind,
  r.identity_rank
from _p2_ranked r
join _p2_groups g
  on g.farm_id = r.farm_id
 and g.object_id = r.object_id
 and g.identity_key = r.identity_key;

-- Ambiguous content stays visible and actionable.
insert into atlas.identity_review_queue (
  farm_id,
  review_key,
  entity_type,
  source_table,
  source_id,
  object_id,
  issue_type,
  priority,
  candidate_data,
  metadata
)
select
  g.farm_id,
  'object_content:' || g.id::text,
  'object_content',
  'atlas.object_contents',
  g.id,
  g.object_id,
  'ambiguous_legacy_content',
  'normal',
  jsonb_build_object(
    'content_label', g.content_label,
    'content_type', g.content_type,
    'variety', g.variety,
    'status', g.status,
    'note', g.note,
    'identity_key', g.identity_key
  ),
  jsonb_build_object('phase', 2, 'method', 'canonical_farm_graph_v1')
from _p2_groups g
where g.identity_kind = 'review_required'
on conflict (farm_id, review_key) do update
set
  candidate_data = excluded.candidate_data,
  updated_at = now();

-- Fill the explicit planting-claim-to-place bridge wherever the source already
-- supplies the object. One locationless claim remains a review item.
insert into atlas.planting_claim_objects (planting_claim_id, object_id)
select distinct oc.planting_claim_id, oc.object_id
from atlas.object_contents oc
where oc.planting_claim_id is not null
on conflict (planting_claim_id, object_id) do nothing;

insert into atlas.planting_claim_objects (planting_claim_id, object_id)
select distinct cc.planting_claim_id, cc.object_id
from atlas.crop_cycles cc
where cc.planting_claim_id is not null
  and cc.object_id is not null
on conflict (planting_claim_id, object_id) do nothing;

insert into atlas.identity_review_queue (
  farm_id,
  review_key,
  entity_type,
  source_table,
  source_id,
  issue_type,
  priority,
  candidate_data,
  metadata
)
select
  pc.farm_id,
  'planting_claim:' || pc.id::text,
  'planting_claim',
  'atlas.planting_claims',
  pc.id,
  'missing_physical_object',
  'high',
  jsonb_build_object(
    'crop_label', pc.crop_label,
    'variety', pc.variety,
    'planted_date', pc.planted_date,
    'planting_method', pc.planting_method,
    'note', pc.note
  ),
  jsonb_build_object('phase', 2, 'method', 'canonical_farm_graph_v1')
from atlas.planting_claims pc
where not exists (
  select 1
  from atlas.planting_claim_objects pco
  where pco.planting_claim_id = pc.id
)
on conflict (farm_id, review_key) do update
set
  candidate_data = excluded.candidate_data,
  updated_at = now();

-- Resolve annual/current crop groups into crop_cycles. Existing cycles win by
-- planting claim first, then by exact object/crop/variety identity.
create temporary table _p2_crop_targets on commit drop as
select
  g.*,
  coalesce(existing_cycle.id, gen_random_uuid()) as target_cycle_id,
  (existing_cycle.id is not null) as reused_existing_cycle,
  coalesce(g.resolved_source_profile_id, matched_profile.id) as resolved_crop_profile_id
from _p2_groups g
left join lateral (
  select cp.id
  from atlas.crop_profiles cp
  where cp.id = g.resolved_source_profile_id
     or (
       atlas.identity_token(cp.crop_label) = atlas.identity_token(g.content_label)
       and (
         atlas.identity_token(cp.variety) = atlas.identity_token(g.variety)
         or (atlas.identity_token(cp.variety) = '' and atlas.identity_token(g.variety) = '')
       )
     )
     or (
       atlas.identity_token(g.variety) <> ''
       and atlas.identity_token(cp.variety) = atlas.identity_token(g.variety)
       and (
         atlas.identity_token(g.content_label) like '%' || atlas.identity_token(cp.crop_label) || '%'
         or atlas.identity_token(cp.crop_label) like '%' || atlas.identity_token(g.content_label) || '%'
       )
     )
  order by
    (cp.id = g.resolved_source_profile_id) desc,
    (atlas.identity_token(cp.variety) = atlas.identity_token(g.variety) and atlas.identity_token(g.variety) <> '') desc,
    (atlas.identity_token(cp.crop_label) = atlas.identity_token(g.content_label)) desc,
    length(cp.crop_label) desc,
    cp.id
  limit 1
) matched_profile on true
left join lateral (
  select cc.id
  from atlas.crop_cycles cc
  where cc.farm_id = g.farm_id
    and cc.lifecycle_status = 'active'
    and (
      (
        g.resolved_planting_claim_id is not null
        and cc.planting_claim_id = g.resolved_planting_claim_id
      )
      or (
        cc.object_id = g.object_id
        and atlas.identity_token(cc.crop_label) = atlas.identity_token(g.content_label)
        and atlas.identity_token(cc.variety) = atlas.identity_token(g.variety)
      )
    )
  order by
    (g.resolved_planting_claim_id is not null and cc.planting_claim_id = g.resolved_planting_claim_id) desc,
    cc.created_at,
    cc.id
  limit 1
) existing_cycle on true
where g.identity_kind = 'crop_cycle';

insert into atlas.crop_cycles (
  id,
  farm_id,
  object_id,
  planting_claim_id,
  crop_profile_id,
  crop_cycle_key,
  crop_label,
  variety,
  cycle_state,
  lifecycle_status,
  planted_date,
  expected_germination_start,
  expected_germination_end,
  expected_harvest_watch_start,
  expected_harvest_watch_end,
  expected_clear_date,
  note,
  metadata
)
select
  t.target_cycle_id,
  t.farm_id,
  t.object_id,
  t.resolved_planting_claim_id,
  t.resolved_crop_profile_id,
  'phase2_' || replace(t.object_id::text, '-', '') || '_' || left(replace(t.id::text, '-', ''), 12),
  t.content_label,
  nullif(btrim(t.variety), ''),
  case lower(t.status)
    when 'established' then 'growing'
    when 'establishing' then 'growing'
    when 'planted' then 'planted'
    else lower(t.status)
  end,
  'active',
  t.planted_date,
  t.expected_germination_start,
  t.expected_germination_end,
  t.expected_harvest_watch_start,
  t.expected_harvest_watch_end,
  t.expected_clear_date,
  t.note,
  jsonb_build_object(
    'canonical_source', 'atlas.object_contents',
    'canonical_content_id', t.id,
    'phase', 2,
    'identity_method', 'canonical_farm_graph_v1'
  )
from _p2_crop_targets t
where not t.reused_existing_cycle;

update atlas.crop_cycles cc
set
  object_id = coalesce(cc.object_id, t.object_id),
  crop_profile_id = coalesce(cc.crop_profile_id, t.resolved_crop_profile_id),
  planting_claim_id = coalesce(cc.planting_claim_id, t.resolved_planting_claim_id),
  metadata = cc.metadata || jsonb_build_object(
    'canonical_content_id', t.id,
    'canonical_graph_phase', 2
  ),
  updated_at = now()
from _p2_crop_targets t
where t.reused_existing_cycle
  and cc.id = t.target_cycle_id;

-- Match permanent plants only when the evidence produces one unambiguous best
-- existing instance. Anna/Robin dahlia aliases are intentionally explicit.
create temporary table _p2_plant_candidates on commit drop as
select
  g.id as canonical_content_id,
  pi.id as plant_instance_id,
  pi.lineage_id,
  score.match_score
from _p2_groups g
join atlas.plant_instances pi
  on pi.farm_id = g.farm_id
 and pi.object_id = g.object_id
join atlas.plant_lineages pl on pl.id = pi.lineage_id
cross join lateral (
  select case
    when atlas.identity_token(g.content_label) in ('anna dahlia collection', 'anna dahlias')
      and pi.stable_key = 'fr7_anna_dahlias_2026' then 100
    when atlas.identity_token(g.content_label) = 'robin dahlia tubers'
      and pi.stable_key = 'fr7_robin_dahlias_2026' then 100
    when atlas.identity_token(pi.label) = atlas.identity_token(g.content_label) then 95
    when atlas.identity_token(pi.label) like '%' || atlas.identity_token(g.content_label) || '%'
      or atlas.identity_token(g.content_label) like '%' || atlas.identity_token(pi.label) || '%' then 90
    when atlas.identity_token(pl.common_name) = atlas.identity_token(g.content_label) then 85
    when length(atlas.identity_token(pl.common_name)) >= 4
      and atlas.identity_token(g.content_label) like '%' || atlas.identity_token(pl.common_name) || '%' then 80
    else null
  end as match_score
) score
where g.identity_kind = 'plant_instance'
  and score.match_score is not null;

create temporary table _p2_existing_plant_matches on commit drop as
with scored as (
  select
    c.*,
    max(c.match_score) over (partition by c.canonical_content_id) as max_score,
    count(*) over (partition by c.canonical_content_id, c.match_score) as score_ties
  from _p2_plant_candidates c
)
select
  canonical_content_id,
  plant_instance_id,
  lineage_id,
  match_score
from scored
where match_score = max_score
  and score_ties = 1;

-- If no instance matches, re-use an unambiguous lineage where possible.
create temporary table _p2_lineage_candidates on commit drop as
select
  g.id as canonical_content_id,
  pl.id as lineage_id,
  score.match_score
from _p2_groups g
left join _p2_existing_plant_matches em
  on em.canonical_content_id = g.id
join atlas.plant_lineages pl on pl.farm_id = g.farm_id and pl.active
cross join lateral (
  select case
    when atlas.identity_token(pl.common_name) = atlas.identity_token(g.content_label) then 90
    when atlas.identity_token(pl.lineage_name) = atlas.identity_token(g.content_label) then 90
    when length(atlas.identity_token(pl.common_name)) >= 4
      and atlas.identity_token(g.content_label) like '%' || atlas.identity_token(pl.common_name) || '%' then 80
    else null
  end as match_score
) score
where g.identity_kind = 'plant_instance'
  and em.canonical_content_id is null
  and score.match_score is not null;

create temporary table _p2_existing_lineage_matches on commit drop as
with scored as (
  select
    c.*,
    max(c.match_score) over (partition by c.canonical_content_id) as max_score,
    count(*) over (partition by c.canonical_content_id, c.match_score) as score_ties
  from _p2_lineage_candidates c
)
select canonical_content_id, lineage_id, match_score
from scored
where match_score = max_score
  and score_ties = 1;

create temporary table _p2_new_lineages on commit drop as
with needed as (
  select
    g.farm_id,
    atlas.identity_token(g.content_label) || '|' || atlas.identity_token(g.variety) as lineage_identity,
    g.content_label,
    nullif(btrim(g.variety), '') as variety,
    row_number() over (
      partition by g.farm_id, atlas.identity_token(g.content_label), atlas.identity_token(g.variety)
      order by g.id
    ) as identity_rank
  from _p2_groups g
  left join _p2_existing_plant_matches em on em.canonical_content_id = g.id
  left join _p2_existing_lineage_matches lm on lm.canonical_content_id = g.id
  where g.identity_kind = 'plant_instance'
    and em.canonical_content_id is null
    and lm.canonical_content_id is null
)
select
  n.farm_id,
  n.lineage_identity,
  gen_random_uuid() as lineage_id,
  n.content_label,
  n.variety,
  'phase2_lineage_' || left(md5(n.farm_id::text || '|' || n.lineage_identity), 24) as stable_key
from needed n
where n.identity_rank = 1;

insert into atlas.plant_lineages (
  id,
  farm_id,
  stable_key,
  lineage_name,
  common_name,
  story,
  legacy_status,
  active,
  metadata
)
select
  nl.lineage_id,
  nl.farm_id,
  nl.stable_key,
  nl.content_label || coalesce(' · ' || nl.variety, ''),
  nl.content_label,
  'Canonicalized from legacy Atlas object content. The source observation is preserved and linked.',
  array['phase_2_canonicalized'],
  true,
  jsonb_build_object(
    'phase', 2,
    'provisional_identity', true,
    'identity_method', 'canonical_farm_graph_v1'
  )
from _p2_new_lineages nl;

create temporary table _p2_plant_targets on commit drop as
select
  g.*,
  em.plant_instance_id as target_plant_instance_id,
  em.lineage_id as resolved_lineage_id,
  true as reused_existing_instance
from _p2_groups g
join _p2_existing_plant_matches em on em.canonical_content_id = g.id
where g.identity_kind = 'plant_instance'
union all
select
  g.*,
  gen_random_uuid() as target_plant_instance_id,
  coalesce(lm.lineage_id, nl.lineage_id) as resolved_lineage_id,
  false as reused_existing_instance
from _p2_groups g
left join _p2_existing_plant_matches em on em.canonical_content_id = g.id
left join _p2_existing_lineage_matches lm on lm.canonical_content_id = g.id
left join _p2_new_lineages nl
  on nl.farm_id = g.farm_id
 and nl.lineage_identity = atlas.identity_token(g.content_label) || '|' || atlas.identity_token(g.variety)
where g.identity_kind = 'plant_instance'
  and em.canonical_content_id is null;

insert into atlas.plant_instances (
  id,
  lineage_id,
  farm_id,
  object_id,
  object_content_id,
  stable_key,
  label,
  status,
  planted_date,
  note,
  metadata
)
select
  t.target_plant_instance_id,
  t.resolved_lineage_id,
  t.farm_id,
  t.object_id,
  t.id,
  'phase2_instance_' || left(replace(t.id::text, '-', ''), 24),
  t.content_label,
  lower(t.status),
  t.planted_date,
  t.note,
  jsonb_build_object(
    'canonical_source', 'atlas.object_contents',
    'canonical_content_id', t.id,
    'phase', 2,
    'identity_method', 'canonical_farm_graph_v1'
  )
from _p2_plant_targets t
where not t.reused_existing_instance;

with target_counts as (
  select
    target_plant_instance_id,
    (array_agg(id order by id))[1] as canonical_content_id,
    count(distinct id) as source_group_count
  from _p2_plant_targets
  where reused_existing_instance
  group by target_plant_instance_id
)
update atlas.plant_instances pi
set
  object_content_id = case
    when tc.source_group_count = 1 then coalesce(pi.object_content_id, tc.canonical_content_id)
    else pi.object_content_id
  end,
  metadata = pi.metadata || jsonb_build_object(
    'canonical_graph_phase', 2,
    'mapped_source_groups', tc.source_group_count
  ),
  updated_at = now()
from target_counts tc
where pi.id = tc.target_plant_instance_id;

-- Record a resolution for every legacy row and link all resolved evidence to
-- its canonical entity. Source rows remain intact.
insert into atlas.object_content_resolutions (
  object_content_id,
  farm_id,
  object_id,
  canonical_content_id,
  identity_kind,
  resolution_status,
  resolution_method,
  confidence,
  review_id,
  metadata
)
select
  m.object_content_id,
  m.farm_id,
  m.object_id,
  m.canonical_content_id,
  m.identity_kind,
  case
    when m.identity_kind = 'historical' then 'historical'
    when m.identity_kind = 'review_required' then 'review_required'
    when m.object_content_id <> m.canonical_content_id then 'merged_duplicate'
    else 'canonical'
  end,
  'phase2_ranked_identity_v1',
  case when m.identity_kind = 'review_required' then 'medium' else 'high' end,
  rq.id,
  jsonb_build_object(
    'identity_key', m.identity_key,
    'identity_rank', m.identity_rank,
    'source_preserved', true
  )
from _p2_map m
left join atlas.identity_review_queue rq
  on rq.farm_id = m.farm_id
 and rq.review_key = 'object_content:' || m.canonical_content_id::text
on conflict (object_content_id) do update
set
  canonical_content_id = excluded.canonical_content_id,
  identity_kind = excluded.identity_kind,
  resolution_status = excluded.resolution_status,
  resolution_method = excluded.resolution_method,
  confidence = excluded.confidence,
  review_id = excluded.review_id,
  metadata = excluded.metadata,
  resolved_at = now();

insert into atlas.object_content_entity_links (
  farm_id,
  object_content_id,
  crop_cycle_id,
  relation_type,
  metadata
)
select
  m.farm_id,
  m.object_content_id,
  t.target_cycle_id,
  case when m.object_content_id = m.canonical_content_id then 'canonical_source' else 'supporting_source' end,
  jsonb_build_object('phase', 2, 'source_preserved', true)
from _p2_map m
join _p2_crop_targets t on t.id = m.canonical_content_id
on conflict do nothing;

insert into atlas.object_content_entity_links (
  farm_id,
  object_content_id,
  plant_instance_id,
  relation_type,
  metadata
)
select
  m.farm_id,
  m.object_content_id,
  t.target_plant_instance_id,
  case when m.object_content_id = m.canonical_content_id then 'canonical_source' else 'supporting_source' end,
  jsonb_build_object('phase', 2, 'source_preserved', true)
from _p2_map m
join _p2_plant_targets t on t.id = m.canonical_content_id
on conflict do nothing;

-- Guardrails: one active crop identity per physical object and one open task per
-- generated identity/date. These encode the exact duplicate failures Phase 2
-- is meant to stop.
alter table atlas.crop_cycles
  add constraint crop_cycles_active_requires_object
  check (lifecycle_status <> 'active' or object_id is not null)
  not valid;

alter table atlas.crop_cycles validate constraint crop_cycles_active_requires_object;

create unique index crop_cycles_one_active_identity
  on atlas.crop_cycles (
    farm_id,
    object_id,
    atlas.identity_token(crop_label),
    atlas.identity_token(coalesce(variety, ''))
  )
  where lifecycle_status = 'active';

create unique index tasks_one_open_generated_identity
  on atlas.tasks (
    farm_id,
    generated_from,
    generated_from_id,
    atlas.identity_token(title),
    coalesce(due_date, date '0001-01-01')
  )
  where status in ('open', 'blocked')
    and generated_from is not null
    and generated_from_id is not null;

create or replace view atlas.v_canonical_farm_graph
with (security_invoker = true)
as
with source_counts as (
  select
    crop_cycle_id,
    plant_instance_id,
    count(*) as source_record_count
  from atlas.object_content_entity_links
  group by crop_cycle_id, plant_instance_id
), occupants as (
  select
    cc.farm_id,
    cc.object_id,
    'crop_cycle'::text as occupant_kind,
    cc.id as occupant_id,
    cc.crop_cycle_key as occupant_key,
    cc.crop_label as occupant_label,
    cc.variety,
    cc.cycle_state as occupant_status,
    cc.planted_date,
    cc.crop_profile_id,
    coalesce(sc.source_record_count, 0) as source_record_count
  from atlas.crop_cycles cc
  left join source_counts sc on sc.crop_cycle_id = cc.id and sc.plant_instance_id is null
  where cc.lifecycle_status = 'active'
  union all
  select
    pi.farm_id,
    pi.object_id,
    'plant_instance'::text,
    pi.id,
    pi.stable_key,
    pi.label,
    null::text,
    pi.status,
    pi.planted_date,
    null::uuid,
    coalesce(sc.source_record_count, 0)
  from atlas.plant_instances pi
  left join source_counts sc on sc.plant_instance_id = pi.id and sc.crop_cycle_id is null
  where pi.status not in ('dead', 'removed', 'archived')
)
select
  f.id as farm_id,
  f.stable_key as farm_key,
  f.name as farm_name,
  z.id as zone_id,
  z.stable_key as zone_key,
  z.label as zone_name,
  go.id as object_id,
  go.stable_key as object_key,
  go.label as object_label,
  go.object_type,
  go.object_mode,
  o.occupant_kind,
  o.occupant_id,
  o.occupant_key,
  o.occupant_label,
  o.variety,
  o.occupant_status,
  o.planted_date,
  o.crop_profile_id,
  o.source_record_count,
  (
    select count(*)
    from atlas.identity_review_queue rq
    where rq.farm_id = f.id
      and rq.object_id = go.id
      and rq.status = 'open'
  ) as open_review_count
from occupants o
join atlas.farms f on f.id = o.farm_id
join atlas.growing_objects go on go.id = o.object_id
left join atlas.zones z on z.id = go.zone_id;

create or replace view atlas.v_phase_2_graph_summary
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  f.name as farm_name,
  (select count(*) from atlas.object_contents oc where oc.farm_id = f.id) as legacy_content_rows,
  (select count(*) from atlas.object_content_resolutions r where r.farm_id = f.id) as resolved_content_rows,
  round(
    100.0 * (select count(*) from atlas.object_content_resolutions r where r.farm_id = f.id)
    / nullif((select count(*) from atlas.object_contents oc where oc.farm_id = f.id), 0),
    1
  ) as resolution_coverage_percent,
  (select count(*) from atlas.crop_cycles cc where cc.farm_id = f.id and cc.lifecycle_status = 'active') as active_crop_cycles,
  (select count(*) from atlas.plant_instances pi where pi.farm_id = f.id and pi.status not in ('dead', 'removed', 'archived')) as current_plant_instances,
  (select count(*) from atlas.object_content_resolutions r where r.farm_id = f.id and r.resolution_status = 'merged_duplicate') as duplicate_rows_mapped,
  (select count(*) from atlas.identity_review_queue rq where rq.farm_id = f.id and rq.status = 'open') as open_reviews,
  (
    (select count(*) from atlas.crop_cycles cc where cc.farm_id = f.id and cc.lifecycle_status = 'active' and cc.object_id is null)
    +
    (select count(*) from atlas.plant_instances pi where pi.farm_id = f.id and pi.status not in ('dead', 'removed', 'archived') and pi.object_id is null)
  ) as current_entities_without_object,
  (
    select count(*)
    from atlas.planting_claims pc
    where pc.farm_id = f.id
      and not exists (
        select 1 from atlas.planting_claim_objects pco where pco.planting_claim_id = pc.id
      )
  ) as unlinked_planting_claims,
  (select count(*) from atlas.crop_cycles cc where cc.farm_id = f.id and cc.lifecycle_status = 'active' and cc.crop_profile_id is null) as unprofiled_crop_cycles
from atlas.farms f;

revoke all on atlas.v_canonical_farm_graph from public, anon, authenticated;
revoke all on atlas.v_phase_2_graph_summary from public, anon, authenticated;
grant select on atlas.v_canonical_farm_graph to service_role;
grant select on atlas.v_phase_2_graph_summary to service_role;

-- Provenance and immutable audit snapshot.
insert into atlas.truth_sources (
  farm_id,
  stable_key,
  label,
  source_type,
  source_date,
  authority_rank,
  metadata
)
select
  f.id,
  'atlas_phase_2_canonical_graph_20260713',
  'Atlas Phase 2 canonical farm graph migration',
  'system',
  date '2026-07-13',
  90,
  jsonb_build_object(
    'phase', 2,
    'method', 'canonical_farm_graph_v1',
    'destructive_deletes', false
  )
from atlas.farms f
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do nothing;

insert into atlas.truth_assertions (
  farm_id,
  subject_type,
  subject_id,
  subject_stable_key,
  field_key,
  asserted_value,
  confidence,
  source_id,
  status,
  note,
  metadata
)
select
  s.farm_id,
  'farm',
  s.farm_id,
  'elm_farm',
  'canonical_farm_graph_phase_2',
  to_jsonb(v),
  'confirmed',
  s.id,
  'active',
  'Every current crop or permanent plant is represented by an addressable entity; unresolved source material is queued for review.',
  jsonb_build_object('phase', 2, 'method', 'canonical_farm_graph_v1')
from atlas.truth_sources s
join atlas.v_phase_2_graph_summary v on v.farm_id = s.farm_id
where s.stable_key = 'atlas_phase_2_canonical_graph_20260713'
  and not exists (
    select 1
    from atlas.truth_assertions ta
    where ta.farm_id = s.farm_id
      and ta.field_key = 'canonical_farm_graph_phase_2'
      and ta.status = 'active'
  );

insert into atlas.integrity_audit_runs (
  farm_id,
  audit_version,
  metrics,
  source_id,
  created_by,
  note
)
select
  v.farm_id,
  'phase_2_canonical_graph_v1',
  to_jsonb(v),
  s.id,
  'codex',
  'Non-destructive canonical graph backfill. Legacy source rows are preserved and linked.'
from atlas.v_phase_2_graph_summary v
join atlas.truth_sources s
  on s.farm_id = v.farm_id
 and s.stable_key = 'atlas_phase_2_canonical_graph_20260713'
on conflict (farm_id, audit_version) do nothing;

do $$
declare
  source_count bigint;
  resolved_count bigint;
  objectless_count bigint;
begin
  select count(*) into source_count from atlas.object_contents;
  select count(*) into resolved_count from atlas.object_content_resolutions;
  select coalesce(sum(current_entities_without_object), 0)
    into objectless_count
  from atlas.v_phase_2_graph_summary;

  if source_count <> resolved_count then
    raise exception 'Phase 2 resolution coverage failed: % source rows, % resolutions', source_count, resolved_count;
  end if;

  if objectless_count <> 0 then
    raise exception 'Phase 2 graph contains % current entities without a physical object', objectless_count;
  end if;
end;
$$;
