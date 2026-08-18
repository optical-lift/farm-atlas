-- Elm Directory: availability-aware answer/read layer
-- Applied to live Noel/Elm Supabase on 2026-08-18.
--
-- Preserves the existing search_local_answers_v1 contract and adds v2 rather than
-- silently changing its return type. V2 exposes current/stale/unknown availability
-- alongside durable entity/offering/occurrence truth.
--
-- IMPORTANT REPOSITORY HISTORY NOTE
-- The live local_intel schema predates the local migration history currently present
-- in this repository. This is a forward migration against the existing Elm local_intel
-- baseline; it is not a clean-bootstrap definition of that baseline.

DO $$
BEGIN
  IF to_regclass('local_intel.entities') IS NULL
     OR to_regclass('local_intel.availability_assertions') IS NULL
     OR to_regclass('local_intel.v_answer_inventory') IS NULL
     OR to_regclass('local_intel.v_current_availability') IS NULL THEN
    RAISE EXCEPTION 'Elm local_intel baseline and live availability contract are required before the availability-aware answer layer';
  END IF;
END $$;

CREATE OR REPLACE VIEW local_intel.v_entity_availability_summary
WITH (security_invoker=true)
AS
WITH current_rollup AS (
  SELECT a.entity_id,
         jsonb_agg(
           jsonb_build_object(
             'availability_kind',a.availability_kind,
             'state',a.state,
             'summary',a.summary,
             'details',a.details,
             'observed_at',a.observed_at,
             'valid_through',a.valid_through,
             'source_kind',a.source_kind,
             'confidence',a.confidence
           ) ORDER BY a.availability_kind,a.observed_at DESC
         ) AS current_availability,
         max(a.observed_at) AS latest_current_observation_at,
         min(a.valid_through) AS next_current_expiry_at
  FROM local_intel.v_current_availability a
  GROUP BY a.entity_id
), history AS (
  SELECT a.entity_id,max(a.valid_through) AS last_assertion_valid_through
  FROM local_intel.availability_assertions a
  GROUP BY a.entity_id
)
SELECT e.id AS entity_id,
       CASE WHEN cr.entity_id IS NOT NULL THEN 'current'
            WHEN h.entity_id IS NOT NULL THEN 'stale'
            ELSE 'unknown' END AS availability_freshness,
       coalesce(cr.current_availability,'[]'::jsonb) AS current_availability,
       cr.latest_current_observation_at,
       cr.next_current_expiry_at,
       CASE WHEN cr.entity_id IS NULL THEN h.last_assertion_valid_through ELSE NULL END AS last_availability_expired_at
FROM local_intel.entities e
LEFT JOIN current_rollup cr ON cr.entity_id=e.id
LEFT JOIN history h ON h.entity_id=e.id;

CREATE OR REPLACE FUNCTION local_intel.search_local_answers_v2(
  p_query text,
  p_object_types text[] DEFAULT ARRAY['entity'::text,'offering'::text,'occurrence'::text],
  p_city text DEFAULT NULL::text,
  p_start_at timestamptz DEFAULT NULL::timestamptz,
  p_end_at timestamptz DEFAULT NULL::timestamptz,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  object_type text,
  object_id uuid,
  stable_key text,
  entity_id uuid,
  entity_name text,
  title text,
  description text,
  category text,
  audience jsonb,
  price jsonb,
  schedule jsonb,
  location jsonb,
  current_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  public_url text,
  website_url text,
  phone text,
  email text,
  last_verified_at timestamptz,
  availability_freshness text,
  current_availability jsonb,
  latest_current_observation_at timestamptz,
  next_current_expiry_at timestamptz,
  last_availability_expired_at timestamptz,
  rank real
)
LANGUAGE sql
STABLE
AS $$
WITH q AS (
  SELECT websearch_to_tsquery('simple',p_query) AS tsq
)
SELECT
  v.object_type,v.object_id,v.stable_key,v.entity_id,v.entity_name,v.title,v.description,v.category,
  v.audience,v.price,v.schedule,v.location,v.current_status,v.starts_at,v.ends_at,v.public_url,v.website_url,
  v.phone,v.email,v.last_verified_at,
  coalesce(av.availability_freshness,'unknown') AS availability_freshness,
  coalesce(av.current_availability,'[]'::jsonb) AS current_availability,
  av.latest_current_observation_at,
  av.next_current_expiry_at,
  av.last_availability_expired_at,
  ts_rank_cd(v.search_document,q.tsq)::real AS rank
FROM local_intel.v_answer_inventory v
CROSS JOIN q
LEFT JOIN local_intel.v_entity_availability_summary av ON av.entity_id=v.entity_id
WHERE v.object_type=ANY(p_object_types)
  AND v.search_document @@ q.tsq
  AND (p_city IS NULL OR lower(coalesce(v.location->>'city',''))=lower(p_city))
  AND (p_start_at IS NULL OR v.object_type<>'occurrence' OR coalesce(v.ends_at,v.starts_at)>=p_start_at)
  AND (p_end_at IS NULL OR v.object_type<>'occurrence' OR v.starts_at<=p_end_at)
ORDER BY rank DESC,
         CASE WHEN av.availability_freshness='current' THEN 0 ELSE 1 END,
         CASE v.object_type WHEN 'occurrence' THEN 1 WHEN 'offering' THEN 2 ELSE 3 END,
         v.starts_at NULLS LAST,
         v.title
LIMIT greatest(1,least(coalesce(p_limit,20),100));
$$;

COMMENT ON FUNCTION local_intel.search_local_answers_v2(text,text[],text,timestamptz,timestamptz,integer) IS
  'Searches Elm local answer inventory while explicitly returning current/stale/unknown availability state. Durable entity/offering truth is never converted into available-now unless an unexpired availability assertion exists.';
