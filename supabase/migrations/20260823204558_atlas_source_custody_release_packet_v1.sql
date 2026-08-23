create or replace function atlas.source_custody_release_packet_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas, extensions, supabase_migrations
as $function$
with migration_bytes as (
  select
    version,
    name,
    array_to_string(statements, E'\n') as sql
  from supabase_migrations.schema_migrations
),
management_migrations as (
  select
    version,
    name,
    encode(
      extensions.digest(
        convert_to('blob ' || octet_length(sql)::text, 'UTF8')
        || decode('00','hex')
        || convert_to(sql,'UTF8'),
        'sha1'
      ),
      'hex'
    ) as expected_blob_sha
  from migration_bytes
  where position('atlas.' in lower(sql)) > 0
),
latest_adjudications as (
  select distinct on (custody_key)
    custody_key,
    disposition,
    evidence,
    rationale,
    adjudicated_by,
    adjudicated_at
  from atlas.source_custody_adjudications
  where custody_class = 'version_drift'
  order by custody_key, adjudicated_at desc
),
surface_packet as (
  select atlas.source_custody_live_packet_v1() as packet
),
rpc_drift as (
  select count(*)::integer as unresolved
  from atlas.authenticated_rpc_registry_drift_v1()
)
select jsonb_build_object(
  'contractVersion', 1,
  'capturedAt', statement_timestamp(),
  'surface', jsonb_build_object(
    'contractVersion', 1,
    'families', coalesce((select packet->'families' from surface_packet), '[]'::jsonb)
  ),
  'rpcDriftCount', (select unresolved from rpc_drift),
  'migrationProvenance', jsonb_build_object(
    'scope', 'atlas-management',
    'migrationCount', (select count(*) from management_migrations),
    'firstVersion', (select min(version) from management_migrations),
    'lastVersion', (select max(version) from management_migrations),
    'manifest', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'version', version,
          'name', name,
          'expectedBlobSha', expected_blob_sha
        ) order by version
      )
      from management_migrations
    ), '[]'::jsonb)
  ),
  'acceptedVersionDrift', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'custodyKey', custody_key,
        'evidence', evidence,
        'rationale', rationale,
        'adjudicatedBy', adjudicated_by,
        'adjudicatedAt', adjudicated_at
      ) order by custody_key
    )
    from latest_adjudications
    where disposition = 'accepted'
  ), '[]'::jsonb)
);
$function$;

revoke all on function atlas.source_custody_release_packet_v1() from public;
grant execute on function atlas.source_custody_release_packet_v1() to anon, authenticated, service_role;

comment on function atlas.source_custody_release_packet_v1() is
'Publicly callable read-only Atlas source-custody packet containing only executable-surface fingerprints, RPC drift count, Atlas-management migration provenance hashes, and accepted version-drift adjudication evidence. Contains no operational business rows or migration SQL bodies.';